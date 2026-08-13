package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func TestModelProfilesExposeVideoAdaptersWithoutSecrets(t *testing.T) {
	previous := listGenerationProfiles
	defer func() { listGenerationProfiles = previous }()
	listGenerationProfiles = func() ([]model.GenerationProfile, error) {
		return service.GenerationProfiles(), nil
	}

	req := httptest.NewRequest("GET", "/api/v1/model-profiles", nil)
	req = req.WithContext(service.WithUser(req.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	res := httptest.NewRecorder()

	ModelProfiles(res, req)

	var body struct {
		Code int                       `json:"code"`
		Data []model.GenerationProfile `json:"data"`
		Msg  string                    `json:"msg"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("code = %d, want 0; body=%s", body.Code, res.Body.String())
	}
	if len(body.Data) != 3 {
		t.Fatalf("profiles = %d, want 3", len(body.Data))
	}
	profile := body.Data[0]
	if profile.ID != "seedance-1-5-pro" || profile.AdapterKey != "seedance-contents-v1" {
		t.Fatalf("profile = %#v", profile)
	}
	if len(profile.Intents) != 1 || profile.Intents[0] != model.IntentVideoGenerate {
		t.Fatalf("intents = %#v, want video.generate", profile.Intents)
	}
	settings := profile.Capabilities.Settings
	if len(settings) != 5 || settings["aspectRatio"].Default != "adaptive" || settings["resolution"].Default != "720p" || settings["durationSeconds"].Default != float64(-1) || settings["generateAudio"].Default != true || settings["watermark"].Default != false {
		t.Fatalf("settings = %#v", settings)
	}
	if profile.Capabilities.Cancellation || len(profile.Capabilities.Completion) != 1 || profile.Capabilities.Completion[0] != "poll" {
		t.Fatalf("lifecycle capabilities = %#v", profile.Capabilities)
	}
	drama := body.Data[1]
	if drama.ID != "vidu-q3-drama" || drama.AdapterKey != "vidu-short-drama-v1" || len(drama.Intents) != 1 || drama.Intents[0] != model.IntentVideoShortDrama {
		t.Fatalf("drama profile = %#v", drama)
	}
	if drama.Capabilities.Cancellation || len(drama.Capabilities.Completion) != 2 || drama.Capabilities.Completion[0] != "callback" || drama.Capabilities.Completion[1] != "poll" {
		t.Fatalf("drama lifecycle capabilities = %#v", drama.Capabilities)
	}
	if drama.Capabilities.Title == nil || drama.Capabilities.Title.MaxLength != 20 || drama.Capabilities.Script == nil || drama.Capabilities.Script.MinLength != 20 || drama.Capabilities.Assets == nil || drama.Capabilities.Assets.Max != 14 || len(drama.Capabilities.Assets.Roles) != 3 || drama.Capabilities.Settings["durationSeconds"].Default != "auto" {
		t.Fatalf("drama capabilities = %#v", drama.Capabilities)
	}
	sora := body.Data[2]
	if sora.ID != "sora-2" || sora.AdapterKey != "sora-videos-v1" || len(sora.Intents) != 1 || sora.Intents[0] != model.IntentVideoGenerate {
		t.Fatalf("sora profile = %#v", sora)
	}
	if sora.Capabilities.Cancellation || len(sora.Capabilities.Completion) != 1 || sora.Capabilities.Completion[0] != "poll" || sora.Capabilities.Settings["aspectRatio"].Default != "16:9" || sora.Capabilities.Settings["resolution"].Default != "720p" || sora.Capabilities.Settings["durationSeconds"].Default != float64(4) {
		t.Fatalf("sora capabilities = %#v", sora.Capabilities)
	}
	payload := res.Body.String()
	for _, secret := range []string{"apiKey", "baseUrl", "channelId", "upstreamModel"} {
		if strings.Contains(payload, secret) {
			t.Fatalf("public profile leaked %q: %s", secret, payload)
		}
	}
}

func TestCreateGenerationReturnsLocatableValidationError(t *testing.T) {
	previous := createGeneration
	defer func() { createGeneration = previous }()
	createGeneration = func(_ context.Context, _ model.AuthUser, _ model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
		return model.FirstPartyGenerationTask{}, service.NewGenerationValidationError("INVALID_COMMAND", "intent.assets.0.role", "请选择资产角色", false, "image-1")
	}
	req := httptest.NewRequest("POST", "/api/v1/generations", strings.NewReader(`{
		"commandVersion":1,"clientRequestId":"request-invalid","modelProfileId":"seedance-1-5-pro","source":"canvas",
		"intent":{"kind":"video.generate","prompt":"invalid","settings":{"resolution":"4k"}}
	}`))
	req = req.WithContext(service.WithUser(req.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	res := httptest.NewRecorder()

	CreateGeneration(res, req)

	var body struct {
		Code int `json:"code"`
		Data struct {
			ErrorCode  string `json:"code"`
			Retryable  bool   `json:"retryable"`
			FieldPath  string `json:"fieldPath"`
			ResourceID string `json:"resourceId"`
		} `json:"data"`
		Msg string `json:"msg"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 1 || body.Msg != "请选择资产角色" || body.Data.ErrorCode != "INVALID_COMMAND" || body.Data.Retryable || body.Data.FieldPath != "intent.assets.0.role" || body.Data.ResourceID != "image-1" {
		t.Fatalf("response = %s", res.Body.String())
	}
}

func TestCancelGenerationReturnsStableOperationError(t *testing.T) {
	previous := cancelGeneration
	defer func() { cancelGeneration = previous }()
	cancelGeneration = func(context.Context, string, string) (model.FirstPartyGenerationTask, error) {
		return model.FirstPartyGenerationTask{}, service.GenerationOperationError{Code: "CANCEL_UNSUPPORTED", Message: "该模型不支持取消生成任务"}
	}
	req := httptest.NewRequest("POST", "/api/v1/generations/task-1/cancel", nil)
	req = req.WithContext(service.WithUser(req.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	res := httptest.NewRecorder()
	CancelGeneration(res, req, "task-1")
	if !strings.Contains(res.Body.String(), `"code":"CANCEL_UNSUPPORTED"`) || !strings.Contains(res.Body.String(), "该模型不支持取消生成任务") {
		t.Fatalf("response=%s", res.Body.String())
	}
}

func TestGenerationCallbackRejectsInvalidToken(t *testing.T) {
	previous := handleGenerationCallback
	defer func() { handleGenerationCallback = previous }()
	handleGenerationCallback = func(context.Context, string, []byte) error {
		return service.GenerationOperationError{Code: "CALLBACK_UNAUTHORIZED", Message: "无效的回调令牌"}
	}
	res := httptest.NewRecorder()
	GenerationCallback(res, httptest.NewRequest("POST", "/api/v1/generations/callback?token=wrong", strings.NewReader(`{"status":"failed"}`)))
	if !strings.Contains(res.Body.String(), `"code":"CALLBACK_UNAUTHORIZED"`) {
		t.Fatalf("response=%s", res.Body.String())
	}
}

func TestCreateGenerationPassesPlatformReferences(t *testing.T) {
	previous := createGeneration
	defer func() { createGeneration = previous }()

	var got model.GenerationCommand
	createGeneration = func(_ context.Context, _ model.AuthUser, command model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
		got = command
		return model.FirstPartyGenerationTask{ID: "gen-media", Status: model.TaskStatusQueued}, nil
	}
	req := httptest.NewRequest("POST", "/api/v1/generations", strings.NewReader(`{
		"commandVersion":1,"clientRequestId":"request-media","modelProfileId":"seedance-1-5-pro","source":"canvas",
		"intent":{"kind":"video.generate","prompt":"组合素材","references":{"images":[{"fileId":"image-1","sourceNodeId":"node-1","name":"参考图"}],"videos":[{"fileId":"video-1"}],"audios":[{"fileId":"audio-1"}]},"settings":{"aspectRatio":"9:16","resolution":"1080p","durationSeconds":10,"generateAudio":false,"watermark":true}}
	}`))
	req = req.WithContext(service.WithUser(req.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	res := httptest.NewRecorder()

	CreateGeneration(res, req)

	if got.Intent.References.Images[0].FileID != "image-1" || got.Intent.References.Videos[0].FileID != "video-1" || got.Intent.References.Audios[0].FileID != "audio-1" {
		t.Fatalf("references = %#v", got.Intent.References)
	}
	if got.Intent.Settings["aspectRatio"] != "9:16" || got.Intent.Settings["durationSeconds"] != float64(10) || got.Intent.Settings["generateAudio"] != false {
		t.Fatalf("settings = %#v", got.Intent.Settings)
	}
}

func TestCreateGenerationAcceptsPromptOnlyVideoCommand(t *testing.T) {
	previous := createGeneration
	defer func() { createGeneration = previous }()

	var gotUser model.AuthUser
	var gotCommand model.GenerationCommand
	createGeneration = func(_ context.Context, user model.AuthUser, command model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
		gotUser = user
		gotCommand = command
		return model.FirstPartyGenerationTask{
			ID:             "gen-1",
			Status:         model.TaskStatusQueued,
			ModelProfileID: "seedance-1-5-pro",
			IntentKind:     model.IntentVideoGenerate,
			CreatedAt:      "2026-07-15T10:00:00Z",
		}, nil
	}

	req := httptest.NewRequest("POST", "/api/v1/generations", strings.NewReader(`{
		"commandVersion": 1,
		"clientRequestId": "request-1",
		"modelProfileId": "seedance-1-5-pro",
		"source": "canvas",
		"intent": {"kind": "video.generate", "prompt": "人物走进雨夜街道"}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(service.WithUser(req.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	res := httptest.NewRecorder()

	CreateGeneration(res, req)

	var body struct {
		Code int                            `json:"code"`
		Data model.FirstPartyGenerationTask `json:"data"`
		Msg  string                         `json:"msg"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || body.Data.ID != "gen-1" || body.Data.Status != model.TaskStatusQueued {
		t.Fatalf("response = %s", res.Body.String())
	}
	if gotUser.ID != "user-1" {
		t.Fatalf("user = %#v", gotUser)
	}
	if gotCommand.CommandVersion != 1 || gotCommand.ClientRequestID != "request-1" || gotCommand.ModelProfileID != "seedance-1-5-pro" || gotCommand.Source != string(model.SourceCanvas) {
		t.Fatalf("command = %#v", gotCommand)
	}
	if gotCommand.Intent.Kind != model.IntentVideoGenerate || gotCommand.Intent.Prompt != "人物走进雨夜街道" {
		t.Fatalf("intent = %#v", gotCommand.Intent)
	}
}
