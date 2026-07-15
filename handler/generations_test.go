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

func TestModelProfilesExposeSeedanceWithoutSecrets(t *testing.T) {
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
	if len(body.Data) != 1 {
		t.Fatalf("profiles = %d, want 1", len(body.Data))
	}
	profile := body.Data[0]
	if profile.ID != "seedance-1-5-pro" || profile.AdapterKey != "seedance-contents-v1" {
		t.Fatalf("profile = %#v", profile)
	}
	if len(profile.Intents) != 1 || profile.Intents[0] != model.IntentVideoGenerate {
		t.Fatalf("intents = %#v, want video.generate", profile.Intents)
	}
	payload := res.Body.String()
	for _, secret := range []string{"apiKey", "baseUrl", "channelId", "upstreamModel"} {
		if strings.Contains(payload, secret) {
			t.Fatalf("public profile leaked %q: %s", secret, payload)
		}
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
