package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

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
	credits, err := ModelCost(modelName)
	if err != nil {
		proxyAILogf("AI proxy read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	credits *= readAIRequestCount(body, contentType)
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
	request, err := http.NewRequest(http.MethodPost, resolved.URL, bytes.NewReader(body))
	if err != nil {
		proxyAILogf("AI proxy build request failed: url=%s err=%v", resolved.URL, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	// ── 生成任务日志：开始 ──
	taskType := DetermineTaskType(path)
	provider := DetermineProvider(channel)
	source := DetermineSource(r)
	genTaskID, _ := LogTaskStart(user, taskType, provider, modelName, body, SerializeHeaders(resolved.Headers), source, "")
	startTime := time.Now()

	if err := ConsumeUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
		LogTaskFailure(genTaskID, "INSUFFICIENT_CREDITS", err.Error(), "", time.Since(startTime).Milliseconds(), credits)
		proxyFailError(w, err)
		return
	}
	proxyCopyAIResponse(w, request,
		func() {
			if err := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
				proxyAILogf("AI proxy refund credits failed: user=%s model=%s credits=%d err=%v", user.ID, modelName, credits, err)
			}
		},
		func(respBody []byte, respHeaders string) {
			latencyMs := time.Since(startTime).Milliseconds()
			upstreamTaskID := ExtractUpstreamTaskID(respBody)
			LogTaskSuccess(genTaskID, respBody, respHeaders, latencyMs, credits, upstreamTaskID)
		},
		func(errCode string, errMsg string, rawError string) {
			latencyMs := time.Since(startTime).Milliseconds()
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
	request, err := http.NewRequest(http.MethodGet, resolved.URL, nil)
	if err != nil {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	proxyCopyAIResponse(w, request, nil, nil, nil)
}

type upstreamRequest struct {
	URL     string
	Headers http.Header
	Body    []byte
}

// resolveUpstreamRequest 按渠道协议构造上游请求。
func resolveUpstreamRequest(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	if channel.Protocol == "gemini" {
		return buildGeminiUpstream(channel, modelName, path, body)
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
	baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
	urlStr := fmt.Sprintf("%s/models/%s:%s?key=%s", baseURL, modelName, action, url.QueryEscape(channel.APIKey))
	if stream {
		urlStr = fmt.Sprintf("%s/models/%s:%s?alt=sse&key=%s", baseURL, modelName, action, url.QueryEscape(channel.APIKey))
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	return upstreamRequest{URL: urlStr, Headers: headers, Body: body}
}

// geminiActionFor 把 /api/v1/* 路径映射到 Gemini action。不支持返回 error。
func geminiActionFor(path string) (string, error) {
	switch path {
	case "/chat/completions", "/images/generations", "/images/edits":
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

func buildOpenAIUpstream(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	path = resolveAIProxyPath(channel.BaseURL, modelName, path)
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+channel.APIKey)
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return upstreamRequest{
		URL:     BuildModelChannelURL(channel, path),
		Headers: headers,
		Body:    body,
	}
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
// onSuccess — 上游成功时调用，传入完整响应体与序列化响应头。
// onFailureDetail — 上游返回 >=400 时调用，传入错误码与消息。
func proxyCopyAIResponse(w http.ResponseWriter, request *http.Request, onFailure func(), onSuccess func(respBody []byte, respHeaders string), onFailureDetail func(errCode string, errMsg string, rawError string)) {
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		log.Printf("AI proxy request failed: url=%s err=%v", redactUpstreamURL(request.URL.String()), err)
		if onFailureDetail != nil {
			onFailureDetail("NETWORK_ERROR", err.Error(), err.Error())
		}
		if onFailure != nil {
			onFailure()
		}
		proxyFail(w, "AI 接口请求失败")
		return
	}
	defer response.Body.Close()

	respBody, _ := io.ReadAll(response.Body)
	respHeaders := headerToJSON(response.Header)

	if response.StatusCode >= http.StatusBadRequest {
		log.Printf("AI upstream error: url=%s status=%d", redactUpstreamURL(request.URL.String()), response.StatusCode)
		code := fmt.Sprintf("UPSTREAM_%d", response.StatusCode)
		errMsg := proxyAIUpstreamStatusMessage(response.StatusCode, respBody)
		if onFailureDetail != nil {
			onFailureDetail(code, errMsg, string(respBody))
		}
		if onFailure != nil {
			onFailure()
		}
		proxyFail(w, errMsg)
		return
	}

	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(respBody)

	if onSuccess != nil {
		onSuccess(respBody, respHeaders)
	}
}

// headerToJSON 将 http.Header 转为简单 JSON 字符串。
func headerToJSON(headers http.Header) string {
	m := make(map[string]string, len(headers))
	for key := range headers {
		m[key] = headers.Get(key)
	}
	data, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(data)
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
	credits, err := ModelCost(modelName)
	if err != nil {
		proxyAILogf("video task read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	credits *= readAIRequestCount(body, contentType)
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("video task select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := buildOpenAIUpstream(channel, modelName, path, body, contentType)
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequest(http.MethodPost, resolved.URL, bytes.NewReader(body))
	if err != nil {
		proxyAILogf("video task build request failed: url=%s err=%v", resolved.URL, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	// ── 生成任务日志：开始 ──
	taskType := DetermineTaskType(path)
	provider := DetermineProvider(channel)
	genTaskID, _ := LogTaskStart(user, taskType, provider, modelName, body, SerializeHeaders(resolved.Headers), string(model.SourceVideoWorkbench), "")
	startTime := time.Now()

	if err := ConsumeUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
		LogTaskFailure(genTaskID, "INSUFFICIENT_CREDITS", err.Error(), "", time.Since(startTime).Milliseconds(), credits)
		proxyFailError(w, err)
		return
	}
	proxyCopyAIResponse(w, request,
		func() {
			if err := RefundUserCreditsWithTask(user.ID, modelName, credits, path, genTaskID); err != nil {
				proxyAILogf("video task refund credits failed: user=%s model=%s credits=%d err=%v", user.ID, modelName, credits, err)
			}
		},
		func(respBody []byte, respHeaders string) {
			latencyMs := time.Since(startTime).Milliseconds()
			upstreamTaskID := ExtractUpstreamTaskID(respBody)
			proxyAILogf("video task created: genTaskID=%s upstreamTaskID=%s latency=%dms", genTaskID, upstreamTaskID, latencyMs)
			// Async task — created but still running; poll to completion
			LogTaskCreated(genTaskID, upstreamTaskID, latencyMs, credits)
			// ── 视频任务所有权映射 ──
			if upstreamTaskID != "" {
				if err := SaveVideoTask(user.ID, upstreamTaskID, modelName); err != nil {
					proxyAILogf("video task save ownership failed: user=%s task=%s err=%v", user.ID, upstreamTaskID, err)
				}
			}
			// ── 启动异步状态同步 ──
			if upstreamTaskID != "" {
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
	request, err := http.NewRequest(http.MethodDelete, resolved.URL, nil)
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
			LogTaskCancelled(upstreamTaskID)
			// ── 取消异步状态同步 ──
			if genTaskID, err := getGenerationTaskByUpstreamTaskID(upstreamTaskID); err == nil && genTaskID != "" {
				CancelTaskSync(genTaskID)
			}
		},
		nil,
	)
}

// ── Video Task Ownership (thin wrappers around repository) ──────────

// SaveVideoTask 保存视频任务所有权映射。
func SaveVideoTask(userID, taskID, modelName string) error {
	return saveVideoTaskInRepo(userID, taskID, modelName)
}

// GetVideoTaskByTaskIDAndUser 校验用户是否拥有该视频任务。
func GetVideoTaskByTaskIDAndUser(taskID, userID string) (*model.VideoTask, error) {
	return getVideoTaskByTaskIDAndUser(taskID, userID)
}
