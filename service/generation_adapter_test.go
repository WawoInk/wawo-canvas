package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestCreateGenerationRejectsForeignMedia(t *testing.T) {
	previousProfiles := generationProfiles
	defer func() { generationProfiles = previousProfiles }()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-media", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-media", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}}}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	fileID := "foreign-file-" + uuid.NewString()
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: "other-user", FileType: "images", S3Key: "images/other/file.png", OriginalName: "file.png", MimeType: "image/png", CreatedAt: now}); err != nil {
		t.Fatalf("create file: %v", err)
	}
	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "current-user"}, model.GenerationCommand{
		CommandVersion:  1,
		ClientRequestID: "request-foreign-" + uuid.NewString(),
		ModelProfileID:  "seedance-media",
		Source:          string(model.SourceCanvas),
		Intent:          model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "test", References: model.GenerationReferences{Images: []model.MediaReference{{FileID: fileID, SourceNodeID: "node-1"}}}},
	})
	if !errors.Is(err, ErrGenerationMediaForbidden) {
		t.Fatalf("error = %v, want media forbidden", err)
	}
}

func TestCreateGenerationRejectsIdempotentCommandConflict(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-conflict", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-conflict", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: "http://127.0.0.1:1", APIKey: "secret", Enabled: true}, nil
	}
	key := uuid.NewString()
	user := model.AuthUser{ID: "user-conflict-" + key}
	first := model.GenerationCommand{CommandVersion: 1, ClientRequestID: "request-conflict-" + key, ModelProfileID: "seedance-conflict", Source: string(model.SourceCanvas), Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "first"}}
	if _, err := CreateGeneration(context.Background(), user, first); err != nil {
		t.Fatalf("first CreateGeneration: %v", err)
	}
	second := first
	second.Intent.Prompt = "different"
	if _, err := CreateGeneration(context.Background(), user, second); !errors.Is(err, ErrGenerationCommandConflict) {
		t.Fatalf("second error = %v, want conflict", err)
	}
}

func TestCreateGenerationReusesIdempotentCommand(t *testing.T) {
	var creates atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			creates.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"upstream-idempotent","status":"succeeded","content":{"video_url":"https://example.com/result.mp4"}}`))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousCost := generationCost
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-idempotent", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-idempotent", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	key := uuid.NewString()
	command := model.GenerationCommand{
		CommandVersion:  1,
		ClientRequestID: "request-idempotent-" + key,
		ModelProfileID:  "seedance-idempotent",
		Source:          string(model.SourceCanvas),
		Intent:          model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "人物走进雨夜街道"},
	}
	user := model.AuthUser{ID: "user-idempotent-" + key}
	first, err := CreateGeneration(context.Background(), user, command)
	if err != nil {
		t.Fatalf("first CreateGeneration: %v", err)
	}
	second, err := CreateGeneration(context.Background(), user, command)
	if err != nil {
		t.Fatalf("second CreateGeneration: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("task ids = %q, %q", first.ID, second.ID)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if creates.Load() == 1 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("upstream creates = %d, want 1", creates.Load())
}

func TestCreateGenerationRunsPromptOnlySeedanceTask(t *testing.T) {
	var polls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/contents/generations/tasks":
			_, _ = w.Write([]byte(`{"id":"upstream-orchestrated","status":"queued"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/contents/generations/tasks/upstream-orchestrated":
			polls++
			_, _ = w.Write([]byte(`{"id":"upstream-orchestrated","status":"succeeded","content":{"video_url":"https://example.com/result.mp4"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousCost := generationCost
	previousPollInterval := generationPollInterval
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPollInterval = previousPollInterval
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-test", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-test", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationPollInterval = time.Millisecond
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	key := uuid.NewString()
	userID := "user-orchestrator-" + key
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion:  1,
		ClientRequestID: "request-orchestrator-" + key,
		ModelProfileID:  "seedance-test",
		Source:          string(model.SourceCanvas),
		Intent:          model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "人物走进雨夜街道"},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	if task.Status != model.TaskStatusQueued || task.ModelProfileID != "seedance-test" {
		t.Fatalf("task = %#v", task)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		stored, err := repository.GetGenerationTaskByIDAndUser(task.ID, userID)
		if err == nil && stored.Status == model.TaskStatusSucceeded {
			if stored.UpstreamTaskID != "upstream-orchestrated" || polls == 0 {
				t.Fatalf("stored = %#v polls=%d", stored, polls)
			}
			public, err := GetGeneration(userID, task.ID)
			if err != nil {
				t.Fatalf("GetGeneration: %v", err)
			}
			if public.Result == nil || public.Result.VideoURL != "https://example.com/result.mp4" {
				t.Fatalf("result = %#v", public.Result)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("task %s did not succeed", task.ID)
}

func TestSeedanceAdapterCreatesPromptOnlyTask(t *testing.T) {
	var gotPath string
	var gotAuthorization string
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthorization = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"upstream-1","status":"queued","model":"seedance-1-5-pro"}`))
	}))
	defer upstream.Close()

	adapter := NewSeedanceContentsV1Adapter(upstream.Client())
	ref, err := adapter.Create(context.Background(), AdapterCreateRequest{
		Profile: model.GenerationProfile{
			ID:            "seedance-1-5-pro",
			AdapterKey:    "seedance-contents-v1",
			UpstreamModel: "seedance-1-5-pro",
		},
		Channel: model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"},
		Intent:  model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "人物走进雨夜街道"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if ref.ID != "upstream-1" || ref.Status != model.TaskStatusQueued {
		t.Fatalf("provider task = %#v", ref)
	}
	if gotPath != "/v1/contents/generations/tasks" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuthorization != "Bearer secret" {
		t.Fatalf("Authorization = %q", gotAuthorization)
	}
	want := map[string]any{
		"model":          "seedance-1-5-pro",
		"content":        []any{map[string]any{"type": "text", "text": "人物走进雨夜街道"}},
		"ratio":          "adaptive",
		"resolution":     "720p",
		"duration":       float64(-1),
		"generate_audio": true,
		"watermark":      false,
	}
	if !jsonEqual(gotBody, want) {
		t.Fatalf("body = %#v, want %#v", gotBody, want)
	}
}

func jsonEqual(got, want any) bool {
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	return string(gotJSON) == string(wantJSON)
}
