package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestAvailableGenerationProfilesPublishesVideoMode(t *testing.T) {
	restoreVideoModeTestSettings(t)
	for _, bound := range []bool{false, true} {
		t.Run(map[bool]string{false: "template", true: "channel binding"}[bound], func(t *testing.T) {
			seedanceID, soraID := "seedance-1-5-pro", "sora-2"
			settings := model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{{
				Name: "video-mode-test", Protocol: "openai", BaseURL: "http://127.0.0.1:1", APIKey: "test", Enabled: true,
				Models: []string{seedanceID, soraID},
			}}}}
			if bound {
				settings.Private.GenerationProfiles = []model.GenerationProfileBinding{
					{ID: "bound-seedance", ProfileID: seedanceID, UpstreamModel: seedanceID, ChannelName: "video-mode-test", Enabled: true},
					{ID: "bound-sora", ProfileID: soraID, UpstreamModel: soraID, ChannelName: "video-mode-test", Enabled: true},
				}
			}
			settings.Public.ModelChannel.VideoModels = []string{seedanceID, soraID}
			if _, err := repository.SaveSettings(settings, now()); err != nil {
				t.Fatal(err)
			}
			profiles, err := AvailableGenerationProfiles()
			if err != nil || len(profiles) != 2 {
				t.Fatalf("profiles = %#v, err = %v", profiles, err)
			}
			for _, profile := range profiles {
				mode, exists := profile.Capabilities.Settings["videoMode"]
				if profile.AdapterKey == "seedance-contents-v1" {
					if mode.Type != model.GenerationSettingEnum || mode.Default != "reference" || !reflect.DeepEqual(mode.Values, []string{"reference", "frames"}) {
						t.Fatalf("profile %s videoMode = %#v", profile.ID, mode)
					}
				} else if exists {
					t.Fatalf("profile %s must not advertise videoMode", profile.ID)
				}
			}
		})
	}
}

func restoreVideoModeTestSettings(t *testing.T) {
	t.Helper()
	previous, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := repository.SaveSettings(previous, now()); err != nil {
			t.Error(err)
		}
	})
}

func configureVideoModeTestProfile(t *testing.T, upstreamURL, templateID string) {
	t.Helper()
	restoreVideoModeTestSettings(t)
	maxDuration := 30
	_, err := repository.SaveSettings(model.Settings{
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{{Name: "video-mode-test", Protocol: "openai", BaseURL: upstreamURL, APIKey: "test", Enabled: true, Models: []string{"vendor-video"}}},
			GenerationProfiles: []model.GenerationProfileBinding{{ID: "video-mode-profile", ProfileID: templateID, UpstreamModel: "vendor-video", ChannelName: "video-mode-test", Enabled: true,
				LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &maxDuration},
			}},
		},
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{VideoModels: []string{"vendor-video"}}},
	}, now())
	if err != nil {
		t.Fatal(err)
	}
}

func TestCreateGenerationSendsOrderedFrames(t *testing.T) {
	for _, count := range []int{0, 1, 2} {
		t.Run(strconv.Itoa(count)+" images", func(t *testing.T) {
			requests := make(chan map[string]any, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				requests <- body
				w.Header().Set("Content-Type", "application/json")
				// Terminal test response avoids polling or downloading any provider media.
				_, _ = w.Write([]byte(`{"id":"video-mode-upstream","status":"failed","error":{"message":"test finished"}}`))
			}))
			defer upstream.Close()
			configureVideoModeTestProfile(t, upstream.URL, "seedance-1-5-pro")
			user := model.AuthUser{ID: "video-mode-user-" + uuid.NewString()}
			task, err := CreateGeneration(context.Background(), user, model.GenerationCommand{
				CommandVersion: 1, ClientRequestID: uuid.NewString(), ModelProfileID: "video-mode-profile", Source: string(model.SourceCanvas),
				Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "ordered frames", Settings: model.ScalarSettings{"videoMode": "frames", "durationSeconds": 20},
					References: model.GenerationReferences{Images: []model.MediaReference{{AssetID: "opening"}, {AssetID: "ending"}}[:count]},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			select {
			case body = <-requests:
			case <-time.After(5 * time.Second):
				t.Fatal("no upstream request")
			}
			// Wait through the public task seam so the worker finishes before settings are restored.
			deadline := time.Now().Add(5 * time.Second)
			for {
				current, err := GetGeneration(user.ID, task.ID)
				if err != nil {
					t.Fatal(err)
				}
				if current.Status == model.TaskStatusFailed {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("test provider response did not reach terminal state")
				}
				time.Sleep(10 * time.Millisecond)
			}
			want := []any{
				map[string]any{"type": "text", "text": "ordered frames"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://opening"}, "role": "first_frame"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://ending"}, "role": "last_frame"},
			}
			want = want[:count+1]
			if !reflect.DeepEqual(body["content"], want) {
				t.Fatalf("content = %#v, want %#v", body["content"], want)
			}
			if body["duration"] != float64(20) {
				t.Fatalf("administrator duration override lost: %#v", body)
			}
			if _, exists := body["videoMode"]; exists {
				t.Fatal("platform videoMode leaked into provider payload")
			}
		})
	}
}

func TestCreateGenerationRejectsInvalidFrameReferences(t *testing.T) {
	var submissions atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		submissions.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"invalid-frames","status":"failed"}`))
	}))
	defer upstream.Close()
	configureVideoModeTestProfile(t, upstream.URL, "seedance-1-5-pro")
	for _, tc := range []struct {
		name       string
		references model.GenerationReferences
		fieldPath  string
	}{
		{"three images", model.GenerationReferences{Images: []model.MediaReference{{AssetID: "a"}, {AssetID: "b"}, {AssetID: "c"}}}, "intent.references.images"},
		{"reference video", model.GenerationReferences{Videos: []model.MediaReference{{AssetID: "video"}}}, "intent.references.videos"},
		{"reference audio", model.GenerationReferences{Audios: []model.MediaReference{{AssetID: "audio"}}}, "intent.references.audios"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := model.AuthUser{ID: uuid.NewString()}
			task, err := CreateGeneration(context.Background(), user, model.GenerationCommand{
				CommandVersion: 1, ClientRequestID: uuid.NewString(), ModelProfileID: "video-mode-profile", Source: string(model.SourceCanvas),
				Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid frames", Settings: model.ScalarSettings{"videoMode": "frames"}, References: tc.references},
			})
			if err == nil {
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					current, _ := GetGeneration(user.ID, task.ID)
					if current.Status == model.TaskStatusFailed {
						break
					}
					time.Sleep(10 * time.Millisecond)
				}
			}
			var validation GenerationValidationError
			if !errors.As(err, &validation) || validation.Code != "INVALID_COMMAND" || validation.FieldPath != tc.fieldPath || validation.Retryable {
				t.Fatalf("error = %v, want non-retryable INVALID_COMMAND at %s", err, tc.fieldPath)
			}
		})
	}
	if submissions.Load() != 0 {
		t.Fatalf("invalid requests submitted upstream: %d", submissions.Load())
	}
}

func TestCreateGenerationRejectsUnsupportedVideoMode(t *testing.T) {
	for _, tc := range []struct {
		name, template string
		mode           any
	}{
		{"unknown", "seedance-1-5-pro", "unknown"},
		{"empty", "seedance-1-5-pro", ""},
		{"wrong case", "seedance-1-5-pro", "Frames"},
		{"null", "seedance-1-5-pro", nil},
		{"boolean", "seedance-1-5-pro", true},
		{"number", "seedance-1-5-pro", 1},
		{"object", "seedance-1-5-pro", map[string]any{"mode": "frames"}},
		{"sora frames", "sora-2", "frames"},
		{"sora reference", "sora-2", "reference"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			configureVideoModeTestProfile(t, "http://127.0.0.1:1", tc.template)
			_, err := CreateGeneration(context.Background(), model.AuthUser{ID: uuid.NewString()}, model.GenerationCommand{
				CommandVersion: 1, ClientRequestID: uuid.NewString(), ModelProfileID: "video-mode-profile", Source: string(model.SourceCanvas),
				Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid setting", Settings: model.ScalarSettings{"videoMode": tc.mode}},
			})
			var validation GenerationValidationError
			if !errors.As(err, &validation) || validation.Code != "INVALID_SETTING" || validation.FieldPath != "intent.settings.videoMode" || validation.Retryable {
				t.Fatalf("error = %v, want non-retryable INVALID_SETTING at intent.settings.videoMode", err)
			}
		})
	}
}

func TestCreateGenerationDefaultsToReferenceMode(t *testing.T) {
	requests := make(chan map[string]any, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		requests <- body
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"reference-upstream","status":"failed"}`))
	}))
	defer upstream.Close()
	configureVideoModeTestProfile(t, upstream.URL, "seedance-1-5-pro")
	user := model.AuthUser{ID: uuid.NewString()}
	command := model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: uuid.NewString(), ModelProfileID: "video-mode-profile", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "all references", References: model.GenerationReferences{
			Images: []model.MediaReference{{AssetID: "a"}, {AssetID: "b"}, {AssetID: "c"}},
			Videos: []model.MediaReference{{AssetID: "video"}}, Audios: []model.MediaReference{{AssetID: "audio"}},
		}},
	}
	task, err := CreateGeneration(context.Background(), user, command)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	select {
	case body = <-requests:
	case <-time.After(5 * time.Second):
		t.Fatal("no upstream request")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		current, err := GetGeneration(user.ID, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == model.TaskStatusFailed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("test provider response did not reach terminal state")
		}
		time.Sleep(10 * time.Millisecond)
	}
	command.Intent.Settings = model.ScalarSettings{"videoMode": "reference"}
	repeated, err := CreateGeneration(context.Background(), user, command)
	if err != nil || repeated.ID != task.ID {
		t.Fatalf("omitted and explicit reference must normalize to the same command: task = %#v, err = %v", repeated, err)
	}
	want := []any{
		map[string]any{"type": "text", "text": "all references"},
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://a"}, "role": "reference_image"},
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://b"}, "role": "reference_image"},
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": "asset://c"}, "role": "reference_image"},
		map[string]any{"type": "video_url", "video_url": map[string]any{"url": "asset://video"}, "role": "reference_video"},
		map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "asset://audio"}, "role": "reference_audio"},
	}
	if !reflect.DeepEqual(body["content"], want) {
		t.Fatalf("content = %#v, want %#v", body["content"], want)
	}
}

func TestCreateGenerationFramesKeepsMediaValidation(t *testing.T) {
	configureVideoModeTestProfile(t, "http://127.0.0.1:1", "seedance-1-5-pro")
	foreignID := uuid.NewString()
	if err := repository.CreateUserFile(model.UserFile{ID: foreignID, UserID: "other-user", FileType: "images", S3Key: "test/foreign.png", OriginalName: "foreign.png", MimeType: "image/png", CreatedAt: now()}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name      string
		reference model.MediaReference
		fieldPath string
	}{
		{"foreign file", model.MediaReference{FileID: foreignID}, ""},
		{"missing ID", model.MediaReference{}, "intent.references.images.0.fileId"},
		{"ambiguous ID", model.MediaReference{FileID: foreignID, AssetID: "asset"}, "intent.references.images.0"},
		{"invalid asset ID", model.MediaReference{AssetID: "asset://bad"}, "intent.references.images.0.assetId"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := CreateGeneration(context.Background(), model.AuthUser{ID: uuid.NewString()}, model.GenerationCommand{
				CommandVersion: 1, ClientRequestID: uuid.NewString(), ModelProfileID: "video-mode-profile", Source: string(model.SourceCanvas),
				Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "frames", Settings: model.ScalarSettings{"videoMode": "frames"}, References: model.GenerationReferences{Images: []model.MediaReference{tc.reference}}},
			})
			if tc.fieldPath == "" {
				if !errors.Is(err, ErrGenerationMediaForbidden) {
					t.Fatalf("error = %v, want forbidden media", err)
				}
			} else {
				var validation GenerationValidationError
				if !errors.As(err, &validation) || validation.Code != "INVALID_COMMAND" || validation.FieldPath != tc.fieldPath {
					t.Fatalf("error = %v, want INVALID_COMMAND at %s", err, tc.fieldPath)
				}
			}
		})
	}
}
