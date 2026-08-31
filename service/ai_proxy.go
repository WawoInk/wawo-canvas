package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

var asyncImageTaskTimeout = generationTaskTimeout
var aiProxyHTTPClient = func() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 60 * time.Second
	transport.IdleConnTimeout = 90 * time.Second
	transport.ExpectContinueTimeout = time.Second
	return &http.Client{Transport: transport}
}()

// ProxyAIRequest 处理 POST 类 AI 代理请求：选渠道、扣算力点、转发上游、失败返还。
func ProxyAIRequest(w http.ResponseWriter, r *http.Request, path string) {
	body, contentType, modelName, err := readAIRequest(r)
	if err != nil {
		proxyAILogf("AI proxy request read failed: %v", err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		proxyFail(w, "未登录或权限不足")
		return
	}
	taskType := DetermineTaskType(path)
	auditBody := func(body []byte) []byte {
		if taskType == model.TaskTypeChat {
			return []byte(`{"omitted":"chat content"}`)
		}
		return []byte(sanitizeGenerationAuditJSON(string(body)))
	}
	public, err := PublicSettings()
	if err != nil || !publicModelAllowed(public, taskType, modelName) {
		proxyAILogf("AI proxy model not exposed: model=%s taskType=%s err=%v", modelName, taskType, err)
		proxyFail(w, "模型不可用")
		return
	}
	credits, err := ModelCost(modelName)
	if err != nil {
		proxyAILogf("AI proxy read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	credits = credits.Mul(model.NewDecimal(int64(readAIRequestCount(body, contentType))))
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := resolveUpstreamRequest(channel, modelName, path, body, contentType)
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, resolved.URL, bytes.NewReader(resolved.Body))
	if err != nil {
		proxyAILogf("AI proxy build request failed: url=%s err=%v", redactGenerationAuditString(resolved.URL), err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	// ── 生成任务日志：开始 ──
	provider := DetermineProvider(channel)
	source := DetermineSource(r)
	auditRequestBody := auditBody(requestAuditBody(body, contentType))
	auditRequestHeaders := sanitizeGenerationAuditJSON(sanitizeGenerationAuditHeaders(resolved.Headers))
	genTaskID, err := LogTaskStart(user, taskType, provider, modelName, auditRequestBody, auditRequestHeaders, source, "")
	if err != nil {
		proxyAILogf("AI proxy task log creation failed: user=%s model=%s err=%v", user.ID, modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	// Expose generation task ID to frontend for metadata enrichment
	w.Header().Set("X-Generation-Task-Id", genTaskID)
	startTime := time.Now()

	if err := ConsumeUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
		LogTaskFailure(genTaskID, "INSUFFICIENT_CREDITS", err.Error(), "", time.Since(startTime).Milliseconds(), credits)
		proxyFailError(w, err)
		return
	}
	refund := func() {
		if err := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
			proxyAILogf("AI proxy refund credits failed: user=%s model=%s credits=%s err=%v", user.ID, modelName, credits.String(), err)
		}
	}
	proxyCopyAIResponse(w, request,
		refund,
		func(respBody []byte, respHeaders string) {
			latencyMs := time.Since(startTime).Milliseconds()
			upstreamTaskID := ExtractUpstreamTaskID(respBody)
			auditResponseBody := auditBody(respBody)
			if strings.HasPrefix(path, "/async/images/") {
				task, err := repository.GetGenerationTaskByID(genTaskID)
				if err == nil {
					if ref, terminal := asyncImageTaskRef(respBody, upstreamTaskID); terminal {
						finalizeAsyncImageTask(task, ref, "compatibility-submit", auditResponseBody, respHeaders)
						return
					}
					if upstreamTaskID == "" {
						ref := ProviderTaskRef{Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "UPSTREAM_INVALID_RESPONSE", Message: "上游未返回图片任务 ID", Retryable: false}}
						finalizeAsyncImageTask(task, ref, "compatibility-submit", auditResponseBody, respHeaders)
						return
					}
				}
				LogTaskCreated(genTaskID, upstreamTaskID, latencyMs, credits)
				if err := repository.UpdateGenerationPayload(genTaskID, string(auditResponseBody), respHeaders); err != nil {
					proxyAILogf("AI proxy update async image submit payload failed: task=%s err=%v", genTaskID, err)
				}
				scheduleAsyncImageTaskTimeout(genTaskID, asyncImageTaskTimeout)
				return
			}
			LogTaskSuccess(genTaskID, auditResponseBody, respHeaders, latencyMs, credits, upstreamTaskID)
		},
		func(errCode string, errMsg string, rawError string) {
			latencyMs := time.Since(startTime).Milliseconds()
			if taskType == model.TaskTypeChat {
				rawError = string(auditBody(nil))
				errMsg = "文本模型请求失败"
				var status int
				if _, err := fmt.Sscanf(errCode, "UPSTREAM_%d", &status); err == nil {
					errCode = mapGenerationHTTPError(status).Code
				}
			}
			LogTaskFailure(genTaskID, errCode, errMsg, rawError, latencyMs, credits)
		},
	)
}

// ProxyAIGetRequest 处理 GET 类 AI 代理请求（视频查询/内容）。
func ProxyAIGetRequest(w http.ResponseWriter, r *http.Request, path string) {
	modelName := r.URL.Query().Get("model")
	if strings.TrimSpace(modelName) == "" {
		modelName = "grok-imagine-video"
	}
	if profile, ok := compatibilityProfileForModel(modelName); ok {
		modelName = profile.UpstreamModel
	}
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := resolveUpstreamRequest(channel, modelName, path, nil, "")
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, resolved.URL, nil)
	if err != nil {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	var onSuccess func([]byte, string)
	if task, ok := asyncImageTaskForPoll(r, path, modelName); ok {
		onSuccess = func(respBody []byte, respHeaders string) {
			if ref, terminal := asyncImageTaskRef(respBody, task.UpstreamTaskID); terminal {
				finalizeAsyncImageTask(task, ref, "compatibility-poll", respBody, respHeaders)
			}
		}
	}
	proxyCopyAIResponse(w, request, nil, onSuccess, nil)
}

type upstreamRequest struct {
	URL     string
	Headers http.Header
	Body    []byte
}

func asyncImageTaskForPoll(r *http.Request, path, modelName string) (model.GenerationTask, bool) {
	if !strings.HasPrefix(path, "/tasks/") {
		return model.GenerationTask{}, false
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		return model.GenerationTask{}, false
	}
	upstreamTaskID := strings.TrimSpace(strings.TrimPrefix(path, "/tasks/"))
	task, err := repository.GetGenerationTaskByUpstreamTaskIDAndUser(upstreamTaskID, user.ID)
	return task, err == nil && task.TaskType == model.TaskTypeImage && task.Model == modelName && !isTerminalGenerationStatus(task.Status)
}

func asyncImageTaskRef(body []byte, upstreamTaskID string) (ProviderTaskRef, bool) {
	var payload struct {
		Code   json.RawMessage  `json:"code"`
		Msg    string           `json:"msg"`
		Status string           `json:"status"`
		Data   []map[string]any `json:"data"`
		Result struct {
			Data []map[string]any `json:"data"`
		} `json:"result"`
		Error *struct {
			Code    json.RawMessage `json:"code"`
			Message string          `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return ProviderTaskRef{}, false
	}
	if code := strings.Trim(strings.TrimSpace(string(payload.Code)), `"`); code != "" && code != "0" {
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: code, Message: payload.Msg, Retryable: false}}, true
	}
	if payload.Error != nil && (len(payload.Error.Code) > 0 || strings.TrimSpace(payload.Error.Message) != "") {
		code := strings.Trim(strings.TrimSpace(string(payload.Error.Code)), `"`)
		if code == "" {
			code = "UPSTREAM_REJECTED"
		}
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: code, Message: payload.Error.Message, Retryable: false}}, true
	}
	status := strings.ToLower(strings.TrimSpace(payload.Status))
	if status == "failed" {
		message := strings.TrimSpace(payload.Msg)
		if message == "" {
			message = "图片生成失败"
		}
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: message, Retryable: false}}, true
	}
	if status == "cancelled" || status == "canceled" {
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusCancelled}, true
	}
	imageData := payload.Result.Data
	if imageData == nil {
		imageData = payload.Data
	}
	if imageData != nil {
		for _, item := range imageData {
			if value, ok := item["url"].(string); ok && strings.TrimSpace(value) != "" {
				return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusSucceeded}, true
			}
			if value, ok := item["b64_json"].(string); ok && strings.TrimSpace(value) != "" {
				return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusSucceeded}, true
			}
		}
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "RESULT_FILE_MISSING", Message: "上游任务成功但未返回图片结果", Retryable: false}}, true
	}
	switch status {
	case "completed", "succeeded", "success":
		return ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "RESULT_FILE_MISSING", Message: "上游任务成功但未返回图片结果", Retryable: false}}, true
	default:
		return ProviderTaskRef{}, false
	}
}

func finalizeAsyncImageTask(task model.GenerationTask, ref ProviderTaskRef, source string, body []byte, headers string) {
	auditBody := sanitizeGenerationAuditJSON(string(body))
	auditHeaders := sanitizeGenerationAuditJSON(headers)
	if ref.Error != nil {
		safeError := *ref.Error
		safeError.Message = sanitizeGenerationAuditJSON(safeError.Message)
		ref.Error = &safeError
	}
	if err := repository.UpdateGenerationPayload(task.ID, auditBody, auditHeaders); err != nil {
		proxyAILogf("AI proxy update async image payload failed: task=%s err=%v", task.ID, err)
	}
	if ref.Status == model.TaskStatusFailed || ref.Status == model.TaskStatusCancelled {
		if err := repository.UpdateGenerationPayloadRawError(task.ID, auditBody); err != nil {
			proxyAILogf("AI proxy update async image error failed: task=%s err=%v", task.ID, err)
		}
	}
	if createdAt, err := time.Parse(time.RFC3339Nano, task.CreatedAt); err == nil {
		_ = repository.UpdateGenerationTask(task.ID, map[string]any{"latency_ms": time.Since(createdAt).Milliseconds()})
	}
	if ref.Status == model.TaskStatusSucceeded {
		if _, err := repository.TransitionGenerationTask(task.ID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusPending, model.TaskStatusRunning}, map[string]any{
			"status": string(model.TaskStatusPending), "updated_at": time.Now().UTC().Format(time.RFC3339Nano),
		}); err != nil {
			proxyAILogf("AI proxy mark async image task pending failed: task=%s err=%v", task.ID, err)
		}
		return
	}
	if err := arbitrateGenerationTerminalFrom(task, task.Model, ref, source, "", true, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusPending, model.TaskStatusRunning}); err != nil {
		proxyAILogf("AI proxy finalize async image task failed: task=%s err=%v", task.ID, err)
	}
}

func scheduleAsyncImageTaskTimeout(taskID string, timeout time.Duration) {
	go func() {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		<-timer.C
		task, err := repository.GetGenerationTaskByID(taskID)
		if err != nil || (task.Status != model.TaskStatusRunning && task.Status != model.TaskStatusPending) {
			return
		}
		finalizeAsyncImageTask(task, ProviderTaskRef{
			ID: task.UpstreamTaskID, Status: model.TaskStatusFailed,
			Error: &model.GenerationError{Code: "TASK_SYNC_TIMEOUT", Message: "图片任务状态同步超时", Retryable: false},
		}, "timeout", nil, "")
	}()
}

// resolveUpstreamRequest 按渠道协议构造上游请求。
func resolveUpstreamRequest(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	if channel.Protocol == "gemini" {
		return buildGeminiUpstream(channel, modelName, path, body)
	}
	if channel.Protocol == "xvanai" {
		return buildXvanaiUpstream(channel, modelName, path, body, contentType)
	}
	return buildOpenAIUpstream(channel, modelName, path, body, contentType)
}

func buildGeminiUpstream(channel model.ModelChannel, modelName, path string, body []byte) upstreamRequest {
	action, err := geminiActionFor(path)
	if err != nil {
		return upstreamRequest{URL: ""}
	}
	stream := isGeminiStream(path, body)
	if stream {
		action = "streamGenerateContent"
	}
	var payload map[string]json.RawMessage
	if json.Unmarshal(body, &payload) == nil {
		delete(payload, "model")
		delete(payload, "stream")
		if upstreamBody, marshalErr := json.Marshal(payload); marshalErr == nil {
			body = upstreamBody
		}
	}
	baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
	urlStr := fmt.Sprintf("%s/models/%s:%s?key=%s", baseURL, modelName, action, url.QueryEscape(normalizeModelChannelAPIKey(channel.APIKey)))
	if stream {
		urlStr = fmt.Sprintf("%s/models/%s:%s?alt=sse&key=%s", baseURL, modelName, action, url.QueryEscape(normalizeModelChannelAPIKey(channel.APIKey)))
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	return upstreamRequest{URL: urlStr, Headers: headers, Body: body}
}

// geminiActionFor 把 /api/v1/* 路径映射到 Gemini action。不支持返回 error。
func geminiActionFor(path string) (string, error) {
	switch path {
	case "/chat/completions", "/images/generations", "/images/edits", "/async/images/generations", "/async/images/edits":
		return "generateContent", nil
	case "/audio/speech", "/videos":
		return "", fmt.Errorf("Gemini 协议不支持 %s", path)
	default:
		if strings.HasPrefix(path, "/videos/") {
			return "", fmt.Errorf("Gemini 协议不支持 %s", path)
		}
		return "generateContent", nil
	}
}

// isGeminiStream 仅对 /chat/completions 检测请求体 stream 字段。
func isGeminiStream(path string, body []byte) bool {
	if path != "/chat/completions" {
		return false
	}
	var payload struct {
		Stream bool `json:"stream"`
	}
	_ = json.Unmarshal(body, &payload)
	return payload.Stream
}

// buildXvanaiUpstream 构造 xvanai 协议上游请求，透传实际请求 path（chat/completions、images/generations、contents/generations/tasks 等）。
func buildXvanaiUpstream(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	headers := http.Header{}
	headers.Set("Authorization", modelChannelAuthorization(channel.APIKey))
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return upstreamRequest{
		URL:     BuildModelChannelURL(channel, path),
		Headers: headers,
		Body:    body,
	}
}

func buildOpenAIUpstream(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	path = resolveAIProxyPath(channel.BaseURL, modelName, path)
	if isArkSeedanceVideo(channel.BaseURL, modelName) && strings.HasPrefix(path, "/contents/generations/tasks") {
		body = addSeedanceMediaRoles(body)
	}
	headers := http.Header{}
	headers.Set("Authorization", modelChannelAuthorization(channel.APIKey))
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return upstreamRequest{
		URL:     BuildModelChannelURL(channel, path),
		Headers: headers,
		Body:    body,
	}
}

func addSeedanceMediaRoles(body []byte) []byte {
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return body
	}
	content, ok := payload["content"].([]any)
	if !ok {
		return body
	}
	roles := map[string]string{"image_url": "reference_image", "video_url": "reference_video", "audio_url": "reference_audio"}
	changed := false
	for _, value := range content {
		item, ok := value.(map[string]any)
		if !ok || item["role"] != nil {
			continue
		}
		if role := roles[fmt.Sprint(item["type"])]; role != "" {
			item["role"] = role
			changed = true
		}
	}
	if !changed {
		return body
	}
	result, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return result
}

func resolveAIProxyPath(baseURL string, modelName string, path string) string {
	if !isArkSeedanceVideo(baseURL, modelName) {
		return path
	}
	if path == "/videos" {
		return "/contents/generations/tasks"
	}
	if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
		return "/contents/generations/tasks/" + strings.TrimPrefix(path, "/videos/")
	}
	return path
}

func isArkSeedanceVideo(baseURL string, modelName string) bool {
	base := strings.ToLower(baseURL)
	model := strings.ToLower(modelName)
	return strings.Contains(model, "seedance") || strings.Contains(model, "doubao-seedance") || strings.Contains(base, "/api/plan/v3")
}

// redactUpstreamURL 移除 URL 中的 key= 等敏感查询参数，用于日志。
func redactUpstreamURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := parsed.Query()
	q.Del("key")
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

// proxyCopyAIResponse 执行上游请求并回写响应，同时通过回调通知结果。
// onFailure — 上游返回错误或网络异常时调用（退款回调）。
// onSuccess — 上游成功时调用，流式响应不传入响应体。
// onFailureDetail — 上游失败时调用，传入错误码与脱敏错误信息。
func proxyCopyAIResponse(w http.ResponseWriter, request *http.Request, onFailure func(), onSuccess func(respBody []byte, respHeaders string), onFailureDetail func(errCode string, errMsg string, rawError string)) {
	response, err := aiProxyHTTPClient.Do(request)
	if err != nil {
		safeURL := redactGenerationAuditString(request.URL.String())
		safeError := redactGenerationAuditString(err.Error())
		log.Printf("AI proxy request failed: url=%s err=%s", safeURL, safeError)
		code, message := "NETWORK_ERROR", safeError
		if request.Context().Err() != nil {
			code, message = "CLIENT_CANCELLED", "客户端已取消请求"
		}
		if onFailureDetail != nil {
			onFailureDetail(code, message, safeError)
		}
		if onFailure != nil {
			onFailure()
		}
		proxyFail(w, "AI 接口请求失败")
		return
	}
	defer response.Body.Close()

	respHeaders := sanitizeGenerationAuditJSON(sanitizeGenerationAuditHeaders(response.Header))

	if response.StatusCode >= http.StatusBadRequest {
		respBody, _ := io.ReadAll(response.Body)
		auditBody := sanitizeGenerationAuditJSON(string(respBody))
		log.Printf("AI upstream error: url=%s status=%d", redactGenerationAuditString(request.URL.String()), response.StatusCode)
		code := fmt.Sprintf("UPSTREAM_%d", response.StatusCode)
		errMsg := redactGenerationAuditString(proxyAIUpstreamStatusMessage(response.StatusCode, []byte(auditBody)))
		if onFailureDetail != nil {
			onFailureDetail(code, errMsg, auditBody)
		}
		if onFailure != nil {
			onFailure()
		}
		proxyFail(w, errMsg)
		return
	}

	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	streaming := mediaType == "text/event-stream" || mediaType == "application/x-ndjson" || mediaType == "application/ndjson"
	flusher, canFlush := w.(http.Flusher)
	var failStream func(error)
	if streaming {
		failStream = func(streamErr error) {
			code, message := "STREAM_INTERRUPTED", "流式响应中断"
			if request.Context().Err() != nil {
				code, message, streamErr = "CLIENT_CANCELLED", "客户端已取消请求", request.Context().Err()
			}
			rawError := redactGenerationAuditString(streamErr.Error())
			if onFailureDetail != nil {
				onFailureDetail(code, message, rawError)
			}
			if onFailure != nil {
				onFailure()
			}
		}
		if !canFlush {
			failStream(fmt.Errorf("streaming response writer does not support http.Flusher"))
			proxyFail(w, "AI 接口请求失败")
			return
		}
	}

	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if streaming {
		w.Header().Del("Content-Length")
		w.WriteHeader(response.StatusCode)
		buffer := make([]byte, 32*1024)
		for {
			n, readErr := response.Body.Read(buffer)
			if n > 0 {
				chunk := buffer[:n]
				if _, writeErr := w.Write(chunk); writeErr != nil {
					failStream(writeErr)
					return
				}
				flusher.Flush()
			}
			if readErr == io.EOF {
				if contextErr := request.Context().Err(); contextErr != nil {
					failStream(contextErr)
					return
				}
				if onSuccess != nil {
					onSuccess(nil, respHeaders)
				}
				return
			}
			if readErr != nil {
				failStream(readErr)
				return
			}
		}
	}

	respBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		safeURL := redactGenerationAuditString(request.URL.String())
		safeError := redactGenerationAuditString(readErr.Error())
		log.Printf("AI proxy response read failed: url=%s err=%s", safeURL, safeError)
		code, message := "NETWORK_ERROR", safeError
		if request.Context().Err() != nil {
			code, message = "CLIENT_CANCELLED", "客户端已取消请求"
		}
		if onFailureDetail != nil {
			onFailureDetail(code, message, safeError)
		}
		if onFailure != nil {
			onFailure()
		}
		proxyFail(w, "AI 接口请求失败")
		return
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(respBody)

	if onSuccess != nil {
		onSuccess(respBody, respHeaders)
	}
}

func readAIRequest(r *http.Request) ([]byte, string, string, error) {
	contentType := r.Header.Get("Content-Type")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, "", "", err
	}
	modelName := ""
	if strings.HasPrefix(contentType, "multipart/form-data") {
		modelName = readMultipartModel(body, contentType)
	} else {
		var payload struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &payload)
		modelName = payload.Model
	}
	if strings.TrimSpace(modelName) == "" {
		return nil, "", "", errMissingModel
	}
	return body, contentType, modelName, nil
}

func requestAuditBody(body []byte, contentType string) []byte {
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		return body
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return nil
	}
	defer form.RemoveAll()
	values := make(map[string]string, len(form.Value))
	for key, items := range form.Value {
		if len(items) > 0 {
			values[key] = items[0]
		}
	}
	files := make([]map[string]any, 0)
	for field, items := range form.File {
		for _, item := range items {
			files = append(files, map[string]any{"field": field, "filename": item.Filename, "bytes": item.Size})
		}
	}
	audit, _ := json.Marshal(map[string]any{"fields": values, "files": files})
	return audit
}

func readMultipartModel(body []byte, contentType string) string {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return ""
	}
	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	form, err := reader.ReadForm(32 << 20)
	if err != nil {
		return ""
	}
	defer form.RemoveAll()
	if values := form.Value["model"]; len(values) > 0 {
		return values[0]
	}
	return ""
}

func readAIRequestCount(body []byte, contentType string) int {
	count := 1
	if strings.HasPrefix(contentType, "multipart/form-data") {
		_, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			return count
		}
		form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
		if err != nil {
			return count
		}
		defer form.RemoveAll()
		if values := form.Value["n"]; len(values) > 0 {
			_, _ = fmt.Sscan(values[0], &count)
		}
	} else {
		var payload struct {
			N int `json:"n"`
		}
		_ = json.Unmarshal(body, &payload)
		count = payload.N
	}
	if count < 1 {
		return 1
	}
	return count
}

func proxyAIUpstreamStatusMessage(statusCode int, body []byte) string {
	base := aiStatusMessage(statusCode)
	detail := proxyAIUpstreamErrorDetail(body)
	if detail == "" {
		return base
	}
	return base + "：" + detail
}

func aiStatusMessage(statusCode int) string {
	switch statusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "AI 接口鉴权失败，请检查 API Key、套餐权限或模型权限"
	case http.StatusTooManyRequests:
		return "AI 接口限流或额度不足，请稍后重试或检查额度"
	default:
		return "AI 接口请求失败"
	}
}

func proxyAIUpstreamErrorDetail(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}
	var payload struct {
		Msg     string `json:"msg"`
		Message string `json:"message"`
		Error   struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		if payload.Error.Message != "" {
			if detail := friendlyUpstreamError(payload.Error.Code, payload.Error.Message); detail != "" {
				return safeUpstreamText(detail)
			}
			if payload.Error.Code != "" {
				return safeUpstreamText(payload.Error.Code + " " + payload.Error.Message)
			}
			return safeUpstreamText(payload.Error.Message)
		}
		if payload.Msg != "" {
			return safeUpstreamText(payload.Msg)
		}
		if payload.Message != "" {
			return safeUpstreamText(payload.Message)
		}
	}
	return safeUpstreamText(text)
}

func friendlyUpstreamError(code string, message string) string {
	lowerCode := strings.ToLower(strings.TrimSpace(code))
	if strings.Contains(lowerCode, "inputvideosensitivecontentdetected") || strings.Contains(lowerCode, "privacyinformation") {
		return strings.TrimSpace(code + " 参考视频疑似包含真人或隐私信息，火山方舟拒绝使用普通 URL 作为真人视频参考；请改用不含真人的视频、官方允许的模型产物，或已授权的 asset:// 素材。原始错误：" + message)
	}
	return ""
}

func safeUpstreamText(text string) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	runes := []rune(text)
	if len(runes) > 300 {
		return string(runes[:300]) + "..."
	}
	return text
}

type aiError struct {
	message string
}

func (err *aiError) Error() string {
	return err.message
}

var errMissingModel = &aiError{"缺少模型名称"}

func proxyAILogf(format string, args ...any) {
	log.Printf(format, args...)
}

func proxyFail(w http.ResponseWriter, msg string) {
	// 复用 handler.Fail 的逻辑，但 service 包不能 import handler（会循环）。
	// 直接写 {code:1, data:nil, msg} JSON，HTTP 200。
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "data": nil, "msg": msg})
}

func proxyFailError(w http.ResponseWriter, err error) {
	msg := "操作失败"
	if se, ok := err.(interface{ SafeMessage() string }); ok && se.SafeMessage() != "" {
		msg = se.SafeMessage()
	}
	log.Printf("AI proxy error: %v", err)
	proxyFail(w, msg)
}

// ProxyVideoTaskCreate 处理标准入口 POST /contents/generations/tasks：选渠道、扣算力点、转发上游、失败返还，并记录所有权映射。
func ProxyVideoTaskCreate(w http.ResponseWriter, r *http.Request) {
	proxyVideoTaskPost(w, r, "/contents/generations/tasks")
}

// ProxyVideoTaskRemix 处理标准入口 POST /contents/generations/tasks/:id/remix：同创建计费链路。
func ProxyVideoTaskRemix(w http.ResponseWriter, r *http.Request, path string) {
	proxyVideoTaskPost(w, r, path)
}

// proxyVideoTaskPost POST 类标准入口视频任务：读请求→选渠道→预扣→透传上游→失败返还，同时写入生成任务日志和视频任务所有权映射。
func proxyVideoTaskPost(w http.ResponseWriter, r *http.Request, path string) {
	body, contentType, modelName, err := readAIRequest(r)
	if err != nil {
		proxyAILogf("video task request read failed: %v", err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		proxyFail(w, "未登录或权限不足")
		return
	}
	public, err := PublicSettings()
	if err != nil || !publicModelAllowed(public, model.TaskTypeVideo, modelName) {
		proxyAILogf("video task model not exposed: model=%s err=%v", modelName, err)
		proxyFail(w, "模型不可用")
		return
	}
	profile, durable := compatibilityProfileForModel(modelName)
	upstreamModel := modelName
	billing := generationBillingPlan{Mode: model.BillingModePerCall}
	if durable {
		billing, err = compatibilityGenerationBillingPlanFor(profile, body)
		upstreamModel = profile.UpstreamModel
		body = replaceAIRequestModel(body, upstreamModel)
	} else {
		billing.Credits, err = ModelCost(modelName)
		billing.Rate = billing.Credits
	}
	if err != nil {
		proxyAILogf("video task read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	billing.Credits = billing.Credits.Mul(model.NewDecimal(int64(readAIRequestCount(body, contentType))))
	credits := billing.Credits
	channel, err := SelectModelChannel(upstreamModel)
	if err != nil {
		proxyAILogf("video task select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := buildOpenAIUpstream(channel, upstreamModel, path, body, contentType)
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, resolved.URL, bytes.NewReader(resolved.Body))
	if err != nil {
		proxyAILogf("video task build request failed: url=%s err=%v", redactGenerationAuditString(resolved.URL), err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	// ── 兼容任务：记录与预扣必须同一事务 ──
	taskType := DetermineTaskType(path)
	provider := DetermineProvider(channel)
	auditRequestBody := []byte(sanitizeGenerationAuditJSON(string(requestAuditBody(body, contentType))))
	auditRequestHeaders := sanitizeGenerationAuditJSON(sanitizeGenerationAuditHeaders(resolved.Headers))
	genTaskID, err := StartCompatibilityTask(user, taskType, provider, modelName, auditRequestBody, auditRequestHeaders, DetermineSource(r), billing, path)
	if err != nil {
		proxyFailError(w, err)
		return
	}
	w.Header().Set("X-Generation-Task-Id", genTaskID)
	startTime := time.Now()
	proxyCopyAIResponse(w, request,
		func() {
			if err := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
				proxyAILogf("video task refund credits failed: user=%s model=%s credits=%s err=%v", user.ID, modelName, credits.String(), err)
			}
		},
		func(respBody []byte, respHeaders string) {
			latencyMs := time.Since(startTime).Milliseconds()
			upstreamTaskID := ExtractUpstreamTaskID(respBody)
			auditResponseBody := sanitizeGenerationAuditJSON(string(respBody))
			proxyAILogf("video task created: genTaskID=%s upstreamTaskID=%s latency=%dms", genTaskID, upstreamTaskID, latencyMs)
			if upstreamTaskID == "" {
				if err := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
					proxyAILogf("video task missing-id refund failed: task=%s err=%v", genTaskID, err)
				}
				LogTaskFailure(genTaskID, "UPSTREAM_REJECTED", "上游返回了无效任务", "upstream task id is missing", latencyMs, credits)
				return
			}
			if durable {
				if err := repository.QueueAcceptedCompatibilityTask(genTaskID, upstreamTaskID, channel.Name, profile.AdapterKey, profile.ID, profile.Version, upstreamModel, auditResponseBody, respHeaders, latencyMs, time.Now().UTC()); err != nil {
					proxyAILogf("video task queue durable observation failed: task=%s err=%v", genTaskID, err)
					if refundErr := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); refundErr != nil {
						proxyAILogf("video task queue refund failed: task=%s err=%v", genTaskID, refundErr)
					}
					safeError := redactGenerationAuditString(err.Error())
					LogTaskFailure(genTaskID, "TASK_QUEUE_FAILED", safeError, safeError, latencyMs, credits)
				}
				return
			}
			LogTaskCreated(genTaskID, upstreamTaskID, latencyMs, credits)
			if upstreamTaskID != "" {
				if err := SaveVideoTask(user.ID, upstreamTaskID, modelName); err != nil {
					proxyAILogf("video task save ownership failed: user=%s task=%s err=%v", user.ID, upstreamTaskID, err)
				}
				syncCfg := DefaultTaskSyncConfig()
				syncCfg.GenTaskID = genTaskID
				syncCfg.UpstreamTaskID = upstreamTaskID
				syncCfg.Channel = channel
				SyncTaskStatus(syncCfg)
			}
		},
		func(errCode string, errMsg string, rawError string) {
			latencyMs := time.Since(startTime).Milliseconds()
			LogTaskFailure(genTaskID, errCode, errMsg, rawError, latencyMs, credits)
		},
	)
}

// ProxyVideoTaskDelete 处理标准入口 DELETE /contents/generations/tasks/:id：校验所有权后转发上游，不计费。
func ProxyVideoTaskDelete(w http.ResponseWriter, r *http.Request, path string) {
	// 提取上游 task ID（path 格式：/contents/generations/tasks/{id}）
	parts := strings.Split(strings.TrimPrefix(path, "/contents/generations/tasks/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		proxyFail(w, "缺少任务 ID")
		return
	}
	upstreamTaskID := parts[0]

	// ── 校验所有权 ──
	user, ok := UserFromContext(r.Context())
	if !ok {
		proxyFail(w, "未登录或权限不足")
		return
	}
	if _, err := GetVideoTaskByTaskIDAndUser(upstreamTaskID, user.ID); err != nil {
		proxyAILogf("video task ownership check failed: task=%s user=%s err=%v", upstreamTaskID, user.ID, err)
		proxyFail(w, "任务不存在或无权操作")
		return
	}

	modelName := r.URL.Query().Get("model")
	if strings.TrimSpace(modelName) == "" {
		proxyFail(w, "缺少模型名称")
		return
	}
	if profile, ok := compatibilityProfileForModel(modelName); ok {
		modelName = profile.UpstreamModel
	}
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("video task select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := buildOpenAIUpstream(channel, modelName, path, nil, "")
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodDelete, resolved.URL, nil)
	if err != nil {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	proxyCopyAIResponse(w, request, nil,
		func(_ []byte, _ string) {
			if task, err := repository.GetGenerationTaskByUpstreamTaskIDAndUser(upstreamTaskID, user.ID); err == nil {
				ref := ProviderTaskRef{ID: upstreamTaskID, Status: model.TaskStatusCancelled}
				if err := arbitrateGenerationTerminalFrom(task, task.Model, ref, "compatibility-cancel", "", true, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}); err != nil {
					proxyAILogf("video task cancel arbitration failed: upstreamTask=%s err=%v", upstreamTaskID, err)
				}
				CancelTaskSync(task.ID)
			} else if genTaskID, legacyErr := getGenerationTaskByUpstreamTaskID(upstreamTaskID); legacyErr == nil && genTaskID != "" {
				OnTaskCompleted(genTaskID, model.TaskStatusCancelled, TaskResult{})
				CancelTaskSync(genTaskID)
			}
		},
		nil,
	)
}

func replaceAIRequestModel(body []byte, modelName string) []byte {
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return body
	}
	payload["model"] = modelName
	updated, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return updated
}

// ── Video Task Ownership (thin wrappers around repository) ──────────

// SaveVideoTask 保存视频任务所有权映射。
func SaveVideoTask(userID, taskID, modelName string) error {
	return saveVideoTaskInRepo(userID, taskID, modelName)
}

// GetVideoTaskByTaskIDAndUser 校验用户是否拥有该视频任务。
func GetVideoTaskByTaskIDAndUser(taskID, userID string) (*model.VideoTask, error) {
	if task, err := repository.GetGenerationTaskByUpstreamTaskIDAndUser(taskID, userID); err == nil {
		return &model.VideoTask{UserID: task.UserID, TaskID: task.UpstreamTaskID, Model: task.Model, CreatedAt: task.CreatedAt}, nil
	}
	return getVideoTaskByTaskIDAndUser(taskID, userID)
}
