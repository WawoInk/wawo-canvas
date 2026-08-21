package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
)

type AdapterCreateRequest struct {
	Profile     model.GenerationProfile
	Channel     model.ModelChannel
	Intent      model.GenerationIntent
	References  AdapterMediaReferences
	Metadata    map[string]string
	CallbackURL string
}

type AdapterMediaReferences struct {
	Images []string
	Videos []string
	Audios []string
}

type ProviderTaskRef struct {
	ID       string
	Status   model.TaskStatus
	VideoURL string
	Credits  *model.Decimal
	Shots    []ProviderShot
	Error    *model.GenerationError
	Audit    GenerationAudit
}

type ProviderShot struct {
	Index           int
	DurationSeconds float64
	Status          string
}

type GenerationAudit struct {
	RequestHeaders  string
	RequestBody     string
	ResponseHeaders string
	ResponseBody    string
	RawError        string
}

type GenerationAdapter interface {
	Create(context.Context, AdapterCreateRequest) (ProviderTaskRef, error)
	Poll(context.Context, model.ModelChannel, string) (ProviderTaskRef, error)
	ParseCallback(context.Context, []byte) (ProviderTaskRef, error)
	Cancel(context.Context, model.ModelChannel, string) (ProviderTaskRef, error)
}

type SeedanceContentsV1Adapter struct {
	client *http.Client
}

type SoraVideosV1Adapter struct {
	client *http.Client
}

func NewSeedanceContentsV1Adapter(client *http.Client) SeedanceContentsV1Adapter {
	if client == nil {
		client = http.DefaultClient
	}
	return SeedanceContentsV1Adapter{client: client}
}

func NewSoraVideosV1Adapter(client *http.Client) SoraVideosV1Adapter {
	if client == nil {
		client = http.DefaultClient
	}
	return SoraVideosV1Adapter{client: client}
}

func (a SeedanceContentsV1Adapter) Create(ctx context.Context, req AdapterCreateRequest) (ProviderTaskRef, error) {
	content := []map[string]any{{"type": "text", "text": req.Intent.Prompt}}
	for _, item := range req.References.Images {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]string{"url": item}, "role": "reference_image"})
	}
	for _, item := range req.References.Videos {
		content = append(content, map[string]any{"type": "video_url", "video_url": map[string]string{"url": item}, "role": "reference_video"})
	}
	for _, item := range req.References.Audios {
		content = append(content, map[string]any{"type": "audio_url", "audio_url": map[string]string{"url": item}, "role": "reference_audio"})
	}
	payload := map[string]any{
		"model":          req.Profile.UpstreamModel,
		"content":        content,
		"ratio":          generationSetting(req, "aspectRatio", "adaptive"),
		"resolution":     generationSetting(req, "resolution", "720p"),
		"duration":       generationSetting(req, "durationSeconds", -1),
		"generate_audio": generationSetting(req, "generateAudio", true),
		"watermark":      generationSetting(req, "watermark", false),
	}
	if req.Intent.NegativePrompt != "" {
		payload["metadata"] = map[string]any{"extra_params": map[string]any{"negative_prompt": req.Intent.NegativePrompt}}
	}
	mergeGenerationMetadata(payload, req.Metadata)
	if req.CallbackURL != "" {
		payload["callback_url"] = req.CallbackURL
	}
	return createContentsGenerationTask(ctx, a.client, req.Channel, payload)
}

func (a SoraVideosV1Adapter) Create(ctx context.Context, req AdapterCreateRequest) (ProviderTaskRef, error) {
	metadata := make(map[string]any, len(req.Metadata)+1)
	for key, value := range req.Metadata {
		metadata[key] = value
	}
	metadata["aspect_ratio"] = generationSetting(req, "aspectRatio", "16:9")
	payload := map[string]any{
		"model":    req.Profile.UpstreamModel,
		"prompt":   req.Intent.Prompt,
		"duration": generationSetting(req, "durationSeconds", 4),
		"size":     generationSetting(req, "resolution", "720p"),
		"metadata": metadata,
	}
	if len(req.References.Images) > 0 {
		payload["images"] = req.References.Images
	}
	if len(req.References.Videos) > 0 {
		metadata["video_urls"] = req.References.Videos
	}
	if len(req.References.Audios) > 0 {
		metadata["audio_urls"] = req.References.Audios
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	audit := GenerationAudit{RequestHeaders: `{"Authorization":"[REDACTED]","Content-Type":"application/json"}`, RequestBody: sanitizeGenerationAuditJSON(string(body))}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, BuildModelChannelURL(req.Channel, "/videos"), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{Audit: audit}, err
	}
	request.Header.Set("Authorization", modelChannelAuthorization(req.Channel.APIKey))
	request.Header.Set("Content-Type", "application/json")
	return requestSoraVideoTask(a.client, request, audit, false)
}

type ViduShortDramaV1Adapter struct {
	client *http.Client
}

func NewViduShortDramaV1Adapter(client *http.Client) ViduShortDramaV1Adapter {
	if client == nil {
		client = http.DefaultClient
	}
	return ViduShortDramaV1Adapter{client: client}
}

func (a ViduShortDramaV1Adapter) Create(ctx context.Context, req AdapterCreateRequest) (ProviderTaskRef, error) {
	assets := make([]map[string]any, 0, len(req.Intent.Assets))
	for index, asset := range req.Intent.Assets {
		item := map[string]any{
			"id":        fmt.Sprint(index + 1),
			"type":      asset.Role,
			"name":      asset.Name,
			"image_uri": req.References.Images[index],
		}
		if asset.Description != "" {
			item["description"] = asset.Description
		}
		assets = append(assets, item)
	}
	duration := generationSetting(req, "durationSeconds", "auto")
	if duration == "auto" {
		duration = 0
	}
	payload := map[string]any{
		"model": req.Profile.UpstreamModel, "action": "short-play", "script_name": req.Intent.Title,
		"content": []map[string]any{{"type": "text", "text": req.Intent.Script}}, "assets": assets,
		"duration": duration, "ratio": generationSetting(req, "aspectRatio", "9:16"),
		"resolution": generationSetting(req, "resolution", "1080p"), "quality": generationSetting(req, "quality", "high"),
	}
	mergeGenerationMetadata(payload, req.Metadata)
	if req.CallbackURL != "" {
		payload["callback_url"] = req.CallbackURL
	}
	return createContentsGenerationTask(ctx, a.client, req.Channel, payload)
}

func mergeGenerationMetadata(payload map[string]any, metadata map[string]string) {
	if len(metadata) == 0 {
		return
	}
	merged := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		merged[key] = value
	}
	if existing, ok := payload["metadata"].(map[string]any); ok {
		for key, value := range existing {
			merged[key] = value
		}
	}
	payload["metadata"] = merged
}

func createContentsGenerationTask(ctx context.Context, client *http.Client, channel model.ModelChannel, payload any) (ProviderTaskRef, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	audit := GenerationAudit{RequestHeaders: `{"Authorization":"[REDACTED]","Content-Type":"application/json"}`, RequestBody: sanitizeGenerationAuditJSON(string(body))}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, BuildModelChannelURL(channel, "/contents/generations/tasks"), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{Audit: audit}, err
	}
	request.Header.Set("Authorization", modelChannelAuthorization(channel.APIKey))
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	audit.ResponseHeaders = sanitizeGenerationAuditHeaders(response.Header)
	audit.ResponseBody = sanitizeGenerationAuditJSON(string(responseBody))
	if response.StatusCode >= http.StatusBadRequest {
		ref := ProviderTaskRef{Error: mapGenerationHTTPResponseError(response.StatusCode, responseBody), Audit: audit}
		return ref, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	ref, err := parseContentsGenerationTask(responseBody)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportError(), Audit: audit}, err
	}
	audit.ResponseBody = ref.Audit.ResponseBody
	ref.Audit = audit
	if ref.ID == "" {
		err := fmt.Errorf("upstream task id is missing")
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游返回了无效任务", Retryable: false}, Audit: audit}, err
	}
	return ref, nil
}

func generationSetting(req AdapterCreateRequest, key string, fallback any) any {
	if value, ok := req.Intent.Settings[key]; ok {
		return value
	}
	if definition, ok := req.Profile.Capabilities.Settings[key]; ok && definition.Default != nil {
		return definition.Default
	}
	return fallback
}

func (a ViduShortDramaV1Adapter) Poll(ctx context.Context, channel model.ModelChannel, taskID string) (ProviderTaskRef, error) {
	return pollContentsGenerationTask(ctx, a.client, channel, taskID)
}

func (a SeedanceContentsV1Adapter) Poll(ctx context.Context, channel model.ModelChannel, taskID string) (ProviderTaskRef, error) {
	return pollContentsGenerationTask(ctx, a.client, channel, taskID)
}

func (a SoraVideosV1Adapter) Poll(ctx context.Context, channel model.ModelChannel, taskID string) (ProviderTaskRef, error) {
	audit := GenerationAudit{RequestHeaders: `{"Authorization":"[REDACTED]"}`}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildModelChannelURL(channel, "/videos/"+url.PathEscape(taskID)), nil)
	if err != nil {
		return ProviderTaskRef{Audit: audit}, err
	}
	request.Header.Set("Authorization", modelChannelAuthorization(channel.APIKey))
	return requestSoraVideoTask(a.client, request, audit, true)
}

func (a SeedanceContentsV1Adapter) ParseCallback(_ context.Context, body []byte) (ProviderTaskRef, error) {
	return parseContentsGenerationTask(body)
}

func (a SoraVideosV1Adapter) ParseCallback(_ context.Context, body []byte) (ProviderTaskRef, error) {
	return parseSoraVideoTask(body)
}

func (a ViduShortDramaV1Adapter) ParseCallback(_ context.Context, body []byte) (ProviderTaskRef, error) {
	return parseContentsGenerationTask(body)
}

func (a SeedanceContentsV1Adapter) Cancel(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
	return ProviderTaskRef{}, GenerationOperationError{Code: "CANCEL_UNSUPPORTED", Message: "该模型不支持取消生成任务"}
}

func (a ViduShortDramaV1Adapter) Cancel(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
	return ProviderTaskRef{}, GenerationOperationError{Code: "CANCEL_UNSUPPORTED", Message: "该模型不支持取消生成任务"}
}

func (a SoraVideosV1Adapter) Cancel(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
	return ProviderTaskRef{}, GenerationOperationError{Code: "CANCEL_UNSUPPORTED", Message: "该模型不支持取消生成任务"}
}

func requestSoraVideoTask(client *http.Client, request *http.Request, audit GenerationAudit, polling bool) (ProviderTaskRef, error) {
	response, err := client.Do(request)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	audit.ResponseHeaders = sanitizeGenerationAuditHeaders(response.Header)
	audit.ResponseBody = sanitizeGenerationAuditJSON(string(body))
	if response.StatusCode >= http.StatusBadRequest {
		errorMapper := mapGenerationHTTPResponseError
		if polling {
			errorMapper = mapGenerationPollHTTPResponseError
		}
		return ProviderTaskRef{Error: errorMapper(response.StatusCode, body), Audit: audit}, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	ref, err := parseSoraVideoTask(body)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportError(), Audit: audit}, err
	}
	ref.Audit = audit
	if ref.ID == "" {
		err := fmt.Errorf("upstream task id is missing")
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游返回了无效任务", Retryable: false}, Audit: audit}, err
	}
	return ref, nil
}

func parseSoraVideoTask(body []byte) (ProviderTaskRef, error) {
	var result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		URL    string `json:"url"`
		Output *struct {
			URL string `json:"url"`
		} `json:"output"`
		Metadata *struct {
			URL string `json:"url"`
		} `json:"metadata"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return ProviderTaskRef{Error: generationTransportError(), Audit: GenerationAudit{RawError: err.Error()}}, err
	}
	ref := ProviderTaskRef{ID: result.ID, Status: mapGenerationStatus(result.Status), VideoURL: result.URL, Audit: GenerationAudit{ResponseBody: sanitizeGenerationAuditJSON(string(body))}}
	if ref.VideoURL == "" && result.Output != nil {
		ref.VideoURL = result.Output.URL
	}
	if ref.VideoURL == "" && result.Metadata != nil {
		ref.VideoURL = result.Metadata.URL
	}
	if ref.Status == model.TaskStatusFailed {
		code, message := "", ""
		if result.Error != nil {
			code, message = result.Error.Code, result.Error.Message
		}
		ref.Error = normalizeProviderGenerationError(result.Status, code, message)
	}
	return ref, nil
}

func pollContentsGenerationTask(ctx context.Context, client *http.Client, channel model.ModelChannel, taskID string) (ProviderTaskRef, error) {
	audit := GenerationAudit{RequestHeaders: `{"Authorization":"[REDACTED]"}`}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildModelChannelURL(channel, "/contents/generations/tasks/"+taskID), nil)
	if err != nil {
		return ProviderTaskRef{Audit: audit}, err
	}
	request.Header.Set("Authorization", modelChannelAuthorization(channel.APIKey))
	response, err := client.Do(request)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		audit.RawError = err.Error()
		return ProviderTaskRef{Error: generationTransportErrorFrom(err), Audit: audit}, err
	}
	audit.ResponseHeaders = sanitizeGenerationAuditHeaders(response.Header)
	audit.ResponseBody = sanitizeGenerationAuditJSON(string(body))
	if response.StatusCode >= http.StatusBadRequest {
		ref := ProviderTaskRef{Error: mapGenerationPollHTTPResponseError(response.StatusCode, body), Audit: audit}
		return ref, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	ref, err := parseContentsGenerationTask(body)
	audit.ResponseBody = ref.Audit.ResponseBody
	ref.Audit = audit
	return ref, err
}

func parseContentsGenerationTask(body []byte) (ProviderTaskRef, error) {
	var result struct {
		ID      string         `json:"id"`
		Model   string         `json:"model"`
		Status  string         `json:"status"`
		Credits *model.Decimal `json:"credits"`
		Content *struct {
			VideoURL string `json:"video_url"`
		} `json:"content"`
		Metadata *struct {
			URL string `json:"url"`
		} `json:"metadata"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Task *struct {
			Meta struct {
				ID      string `json:"id"`
				State   string `json:"state"`
				ErrCode string `json:"err_code"`
				ErrMsg  string `json:"err_msg"`
			} `json:"meta"`
			DerivedData struct {
				VideoURL string `json:"signed_final_video_url"`
				Shots    []struct {
					Index    int     `json:"index"`
					Duration float64 `json:"duration"`
					Status   string  `json:"status"`
				} `json:"shots"`
			} `json:"derived_data"`
		} `json:"task"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return ProviderTaskRef{Error: generationTransportError(), Audit: GenerationAudit{RawError: err.Error()}}, err
	}
	status := mapGenerationStatus(result.Status)
	if result.Task != nil && result.Status == "" {
		status = mapGenerationStatus(result.Task.Meta.State)
	}
	id := result.ID
	if id == "" && result.Task != nil {
		id = result.Task.Meta.ID
	}
	ref := ProviderTaskRef{ID: id, Status: status, Credits: result.Credits, Audit: GenerationAudit{ResponseBody: contentsGenerationAuditBody(body, result.Model)}}
	if result.Content != nil {
		ref.VideoURL = result.Content.VideoURL
	}
	if ref.VideoURL == "" && result.Metadata != nil {
		ref.VideoURL = result.Metadata.URL
	}
	if result.Task != nil {
		if ref.VideoURL == "" {
			ref.VideoURL = result.Task.DerivedData.VideoURL
		}
		for _, shot := range result.Task.DerivedData.Shots {
			ref.Shots = append(ref.Shots, ProviderShot{Index: shot.Index, DurationSeconds: shot.Duration, Status: shot.Status})
		}
	}
	if ref.Status == model.TaskStatusFailed {
		code, message := "", ""
		if result.Error != nil {
			code, message = result.Error.Code, result.Error.Message
		}
		if result.Task != nil {
			if code == "" {
				code = result.Task.Meta.ErrCode
			}
			if message == "" {
				message = result.Task.Meta.ErrMsg
			}
		}
		ref.Error = normalizeProviderGenerationError(result.Status, code, message)
	}
	return ref, nil
}

func contentsGenerationAuditBody(body []byte, modelName string) string {
	if !strings.Contains(strings.ToLower(modelName), "vidu") {
		return sanitizeGenerationAuditJSON(string(body))
	}
	var value map[string]any
	if json.Unmarshal(body, &value) != nil {
		return sanitizeGenerationAuditJSON(string(body))
	}
	if _, ok := value["credits"]; !ok {
		value["credits"] = nil
	}
	normalized, _ := json.Marshal(value)
	return sanitizeGenerationAuditJSON(string(normalized))
}

func generationTransportError() *model.GenerationError {
	return &model.GenerationError{Code: "UPSTREAM_UNAVAILABLE", Message: "上游服务暂时不可用", Retryable: true}
}

func generationTransportErrorFrom(err error) *model.GenerationError {
	var networkError net.Error
	message := ""
	if err != nil {
		message = strings.ToLower(err.Error())
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &networkError) && networkError.Timeout() || strings.Contains(message, "timeout") || strings.Contains(message, "timed out") || strings.Contains(message, "deadline exceeded") {
		return &model.GenerationError{Code: "UPSTREAM_TIMEOUT", Message: "上游请求超时", Retryable: true}
	}
	return generationTransportError()
}

func normalizeProviderGenerationError(status, code, message string) *model.GenerationError {
	text := strings.ToLower(strings.TrimSpace(status + " " + code + " " + message))
	switch {
	case strings.Contains(text, "timeout"), strings.Contains(text, "timed out"), strings.Contains(text, "deadline"), strings.Contains(text, "expired"):
		return &model.GenerationError{Code: "UPSTREAM_TIMEOUT", Message: "上游视频生成超时", Retryable: false}
	case strings.Contains(text, "rate limit"), strings.Contains(text, "rate_limit"), strings.Contains(text, "too many requests"), strings.Contains(text, "over quota"):
		return &model.GenerationError{Code: "UPSTREAM_RATE_LIMITED", Message: "上游服务限流", Retryable: true}
	case strings.Contains(text, "unauthorized"), strings.Contains(text, "authentication"), strings.Contains(text, "invalid api key"), strings.Contains(text, "invalid_api_key"):
		return &model.GenerationError{Code: "UPSTREAM_AUTH_FAILED", Message: "上游服务认证失败", Retryable: false}
	case strings.Contains(text, "forbidden"), strings.Contains(text, "permission denied"), strings.Contains(text, "access denied"), strings.Contains(text, "access_denied"):
		return &model.GenerationError{Code: "UPSTREAM_PERMISSION_DENIED", Message: "上游服务拒绝访问", Retryable: false}
	case strings.Contains(text, "sensitive"), strings.Contains(text, "content policy"), strings.Contains(text, "moderation"), strings.Contains(text, "safety"), strings.Contains(text, "privacy"), strings.Contains(text, "nsfw"), strings.Contains(text, "prohibited"):
		return &model.GenerationError{Code: "CONTENT_REJECTED", Message: "生成内容未通过上游安全审核", Retryable: false}
	case strings.Contains(text, "invalid"), strings.Contains(text, "parameter"), strings.Contains(text, "argument"), strings.Contains(text, "unsupported"), strings.Contains(text, "too long"), strings.Contains(text, "too short"), strings.Contains(text, "required"):
		return &model.GenerationError{Code: "INVALID_REQUEST", Message: "生成参数或输入不符合上游要求", Retryable: false}
	case strings.Contains(text, "unavailable"), strings.Contains(text, "overloaded"), strings.Contains(text, "internal error"), strings.Contains(text, "connection"):
		return generationTransportError()
	default:
		return &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游拒绝了生成请求", Retryable: false}
	}
}

func mapGenerationHTTPError(status int) *model.GenerationError {
	switch status {
	case http.StatusUnauthorized:
		return &model.GenerationError{Code: "UPSTREAM_AUTH_FAILED", Message: "上游服务认证失败", Retryable: false}
	case http.StatusForbidden:
		return &model.GenerationError{Code: "UPSTREAM_PERMISSION_DENIED", Message: "上游服务拒绝访问", Retryable: false}
	case http.StatusNotFound:
		return &model.GenerationError{Code: "UPSTREAM_NOT_FOUND", Message: "上游任务或生成接口不存在", Retryable: false}
	case http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity:
		return &model.GenerationError{Code: "INVALID_REQUEST", Message: "生成参数或输入不符合上游要求", Retryable: false}
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return &model.GenerationError{Code: "UPSTREAM_TIMEOUT", Message: "上游请求超时", Retryable: true}
	case http.StatusTooManyRequests:
		return &model.GenerationError{Code: "UPSTREAM_RATE_LIMITED", Message: "上游服务限流", Retryable: true}
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
		return generationTransportError()
	default:
		return &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游拒绝了生成请求", Retryable: false}
	}
}

func mapGenerationHTTPResponseError(status int, body []byte) *model.GenerationError {
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
		Error   *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil {
		code, message := payload.Code, payload.Message
		if message == "" {
			message = payload.Msg
		}
		if payload.Error != nil {
			if payload.Error.Code != "" {
				code = payload.Error.Code
			}
			if payload.Error.Message != "" {
				message = payload.Error.Message
			}
		}
		if normalized := normalizeProviderGenerationError("", code, message); normalized.Code != "UPSTREAM_REJECTED" {
			return normalized
		}
	}
	return mapGenerationHTTPError(status)
}

func mapGenerationPollHTTPResponseError(status int, body []byte) *model.GenerationError {
	if status == http.StatusConflict {
		return generationTransportError()
	}
	return mapGenerationHTTPResponseError(status, body)
}

func sanitizeGenerationAuditHeaders(headers http.Header) string {
	values := make(map[string]any, len(headers))
	for key, items := range headers {
		if isGenerationSecretKey(key) {
			values[key] = "[REDACTED]"
		} else {
			values[key] = items
		}
	}
	body, _ := json.Marshal(values)
	return string(body)
}

func sanitizeGenerationAuditJSON(raw string) string {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return redactGenerationAuditString(raw)
	}
	value = sanitizeGenerationAuditValue("", value)
	body, _ := json.Marshal(value)
	return string(body)
}

func sanitizeGenerationAuditValue(key string, value any) any {
	if isGenerationSecretKey(key) {
		return "[REDACTED]"
	}
	switch current := value.(type) {
	case map[string]any:
		for childKey, childValue := range current {
			current[childKey] = sanitizeGenerationAuditValue(childKey, childValue)
		}
		return current
	case []any:
		for index, childValue := range current {
			current[index] = sanitizeGenerationAuditValue(key, childValue)
		}
		return current
	case string:
		return redactGenerationAuditString(current)
	default:
		return value
	}
}

func isGenerationSecretKey(key string) bool {
	key = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", ""), "_", ""))
	return key == "authorization" || strings.Contains(key, "apikey") || strings.Contains(key, "callbacksecret")
}

var generationAuditURLPattern = regexp.MustCompile(`https?://[^\s"']+`)
var generationAuditAuthorizationPattern = regexp.MustCompile(`(?i)authorization:\s*bearer\s+[^\s"']+`)

func redactGenerationAuditString(value string) string {
	if strings.HasPrefix(value, "data:") {
		if marker := strings.Index(value, ","); marker >= 0 {
			return value[:marker+1] + "[REDACTED]"
		}
		return "data:[REDACTED]"
	}
	if redacted, ok := redactGenerationAuditURL(value); ok {
		return redacted
	}
	value = generationAuditAuthorizationPattern.ReplaceAllString(value, "Authorization: [REDACTED]")
	return generationAuditURLPattern.ReplaceAllStringFunc(value, func(candidate string) string {
		trimmed := strings.TrimRight(candidate, ".,;:)")
		suffix := candidate[len(trimmed):]
		if redacted, ok := redactGenerationAuditURL(trimmed); ok {
			return redacted + suffix
		}
		return candidate
	})
}

func redactGenerationAuditURL(value string) (string, bool) {
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.RawQuery == "" {
		return value, false
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		query = url.Values{"redacted": {"[REDACTED]"}}
	} else {
		for key := range query {
			query[key] = []string{"[REDACTED]"}
		}
	}
	parsed.RawQuery = query.Encode()
	parsed.ForceQuery = false
	return parsed.String(), true
}

func mapGenerationStatus(status string) model.TaskStatus {
	switch status {
	case "queued", "running", "processing", "in_progress":
		return model.TaskStatusRunning
	case "succeeded", "success", "completed":
		return model.TaskStatusSucceeded
	case "failed", "expired":
		return model.TaskStatusFailed
	case "cancelled":
		return model.TaskStatusCancelled
	default:
		return model.TaskStatusRunning
	}
}
