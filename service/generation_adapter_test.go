package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestGenerationProfilesAreValid(t *testing.T) {
	if err := ValidateGenerationProfiles(); err != nil {
		t.Fatalf("ValidateGenerationProfiles: %v", err)
	}
}

func TestViduAdapterRecordsUpstreamCreditsIncludingExplicitNull(t *testing.T) {
	adapter := NewViduShortDramaV1Adapter(nil)
	withCredits, err := adapter.ParseCallback(context.Background(), []byte(`{"id":"vidu-credits","model":"vidu_hq_t2v-oversea","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"},"credits":18}`))
	if err != nil || withCredits.Credits == nil || *withCredits.Credits != 18 {
		t.Fatalf("with credits = %#v, err = %v", withCredits, err)
	}

	withoutCredits, err := adapter.ParseCallback(context.Background(), []byte(`{"id":"vidu-no-credits","model":"vidu_hq_t2v-oversea","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"}}`))
	if err != nil || withoutCredits.Credits != nil {
		t.Fatalf("without credits = %#v, err = %v", withoutCredits, err)
	}
	var audit map[string]any
	if err := json.Unmarshal([]byte(withoutCredits.Audit.ResponseBody), &audit); err != nil {
		t.Fatalf("decode audit: %v", err)
	}
	if credits, exists := audit["credits"]; !exists || credits != nil {
		t.Fatalf("audit credits = %#v, exists = %v; audit = %#v", credits, exists, audit)
	}
}

func TestCreateGenerationRejectsForeignMedia(t *testing.T) {
	previousProfiles := generationProfiles
	defer func() { generationProfiles = previousProfiles }()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-media", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-media", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
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

func TestCreateGenerationAcceptsGeneratedImageReference(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-result-media", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-result-media", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	routeErr := errors.New("route reached")
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, routeErr }
	userID := "result-media-user-" + uuid.NewString()
	fileID := "result-image-" + uuid.NewString()
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: userID, FileType: "results/images", S3Key: "results/images/" + userID + "/file.png", OriginalName: "file.png", MimeType: "image/png", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
		t.Fatalf("create file: %v", err)
	}

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-result-media-" + uuid.NewString(), ModelProfileID: "seedance-result-media", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "test", References: model.GenerationReferences{Images: []model.MediaReference{{FileID: fileID, SourceNodeID: "node-1"}}}},
	})
	if !errors.Is(err, routeErr) {
		t.Fatalf("error = %v, want route reached", err)
	}
}

func TestGenerationFileMatchesMediaType(t *testing.T) {
	for _, testCase := range []struct {
		fileType string
		expected string
		want     bool
	}{
		{"images", "images", true}, {"results/images", "images", true},
		{"videos", "videos", true}, {"results/videos", "videos", true},
		{"audios", "audios", true}, {"results/audios", "audios", true},
		{"videos", "images", false}, {"results/videos", "images", false},
		{"uploads/images", "images", false}, {"foo/images", "images", false},
		{"results/images/extra", "images", false}, {"", "images", false},
	} {
		if got := generationFileMatchesMediaType(testCase.fileType, testCase.expected); got != testCase.want {
			t.Fatalf("generationFileMatchesMediaType(%q, %q) = %v, want %v", testCase.fileType, testCase.expected, got, testCase.want)
		}
	}
}

func TestCreateGenerationAppliesProfileSettingsToSeedance(t *testing.T) {
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"upstream-settings","status":"succeeded"}`))
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
		return []model.GenerationProfile{{ID: "seedance-settings", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-settings", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return generationChannel("") }
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-settings-" + uuid.NewString()}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-settings-" + uuid.NewString(), ModelProfileID: "seedance-settings", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "configured", Settings: model.ScalarSettings{
			"aspectRatio": "9:16", "resolution": "1080p", "durationSeconds": 10, "generateAudio": false, "watermark": true,
		}},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	for key, want := range map[string]any{"ratio": "9:16", "resolution": "1080p", "duration": float64(10), "generate_audio": false, "watermark": true} {
		if gotBody[key] != want {
			t.Fatalf("body[%q] = %#v, want %#v; body=%#v", key, gotBody[key], want, gotBody)
		}
	}
	body, _ := json.Marshal(gotBody)
	for _, platformKey := range []string{"aspectRatio", "durationSeconds", "generateAudio"} {
		if strings.Contains(string(body), platformKey) {
			t.Fatalf("upstream body leaked %q: %s", platformKey, body)
		}
	}
}

func TestCreateGenerationUsesOperationalBindingRouteAndPublicPrice(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousCost := generationCost
	previousDispatch := generationDispatch
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationCost = previousCost
		generationDispatch = previousDispatch
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}()
	profile := model.GenerationProfile{ID: "stable-seedance", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "vendor-seedance", ChannelName: "bound-channel", Credits: 99, Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}
	generationProfiles = func() []model.GenerationProfile { return []model.GenerationProfile{profile} }
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, errors.New("random route used") }
	generationCost = ModelCost
	settings := previousSettings
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: "vendor-seedance", Credits: 3})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	generationDispatch = func(context.Context, string) {}
	var gotName, gotModel string
	generationRouteChannel = func(name, modelName string) (model.ModelChannel, error) {
		gotName, gotModel = name, modelName
		return model.ModelChannel{Name: name, Protocol: "openai", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{modelName}}, nil
	}

	key := uuid.NewString()
	userID := "user-binding-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "binding-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: 10, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-binding-" + uuid.NewString(), ModelProfileID: "stable-seedance", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "bound"},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	if gotName != "bound-channel" || gotModel != "vendor-seedance" || task.ModelProfileID != "stable-seedance" {
		t.Fatalf("route = %q/%q, task = %#v", gotName, gotModel, task)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Credits != 3 {
		t.Fatalf("stored task = %#v, err = %v", stored, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || user.Credits != 7 {
		t.Fatalf("user = %#v, ok = %v, err = %v", user, ok, err)
	}
}

func TestCreateGenerationChargesVideoBindingByResolutionAndSeconds(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousDispatch := generationDispatch
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationDispatch = previousDispatch
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}()

	key := uuid.NewString()
	profileID := "second-profile-" + key
	upstreamModel := "second-model-" + key
	channelName := "second-channel-" + key
	profile := model.GenerationProfile{
		ID: profileID, Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: upstreamModel, ChannelName: channelName,
		Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities(),
	}
	generationProfiles = func() []model.GenerationProfile { return []model.GenerationProfile{profile} }
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, errors.New("random route used") }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: channelName, Protocol: "xvanai", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{upstreamModel}}, nil
	}
	generationDispatch = func(context.Context, string) {}

	settings := previousSettings
	settings.Private.GenerationProfiles = append(settings.Private.GenerationProfiles, model.GenerationProfileBinding{
		ID: profileID, ProfileID: "seedance-1-5-pro", UpstreamModel: upstreamModel, ChannelName: channelName, BillingMode: model.BillingModePerSecond, Enabled: true,
	})
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{
		Model: profileID, ResolutionCredits: map[string]int{"720p": 2},
	})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	userID := "second-user-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "second-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: 100, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-second-" + key, ModelProfileID: profileID, Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "six seconds", Settings: model.ScalarSettings{"resolution": "720p", "durationSeconds": 6}},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Credits != 12 || stored.BillingMode != model.BillingModePerSecond || stored.BillingRate != 2 {
		t.Fatalf("stored task = %#v, err = %v", stored, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || user.Credits != 88 {
		t.Fatalf("user = %#v, ok = %v, err = %v", user, ok, err)
	}
}

func TestCreateGenerationChargesViduByUpstreamCreditsAtSuccess(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"id":"vidu-billed","model":"vidu_hq_t2v-oversea","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"vidu-billed","model":"vidu_hq_t2v-oversea","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"},"credits":18}`))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousPersist := generationPersistVideo
	previousDispatch := generationDispatch
	previousPollInterval := generationPollInterval
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationPersistVideo = previousPersist
		generationDispatch = previousDispatch
		generationPollInterval = previousPollInterval
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}()

	key := uuid.NewString()
	profileID := "credit-profile-" + key
	upstreamModel := "vidu_hq_t2v-oversea-" + key
	channelName := "credit-channel-" + key
	profile := model.GenerationProfile{
		ID: profileID, Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: upstreamModel, ChannelName: channelName,
		Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities(),
	}
	generationProfiles = func() []model.GenerationProfile { return []model.GenerationProfile{profile} }
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, errors.New("random route used") }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: channelName, Protocol: "xvanai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true, Models: []string{upstreamModel}}, nil
	}
	generationHTTPClient = upstream.Client()
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "credit-file-" + key, MimeType: "video/mp4"}, nil
	}
	generationPollInterval = time.Millisecond
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "credit-worker-"+key)
	}

	settings := previousSettings
	settings.Private.GenerationProfiles = append(settings.Private.GenerationProfiles, model.GenerationProfileBinding{
		ID: profileID, ProfileID: "seedance-1-5-pro", UpstreamModel: upstreamModel, ChannelName: channelName, BillingMode: model.BillingModePerCredit, Enabled: true,
	})
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: profileID, Credits: 2})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	userID := "credit-user-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "credit-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: 100, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-credit-" + key, ModelProfileID: profileID, Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "credit billed"},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || stored.Credits != 36 || stored.UpstreamCredits == nil || *stored.UpstreamCredits != 18 || stored.BillingMode != model.BillingModePerCredit || stored.BillingRate != 2 {
		t.Fatalf("stored task = %#v, err = %v", stored, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || user.Credits != 64 {
		t.Fatalf("user = %#v, ok = %v, err = %v", user, ok, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].Type != model.CreditLogTypeAIConsume || logs[0].Amount != -36 || !strings.Contains(logs[0].Extra, `"credits":18`) {
		t.Fatalf("logs = %#v, err = %v", logs, err)
	}
}

func TestCreateGenerationRejectsInvalidProfileBeforeRouting(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "invalid-profile", Version: 1, AdapterKey: "unknown-adapter", UpstreamModel: "seedance-invalid", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	var routed atomic.Int32
	generationChannel = func(string) (model.ModelChannel, error) {
		routed.Add(1)
		return model.ModelChannel{}, nil
	}

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-invalid-profile"}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-invalid-profile-" + uuid.NewString(), ModelProfileID: "invalid-profile", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid profile"},
	})
	var validationErr GenerationValidationError
	if !errors.As(err, &validationErr) || validationErr.Code != "MODEL_CONFIGURATION_INVALID" || validationErr.FieldPath != "modelProfileId" {
		t.Fatalf("error = %#v, want structured invalid profile", err)
	}
	if routed.Load() != 0 {
		t.Fatalf("routed invalid profile %d times", routed.Load())
	}
}

func TestCreateGenerationRejectsInvalidSourceBeforeRouting(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-source", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-source", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	var routed atomic.Int32
	generationChannel = func(string) (model.ModelChannel, error) {
		routed.Add(1)
		return model.ModelChannel{}, nil
	}

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-invalid-source"}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-invalid-source-" + uuid.NewString(), ModelProfileID: "seedance-source", Source: "admin",
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid source"},
	})
	var validationErr GenerationValidationError
	if !errors.As(err, &validationErr) || validationErr.Code != "INVALID_COMMAND" || validationErr.FieldPath != "source" || validationErr.Retryable {
		t.Fatalf("error = %#v", err)
	}
	if routed.Load() != 0 {
		t.Fatalf("routed invalid source %d times", routed.Load())
	}
}

func TestCreateGenerationAcceptsAllProfileSettingValuesBeforeRouting(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-values", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-values", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	routeErr := errors.New("route reached")
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, routeErr }

	values := []model.ScalarSettings{}
	for _, value := range []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"} {
		values = append(values, model.ScalarSettings{"aspectRatio": value})
	}
	for _, value := range []string{"480p", "720p", "1080p"} {
		values = append(values, model.ScalarSettings{"resolution": value})
	}
	values = append(values, model.ScalarSettings{"durationSeconds": -1})
	for value := 4; value <= 15; value++ {
		values = append(values, model.ScalarSettings{"durationSeconds": value})
	}
	for _, value := range []bool{false, true} {
		values = append(values, model.ScalarSettings{"generateAudio": value}, model.ScalarSettings{"watermark": value})
	}

	for index, settings := range values {
		_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-values"}, model.GenerationCommand{
			CommandVersion: 1, ClientRequestID: fmt.Sprintf("request-values-%d-%s", index, uuid.NewString()), ModelProfileID: "seedance-values", Source: string(model.SourceCanvas),
			Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "valid", Settings: settings},
		})
		if !errors.Is(err, routeErr) {
			t.Fatalf("settings %#v error = %v, want route reached", settings, err)
		}
	}
}

func TestCreateGenerationRejectsInvalidProfileSettingsBeforeRouting(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-validation", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-validation", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	var routed atomic.Int32
	generationChannel = func(string) (model.ModelChannel, error) {
		routed.Add(1)
		return model.ModelChannel{}, nil
	}

	cases := []struct {
		settings  model.ScalarSettings
		fieldPath string
	}{
		{model.ScalarSettings{"providerOption": "secret"}, "intent.settings.providerOption"},
		{model.ScalarSettings{"generateAudio": "true"}, "intent.settings.generateAudio"},
		{model.ScalarSettings{"resolution": "4k"}, "intent.settings.resolution"},
		{model.ScalarSettings{"durationSeconds": 3}, "intent.settings.durationSeconds"},
		{model.ScalarSettings{"durationSeconds": 16}, "intent.settings.durationSeconds"},
		{model.ScalarSettings{"durationSeconds": 4.5}, "intent.settings.durationSeconds"},
		{model.ScalarSettings{"aspectRatio": []string{"16:9"}}, "intent.settings.aspectRatio"},
		{model.ScalarSettings{"aspectRatio": map[string]any{"value": "16:9"}}, "intent.settings.aspectRatio"},
		{model.ScalarSettings{"watermark": nil}, "intent.settings.watermark"},
	}
	for index, testCase := range cases {
		_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-validation"}, model.GenerationCommand{
			CommandVersion: 1, ClientRequestID: fmt.Sprintf("request-validation-%d-%s", index, uuid.NewString()), ModelProfileID: "seedance-validation", Source: string(model.SourceCanvas),
			Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid", Settings: testCase.settings},
		})
		var validationErr GenerationValidationError
		if !errors.As(err, &validationErr) || validationErr.FieldPath != testCase.fieldPath {
			t.Fatalf("case %d error = %#v, want fieldPath %q", index, err, testCase.fieldPath)
		}
	}
	if routed.Load() != 0 {
		t.Fatalf("routed invalid commands %d times", routed.Load())
	}
}

func TestCreateGenerationValidatesNegativePromptBeforeRouting(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-negative-prompt", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-negative-prompt", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	routeErr := errors.New("route reached")
	generationChannel = func(string) (model.ModelChannel, error) { return model.ModelChannel{}, routeErr }

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-negative-prompt"}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-negative-500-" + uuid.NewString(), ModelProfileID: "seedance-negative-prompt", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "valid", NegativePrompt: " 差" + strings.Repeat("差", 499) + " "},
	})
	if !errors.Is(err, routeErr) {
		t.Fatalf("500-rune negative prompt error = %v, want route reached", err)
	}

	_, err = CreateGeneration(context.Background(), model.AuthUser{ID: "user-negative-prompt"}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-negative-501-" + uuid.NewString(), ModelProfileID: "seedance-negative-prompt", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "valid", NegativePrompt: strings.Repeat("差", 501)},
	})
	var validationErr GenerationValidationError
	if !errors.As(err, &validationErr) || validationErr.FieldPath != "intent.negativePrompt" {
		t.Fatalf("501-rune negative prompt error = %#v", err)
	}
}

func TestCreateGenerationRunsMediaSeedanceTask(t *testing.T) {
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
				t.Fatalf("decode upstream request: %v", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"upstream-media","status":"succeeded","content":{"video_url":"https://example.com/result.mp4"}}`))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousCost := generationCost
	previousPresign := generationPresign
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPresign = previousPresign
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-media", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-media", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return generationChannel("") }
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationPresign = func(_ context.Context, key string, _ time.Duration) (string, error) {
		return "https://cdn.example/" + key, nil
	}
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	key := uuid.NewString()
	userID := "user-media-" + key
	references := model.GenerationReferences{}
	for _, item := range []struct {
		id       string
		fileType string
		s3Key    string
		target   *[]model.MediaReference
	}{
		{"image-" + key, "results/images", "results/images/" + userID + "/image.png", &references.Images},
		{"video-" + key, "results/videos", "results/videos/" + userID + "/video.mp4", &references.Videos},
		{"audio-" + key, "results/audios", "results/audios/" + userID + "/audio.mp3", &references.Audios},
	} {
		if err := repository.CreateUserFile(model.UserFile{ID: item.id, UserID: userID, FileType: item.fileType, S3Key: item.s3Key}); err != nil {
			t.Fatalf("create %s: %v", item.fileType, err)
		}
		*item.target = append(*item.target, model.MediaReference{FileID: item.id, SourceNodeID: "node-" + item.fileType, Name: item.fileType})
	}

	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-media-" + key, ModelProfileID: "seedance-media", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "use media", References: references},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	content, ok := gotBody["content"].([]any)
	if !ok || len(content) != 4 {
		t.Fatalf("content = %#v", gotBody["content"])
	}
	if _, exists := gotBody["metadata"]; exists {
		t.Fatalf("empty negative prompt added metadata: %#v", gotBody["metadata"])
	}
	body, _ := json.Marshal(gotBody)
	for _, forbidden := range []string{"fileId", "sourceNodeId", "node-images", "node-videos", "node-audios"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("upstream body leaked %q: %s", forbidden, body)
		}
	}
	for index, media := range []struct {
		mediaType string
		role      string
	}{
		{"text", ""},
		{"image_url", "reference_image"},
		{"video_url", "reference_video"},
		{"audio_url", "reference_audio"},
	} {
		item := content[index].(map[string]any)
		if item["type"] != media.mediaType || media.role != "" && item["role"] != media.role {
			t.Fatalf("content[%d] = %#v, want type=%q role=%q", index, item, media.mediaType, media.role)
		}
	}
}

func TestCreateGenerationRefundsFailedTaskOnce(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"upstream-failed","status":"failed"}`))
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
		return []model.GenerationProfile{{ID: "seedance-failed", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-failed", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return generationChannel("") }
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 2, nil }
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	key := uuid.NewString()
	userID := "user-failed-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "failed-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: 8, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	_, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-failed-" + key, ModelProfileID: "seedance-failed", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "fail"},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || user.Credits != 8 {
		t.Fatalf("user = %#v ok=%v err=%v", user, ok, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 2 || logs[0].Type != model.CreditLogTypeAIRefund || logs[1].Type != model.CreditLogTypeAIConsume {
		t.Fatalf("logs = %#v err=%v", logs, err)
	}
}

func TestCreateGenerationDefaultsProduceSameIdempotencyHash(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousCost := generationCost
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationCost = previousCost
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-defaults", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-defaults", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: "http://127.0.0.1:1", APIKey: "secret", Enabled: true}, nil
	}
	generationCost = func(string) (int, error) { return 0, nil }
	generationDispatch = func(context.Context, string) {}

	key := uuid.NewString()
	command := model.GenerationCommand{CommandVersion: 1, ClientRequestID: "request-defaults-" + key, ModelProfileID: "seedance-defaults", Source: string(model.SourceCanvas), Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "defaults"}}
	first, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-defaults-" + key}, command)
	if err != nil {
		t.Fatalf("first CreateGeneration: %v", err)
	}
	command.Intent.Settings = model.ScalarSettings{"aspectRatio": "adaptive", "resolution": "720p", "durationSeconds": -1, "generateAudio": true, "watermark": false}
	second, err := CreateGeneration(context.Background(), model.AuthUser{ID: "user-defaults-" + key}, command)
	if err != nil {
		t.Fatalf("second CreateGeneration: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("task ids = %q, %q", first.ID, second.ID)
	}
}

func TestCreateGenerationRejectsIdempotentCommandConflict(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-conflict", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-conflict", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: "http://127.0.0.1:1", APIKey: "secret", Enabled: true}, nil
	}
	generationDispatch = func(context.Context, string) {}
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
	previousPresign := generationPresign
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPresign = previousPresign
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-idempotent", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-idempotent", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
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
	previousPersist := generationPersistVideo
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPollInterval = previousPollInterval
		generationDispatch = previousDispatch
		generationPersistVideo = previousPersist
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-test", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-test", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
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
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "file-seedance-result", FileType: "results/videos", MimeType: "video/mp4"}, nil
	}
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
			if public.Result == nil || public.Result.Kind != "video" || public.Result.File.FileID != "file-seedance-result" {
				t.Fatalf("result = %#v", public.Result)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("task %s did not succeed", task.ID)
}

func TestCreateGenerationRunsViduShortDramaTask(t *testing.T) {
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
				t.Fatalf("decode upstream request: %v", err)
			}
			_, _ = w.Write([]byte(`{"id":"vidu-orchestrated","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"vidu-orchestrated","status":"succeeded","content":{"video_url":"https://example.com/drama.mp4"}}`))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousCost := generationCost
	previousPresign := generationPresign
	previousPollInterval := generationPollInterval
	previousCallbackPollInterval := generationCallbackPollInterval
	previousDispatch := generationDispatch
	previousPersist := generationPersistVideo
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPresign = previousPresign
		generationPollInterval = previousPollInterval
		generationCallbackPollInterval = previousCallbackPollInterval
		generationDispatch = previousDispatch
		generationPersistVideo = previousPersist
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "vidu-drama", Version: 1, AdapterKey: "vidu-short-drama-v1", UpstreamModel: "viduq3-drama-oversea", Intents: []model.GenerationIntentKind{model.IntentVideoShortDrama}, Capabilities: viduDramaCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return generationChannel("") }
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationPresign = func(_ context.Context, key string, _ time.Duration) (string, error) {
		return "https://cdn.example/" + key, nil
	}
	generationPollInterval = time.Millisecond
	generationCallbackPollInterval = time.Millisecond
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "file-drama-result", FileType: "results/videos", MimeType: "video/mp4"}, nil
	}
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	key := uuid.NewString()
	userID := "user-vidu-" + key
	fileID := "file-vidu-" + key
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: userID, FileType: "images", S3Key: "images/character.png", MimeType: "image/png"}); err != nil {
		t.Fatalf("create image: %v", err)
	}
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-vidu-" + key, ModelProfileID: "vidu-drama", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoShortDrama, Title: "测试短剧", Script: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。", Settings: model.ScalarSettings{
			"aspectRatio": "16:9", "resolution": "1080p", "durationSeconds": 12, "quality": "standard",
		}, Assets: []model.ShortDramaAsset{
			{SourceNodeID: "image-1", Role: model.ShortDramaAssetCharacter, Name: "林尘", Reference: model.MediaReference{FileID: fileID, SourceNodeID: "image-1"}},
		}},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	if task.Status != model.TaskStatusQueued || task.IntentKind != model.IntentVideoShortDrama {
		t.Fatalf("task = %#v", task)
	}
	stored, err := repository.GetGenerationTaskByIDAndUser(task.ID, userID)
	if err != nil || stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("stored = %#v err=%v", stored, err)
	}
	public, err := GetGeneration(userID, task.ID)
	if err != nil || public.Result == nil || public.Result.Kind != "short-drama" || public.Result.File.FileID != "file-drama-result" {
		t.Fatalf("result = %#v err=%v", public.Result, err)
	}
	if gotBody["action"] != "short-play" || gotBody["ratio"] != "16:9" || gotBody["resolution"] != "1080p" || gotBody["duration"] != float64(12) || gotBody["quality"] != "standard" {
		t.Fatalf("body = %#v", gotBody)
	}
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
		Intent:  model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "人物走进雨夜街道", NegativePrompt: "低质量，模糊"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if ref.ID != "upstream-1" || ref.Status != model.TaskStatusRunning {
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
		"metadata": map[string]any{
			"extra_params": map[string]any{"negative_prompt": "低质量，模糊"},
		},
	}
	if !jsonEqual(gotBody, want) {
		t.Fatalf("body = %#v, want %#v", gotBody, want)
	}
}

func TestViduShortDramaAdapterCreatesGoldenPayloads(t *testing.T) {
	cases := []struct {
		name       string
		intent     model.GenerationIntent
		imageURLs  []string
		wantAssets []any
	}{
		{
			name: "minimal",
			intent: model.GenerationIntent{Kind: model.IntentVideoShortDrama, Title: "测试短剧", Script: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。", Assets: []model.ShortDramaAsset{
				{SourceNodeID: "image-1", Role: model.ShortDramaAssetCharacter, Name: "林尘", Reference: model.MediaReference{FileID: "file-1", SourceNodeID: "image-1"}},
			}},
			imageURLs: []string{"https://cdn.example/linchen.png"},
			wantAssets: []any{
				map[string]any{"id": "1", "type": "character", "name": "林尘", "image_uri": "https://cdn.example/linchen.png"},
			},
		},
		{
			name: "multiple assets",
			intent: model.GenerationIntent{Kind: model.IntentVideoShortDrama, Title: "典当行退婚", Script: "人物：林尘、未婚妻。分镜1-1：未婚妻将戒指拍在典当行柜台上提出退婚。", Assets: []model.ShortDramaAsset{
				{SourceNodeID: "character", Role: model.ShortDramaAssetCharacter, Name: "林尘", Description: "男主角", Reference: model.MediaReference{FileID: "file-character", SourceNodeID: "character"}},
				{SourceNodeID: "scene", Role: model.ShortDramaAssetScene, Name: "典当行", Reference: model.MediaReference{FileID: "file-scene", SourceNodeID: "scene"}},
				{SourceNodeID: "tool", Role: model.ShortDramaAssetTool, Name: "戒指", Description: "订婚戒指", Reference: model.MediaReference{FileID: "file-tool", SourceNodeID: "tool"}},
			}},
			imageURLs: []string{"https://cdn.example/character.png", "https://cdn.example/scene.png", "https://cdn.example/tool.png"},
			wantAssets: []any{
				map[string]any{"id": "1", "type": "character", "name": "林尘", "description": "男主角", "image_uri": "https://cdn.example/character.png"},
				map[string]any{"id": "2", "type": "scene", "name": "典当行", "image_uri": "https://cdn.example/scene.png"},
				map[string]any{"id": "3", "type": "tool", "name": "戒指", "description": "订婚戒指", "image_uri": "https://cdn.example/tool.png"},
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var gotPath string
			var gotBody map[string]any
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
					t.Fatalf("decode upstream request: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"vidu-task","status":"queued"}`))
			}))
			defer upstream.Close()

			adapter := NewViduShortDramaV1Adapter(upstream.Client())
			ref, err := adapter.Create(context.Background(), AdapterCreateRequest{
				Profile:    model.GenerationProfile{ID: "vidu-drama", AdapterKey: "vidu-short-drama-v1", UpstreamModel: "viduq3-drama-oversea", Capabilities: viduDramaCapabilities()},
				Channel:    model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"},
				Intent:     testCase.intent,
				References: AdapterMediaReferences{Images: testCase.imageURLs},
			})
			if err != nil {
				t.Fatalf("Create: %v", err)
			}
			if ref.ID != "vidu-task" || ref.Status != model.TaskStatusRunning || gotPath != "/v1/contents/generations/tasks" {
				t.Fatalf("ref=%#v path=%q", ref, gotPath)
			}
			want := map[string]any{
				"model": "viduq3-drama-oversea", "action": "short-play", "script_name": testCase.intent.Title,
				"content": []any{map[string]any{"type": "text", "text": testCase.intent.Script}}, "assets": testCase.wantAssets,
				"duration": float64(0), "ratio": "9:16", "resolution": "1080p", "quality": "high",
			}
			if !jsonEqual(gotBody, want) {
				t.Fatalf("body = %#v, want %#v", gotBody, want)
			}
		})
	}
}

func TestCreateGenerationStoresOnlyLongTermCommandSummary(t *testing.T) {
	previousProfiles := generationProfiles
	previousChannel := generationChannel
	previousCost := generationCost
	previousDispatch := generationDispatch
	defer func() {
		generationProfiles = previousProfiles
		generationChannel = previousChannel
		generationCost = previousCost
		generationDispatch = previousDispatch
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "summary-profile", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "summary-model", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationChannel = func(string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "summary-channel", Protocol: "openai", BaseURL: "https://example.com", APIKey: "secret", Enabled: true}, nil
	}
	generationCost = func(string) (int, error) { return 0, nil }
	generationDispatch = func(context.Context, string) {}

	userID := "user-summary-" + uuid.NewString()
	fileID := "file-summary-" + uuid.NewString()
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: userID, FileType: "images", S3Key: "images/input.png"}); err != nil {
		t.Fatalf("CreateUserFile: %v", err)
	}
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-summary-" + uuid.NewString(), ModelProfileID: "summary-profile", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "private full prompt", References: model.GenerationReferences{Images: []model.MediaReference{{FileID: fileID, SourceNodeID: "node-1"}}}},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTaskByID: %v", err)
	}
	if strings.Contains(stored.Metadata, "private full prompt") || !strings.Contains(stored.Metadata, fileID) || !strings.Contains(stored.Metadata, `"intentKind":"video.generate"`) {
		t.Fatalf("long-term metadata = %s", stored.Metadata)
	}
	payload, err := repository.GetGenerationPayloadByTaskID(task.ID)
	if err != nil || !strings.Contains(payload.CommandBody, "private full prompt") || payload.RequestBody != "" {
		t.Fatalf("TTL payload=%#v err=%v", payload, err)
	}
}

func TestRecoveredGenerationPollsExistingProviderTask(t *testing.T) {
	var creates atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			creates.Add(1)
			_, _ = w.Write([]byte(`{"id":"duplicate","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"existing-provider-task","status":"succeeded","content":{"video_url":"https://cdn.example/video.mp4?token=fresh"}}`))
	}))
	defer upstream.Close()

	previousClient := generationHTTPClient
	previousPersist := generationPersistVideo
	defer func() {
		generationHTTPClient = previousClient
		generationPersistVideo = previousPersist
	}()
	generationHTTPClient = upstream.Client()
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "file-recovered", MimeType: "video/mp4"}, nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	command, _ := json.Marshal(model.GenerationCommand{CommandVersion: 1, Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "recover"}})
	task := model.GenerationTask{
		ID: "recover-result-" + uuid.NewString(), UserID: "user-recover", TaskType: model.TaskTypeVideo, Status: model.TaskStatusRunning,
		IntentKind: string(model.IntentVideoGenerate), AdapterKey: "seedance-contents-v1", UpstreamTaskID: "existing-provider-task", CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CommandBody: string(command), CreatedAt: now}); err != nil {
		t.Fatalf("CreateGenerationTask: %v", err)
	}
	executeGeneration(context.Background(), task, model.GenerationProfile{AdapterKey: task.AdapterKey, UpstreamModel: "seedance"}, model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"})
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || creates.Load() != 0 {
		t.Fatalf("stored=%#v creates=%d err=%v", stored, creates.Load(), err)
	}
}

func TestFirstPartyGenerationPersistsProviderVideoBeforeSuccess(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/video.mp4" {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-bytes"))
			return
		}
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"id":"provider-video","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(fmt.Sprintf(`{"id":"provider-video","status":"succeeded","content":{"video_url":%q}}`, upstreamURL(r)+"video.mp4?X-Amz-Signature=secret")))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousCost := generationCost
	previousPollInterval := generationPollInterval
	previousDispatch := generationDispatch
	previousPersist := generationPersistVideo
	defer func() {
		generationProfiles = previousProfiles
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationCost = previousCost
		generationPollInterval = previousPollInterval
		generationDispatch = previousDispatch
		generationPersistVideo = previousPersist
	}()
	generationProfiles = func() []model.GenerationProfile {
		return []model.GenerationProfile{{ID: "seedance-result", Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: "seedance-result", ChannelName: "test", Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities()}}
	}
	generationRouteChannel = func(string, string) (model.ModelChannel, error) {
		return model.ModelChannel{Name: "test", Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true}, nil
	}
	generationHTTPClient = upstream.Client()
	generationCost = func(string) (int, error) { return 0, nil }
	generationPollInterval = time.Millisecond
	persistCalls := 0
	generationPersistVideo = func(ctx context.Context, userID, rawURL string) (*model.UserFile, error) {
		persistCalls++
		if strings.Contains(rawURL, "X-Amz-Signature") == false {
			t.Fatalf("provider URL = %q", rawURL)
		}
		return &model.UserFile{ID: "file-result", FileType: "results/videos", MimeType: "video/mp4", Bytes: 11}, nil
	}
	generationDispatch = func(ctx context.Context, taskID string) {
		processGenerationTask(ctx, taskID, "test-worker-"+uuid.NewString())
	}

	userID := "user-result-" + uuid.NewString()
	task, err := CreateGeneration(context.Background(), model.AuthUser{ID: userID}, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "request-result-" + uuid.NewString(), ModelProfileID: "seedance-result", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "test"},
	})
	if err != nil {
		t.Fatalf("CreateGeneration: %v", err)
	}
	public, err := GetGeneration(userID, task.ID)
	if err != nil {
		t.Fatalf("GetGeneration: %v", err)
	}
	if public.Status != model.TaskStatusSucceeded || public.Result == nil || public.Result.Kind != "video" || public.Result.File.FileID != "file-result" || persistCalls != 1 {
		t.Fatalf("public=%#v persistCalls=%d", public, persistCalls)
	}
	body, _ := json.Marshal(public)
	if strings.Contains(string(body), "X-Amz-Signature") || strings.Contains(string(body), "videoUrl") {
		t.Fatalf("public result leaked provider URL: %s", body)
	}
}

func TestFirstPartyGenerationKeepsResultPersistenceFailureRecoverable(t *testing.T) {
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return nil, errors.New("s3 unavailable")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	task := model.GenerationTask{ID: "persist-failure-" + uuid.NewString(), UserID: "user", TaskType: model.TaskTypeVideo, Status: model.TaskStatusRunning, IntentKind: string(model.IntentVideoGenerate), CreatedAt: now, UpdatedAt: now}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
		t.Fatalf("CreateGenerationTask: %v", err)
	}
	profile := model.GenerationProfile{UpstreamModel: "seedance"}
	completeGenerationTask(context.Background(), task, profile, ProviderTaskRef{ID: "provider", Status: model.TaskStatusSucceeded, VideoURL: "https://cdn.example/video.mp4?token=secret"})
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTaskByID: %v", err)
	}
	if stored.Status != model.TaskStatusRunning || stored.ErrorCode != "RESULT_PERSIST_FAILED" || stored.ErrorMessage != "生成结果暂时无法保存，请稍后重试" {
		t.Fatalf("stored = %#v", stored)
	}
}

func upstreamURL(r *http.Request) string {
	return "http://" + r.Host + "/"
}

func TestSeedanceAdapterNormalizesProviderStatuses(t *testing.T) {
	cases := []struct {
		provider string
		want     model.TaskStatus
		failed   bool
	}{
		{"queued", model.TaskStatusRunning, false},
		{"running", model.TaskStatusRunning, false},
		{"processing", model.TaskStatusRunning, false},
		{"succeeded", model.TaskStatusSucceeded, false},
		{"success", model.TaskStatusSucceeded, false},
		{"failed", model.TaskStatusFailed, true},
		{"expired", model.TaskStatusFailed, true},
		{"cancelled", model.TaskStatusCancelled, false},
		{"vendor-new-state", model.TaskStatusRunning, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.provider, func(t *testing.T) {
			var gotPath, gotAuthorization string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotAuthorization = r.Header.Get("Authorization")
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"id":"provider-status","status":%q}`, testCase.provider)
			}))
			defer upstream.Close()

			adapter := NewSeedanceContentsV1Adapter(upstream.Client())
			ref, err := adapter.Poll(context.Background(), model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"}, "provider-status")
			if err != nil || ref.Status != testCase.want {
				t.Fatalf("ref=%#v err=%v", ref, err)
			}
			if testCase.failed != (ref.Error != nil) {
				t.Fatalf("error=%#v failed=%v", ref.Error, testCase.failed)
			}
			if gotPath != "/v1/contents/generations/tasks/provider-status" || gotAuthorization != "Bearer secret" {
				t.Fatalf("path=%q authorization=%q", gotPath, gotAuthorization)
			}
		})
	}
}

func TestViduShortDramaAdapterNormalizesTerminalResultsAndErrors(t *testing.T) {
	responses := []string{
		`{"id":"vidu-success","status":"succeeded","task":{"derived_data":{"signed_final_video_url":"https://cdn.example/final.mp4?X-Amz-Signature=secret","shots":[{"index":1,"duration":3.5,"status":"success","video_url":"https://cdn.example/shot.mp4?token=secret"}]}}}`,
		`{"id":"vidu-failed","status":"failed","error":{"code":"E001","message":"content too long"}}`,
	}
	index := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(responses[index]))
		index++
	}))
	defer upstream.Close()

	adapter := NewViduShortDramaV1Adapter(upstream.Client())
	success, err := adapter.Poll(context.Background(), model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"}, "vidu-success")
	if err != nil {
		t.Fatalf("Poll success: %v", err)
	}
	if success.Status != model.TaskStatusSucceeded || success.VideoURL != "https://cdn.example/final.mp4?X-Amz-Signature=secret" {
		t.Fatalf("success = %#v", success)
	}
	if len(success.Shots) != 1 || success.Shots[0].Index != 1 || success.Shots[0].DurationSeconds != 3.5 || success.Shots[0].Status != "success" {
		t.Fatalf("shots = %#v", success.Shots)
	}
	if strings.Contains(success.Audit.ResponseBody, "X-Amz-Signature") || strings.Contains(success.Audit.ResponseBody, "token=secret") {
		t.Fatalf("audit leaked signed query: %s", success.Audit.ResponseBody)
	}

	failed, err := adapter.Poll(context.Background(), model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"}, "vidu-failed")
	if err != nil {
		t.Fatalf("Poll failure result: %v", err)
	}
	if failed.Status != model.TaskStatusFailed || failed.Error == nil || failed.Error.Code != "UPSTREAM_REJECTED" || failed.Error.Message != "上游拒绝了生成请求" || failed.Error.Retryable {
		t.Fatalf("failed = %#v", failed)
	}
	if !strings.Contains(failed.Audit.ResponseBody, `"code":"E001"`) {
		t.Fatalf("audit lost provider diagnostic: %s", failed.Audit.ResponseBody)
	}
}

func TestGenerationAdapterMapsHTTPFailuresToStableErrors(t *testing.T) {
	cases := []struct {
		status    int
		code      string
		retryable bool
	}{
		{http.StatusBadRequest, "UPSTREAM_REJECTED", false},
		{http.StatusTooManyRequests, "UPSTREAM_RATE_LIMITED", true},
		{http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE", true},
	}
	for _, testCase := range cases {
		t.Run(fmt.Sprint(testCase.status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(testCase.status)
				_, _ = w.Write([]byte(`{"error":{"code":"provider-secret-code","message":"provider detail"}}`))
			}))
			defer upstream.Close()
			adapter := NewSeedanceContentsV1Adapter(upstream.Client())
			ref, err := adapter.Create(context.Background(), AdapterCreateRequest{
				Profile: model.GenerationProfile{UpstreamModel: "seedance"},
				Channel: model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"},
				Intent:  model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "test"},
			})
			if err == nil || ref.Error == nil || ref.Error.Code != testCase.code || ref.Error.Retryable != testCase.retryable {
				t.Fatalf("ref=%#v err=%v", ref, err)
			}
			if strings.Contains(ref.Audit.RequestHeaders, "secret") {
				t.Fatalf("audit leaked authorization: %s", ref.Audit.RequestHeaders)
			}
		})
	}
}

func TestGenerationAuditRedactsSecretsAndBodies(t *testing.T) {
	input := `{"Authorization":"Bearer secret","api_key":"secret-key","x-api-key":"header-secret","callback_secret":"callback-value","image_uri":"data:image/png;base64,AAAA","url":"https://cdn.example/video.mp4?X-Amz-Signature=signed&token=secret","nested":{"callback_url":"https://app.example/hook?secret=callback-value"}}`
	got := sanitizeGenerationAuditJSON(input)
	for _, secret := range []string{"Bearer secret", "secret-key", "header-secret", "callback-value", "AAAA", "X-Amz-Signature", "token=secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("audit leaked %q: %s", secret, got)
		}
	}
	for _, marker := range []string{"[REDACTED]", "data:image/png;base64,[REDACTED]", "https://cdn.example/video.mp4"} {
		if !strings.Contains(got, marker) {
			t.Fatalf("audit missing %q: %s", marker, got)
		}
	}
	embedded := sanitizeGenerationAuditJSON(strconv.Quote(`Get "https://cdn.example/video.mp4?X-Amz-Signature=signed&token=secret": Authorization: Bearer secret`))
	for _, secret := range []string{"X-Amz-Signature", "token=secret", "Bearer secret"} {
		if strings.Contains(embedded, secret) {
			t.Fatalf("embedded audit leaked %q: %s", secret, embedded)
		}
	}
}

func jsonEqual(got, want any) bool {
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	return string(gotJSON) == string(wantJSON)
}
