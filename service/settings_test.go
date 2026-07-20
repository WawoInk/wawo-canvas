package service

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestFetchAdminChannelModelsParsesOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer server.Close()

	models, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("fetchAdminChannelModels returned error: %v", err)
	}
	if want := []string{"a-model", "z-model"}; !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %#v, want %#v", models, want)
	}
}

func TestFetchAdminChannelModelsReportsArkPlanModelsUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plan/v3/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL + "/api/plan/v3/contents/generations/tasks",
		APIKey:  "test-key",
	})
	if err == nil {
		t.Fatal("expected unsupported /models error")
	}
	if !strings.Contains(err.Error(), "Agent Plan 未提供 OpenAI /models") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestBuildModelChannelURLNormalizesArkPlanTaskPath(t *testing.T) {
	got := BuildModelChannelURL(model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?debug=1"}, "/models")
	want := "https://ark.cn-beijing.volces.com/api/plan/v3/models"
	if got != want {
		t.Fatalf("BuildModelChannelURL = %q, want %q", got, want)
	}
}

func TestNormalizeSettingsPublishesEnabledChannelModelsAndRepairsDefaults(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{
			ModelChannel: model.PublicModelChannelSetting{
				AvailableModels:   []string{"grok-imagine-video", "disabled-model"},
				DefaultModel:      "grok-imagine-video",
				DefaultTextModel:  "missing-text",
				DefaultImageModel: "missing-image",
				DefaultVideoModel: "missing-video",
			},
		},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{
				{Enabled: true, Models: []string{"gpt-5.5", "doubao-seedream-5.0-lite", "doubao-seedance-2.0-fast", "gpt-5.5"}},
				{Enabled: false, Models: []string{"disabled-model"}},
			},
		},
	})

	channel := settings.Public.ModelChannel
	wantModels := []string{"gpt-5.5", "doubao-seedream-5.0-lite", "doubao-seedance-2.0-fast"}
	if !reflect.DeepEqual(channel.AvailableModels, wantModels) {
		t.Fatalf("available models = %#v, want %#v", channel.AvailableModels, wantModels)
	}
	if channel.DefaultModel != "gpt-5.5" {
		t.Fatalf("default model = %q, want text model", channel.DefaultModel)
	}
	if channel.DefaultTextModel != "gpt-5.5" {
		t.Fatalf("default text model = %q, want text model", channel.DefaultTextModel)
	}
	if channel.DefaultImageModel != "doubao-seedream-5.0-lite" {
		t.Fatalf("default image model = %q, want seedream", channel.DefaultImageModel)
	}
	if channel.DefaultVideoModel != "doubao-seedance-2.0-fast" {
		t.Fatalf("default video model = %q, want seedance", channel.DefaultVideoModel)
	}
	if !reflect.DeepEqual(channel.VideoModels, []string{"doubao-seedance-2.0-fast"}) {
		t.Fatalf("video models = %#v, want enabled seedance model", channel.VideoModels)
	}
}

func TestResolveGenerationProfilesAppliesOperationalBinding(t *testing.T) {
	credits := 7
	maxDuration := 8
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "seedance-route", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"upstream-seedance"}}},
		GenerationProfiles: []model.GenerationProfileBinding{{
			ID: "stable-seedance", ProfileID: "seedance-1-5-pro", UpstreamModel: "upstream-seedance", ChannelName: "seedance-route", Credits: &credits, Enabled: true,
			LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &maxDuration},
		}},
	})

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if len(profiles) != 1 {
		t.Fatalf("profiles = %#v", profiles)
	}
	profile := profiles[0]
	if profile.ID != "stable-seedance" || profile.UpstreamModel != "upstream-seedance" || profile.ChannelName != "seedance-route" || profile.Credits != 7 {
		t.Fatalf("profile = %#v", profile)
	}
	if max := profile.Capabilities.Settings["durationSeconds"].Max; max == nil || *max != 8 {
		t.Fatalf("duration max = %#v, want 8", max)
	}
}

func TestResolveGenerationProfilesRoutesDynamicModelsThroughOneChannel(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{
			Protocol: "xvanai", Name: "xvanai", BaseURL: "https://example.com", APIKey: "secret", Enabled: true,
			Models: []string{"doubao-seedance-2-0-pro", "vidu-q3-pro"},
		}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{ID: "seedance-pro", ProfileID: "seedance-1-5-pro", UpstreamModel: "doubao-seedance-2-0-pro", ChannelName: "xvanai", Enabled: true},
			{ID: "vidu-drama", ProfileID: "vidu-q3-drama", UpstreamModel: "vidu-q3-pro", ChannelName: "xvanai", Enabled: true},
		},
	})

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("profiles = %#v", profiles)
	}
	if profiles[0].AdapterKey != "seedance-contents-v1" || profiles[0].UpstreamModel != "doubao-seedance-2-0-pro" || profiles[0].ChannelName != "xvanai" {
		t.Fatalf("seedance profile = %#v", profiles[0])
	}
	if profiles[1].AdapterKey != "vidu-short-drama-v1" || profiles[1].UpstreamModel != "vidu-q3-pro" || profiles[1].ChannelName != "xvanai" {
		t.Fatalf("vidu profile = %#v", profiles[1])
	}
}

func TestResolveGenerationProfilesRejectsMultiModelBinding(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "xvanai", Enabled: true, Models: []string{"seedance-2.0", "vidu-i2v"}}},
		GenerationProfiles: []model.GenerationProfileBinding{{
			ID: "video", ProfileID: "seedance-1-5-pro", UpstreamModels: []string{"seedance-2.0", "vidu-i2v"}, ChannelName: "xvanai", Enabled: true,
		}},
	})

	if _, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{}); err == nil {
		t.Fatal("multi-model binding accepted")
	}
}

func TestResolveGenerationProfilesPublishesEffectiveBillingCredits(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"priced", "override"}}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{ID: "public-price", ProfileID: "seedance-1-5-pro", UpstreamModel: "priced", ChannelName: "video", Enabled: true},
			{ID: "binding-price", ProfileID: "seedance-1-5-pro", UpstreamModel: "override", ChannelName: "video", Credits: intPtr(9), Enabled: true},
		},
	})
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{{Model: "priced", Credits: 4}, {Model: "override", Credits: 5}}}}

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, public)
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if profiles[0].Credits != 4 || profiles[1].Credits != 9 {
		t.Fatalf("credits = %d/%d, want 4/9", profiles[0].Credits, profiles[1].Credits)
	}
}

func TestNormalizePrivateSettingKeepsLegacyGenerationModel(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{UpstreamModel: " legacy-model "}}})
	binding := private.GenerationProfiles[0]
	if binding.ID != "legacy-model" || binding.UpstreamModel != "legacy-model" {
		t.Fatalf("binding = %#v", binding)
	}
}

func TestResolveGenerationProfilesDoesNotShareLimitOverrides(t *testing.T) {
	maxDuration := 8
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"limited", "default"}}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{ID: "limited-profile", ProfileID: "seedance-1-5-pro", UpstreamModels: []string{"limited"}, ChannelName: "video", Enabled: true, LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &maxDuration}},
			{ID: "default-profile", ProfileID: "seedance-1-5-pro", UpstreamModels: []string{"default"}, ChannelName: "video", Enabled: true},
		},
	})

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if got := *profiles[0].Capabilities.Settings["durationSeconds"].Max; got != 8 {
		t.Fatalf("limited max = %d, want 8", got)
	}
	if got := *profiles[1].Capabilities.Settings["durationSeconds"].Max; got != 15 {
		t.Fatalf("default max = %d, want 15", got)
	}
}

func TestResolveGenerationProfilesRejectsUnsafeOrUnroutableBindings(t *testing.T) {
	unsafeMax := 16
	for name, binding := range map[string]model.GenerationProfileBinding{
		"unsafe limit":    {ProfileID: "seedance-1-5-pro", UpstreamModel: "upstream-seedance", Enabled: true, LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &unsafeMax}},
		"missing channel": {ProfileID: "seedance-1-5-pro", UpstreamModel: "missing-model", Enabled: true},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(model.PrivateSetting{
				Channels:           []model.ModelChannel{{Name: "seedance-route", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"upstream-seedance"}}},
				GenerationProfiles: []model.GenerationProfileBinding{binding},
			}), model.PublicSetting{})
			if err == nil {
				t.Fatal("invalid binding accepted")
			}
		})
	}
}

func TestResolveGenerationProfilesAllowsExplicitDisable(t *testing.T) {
	profiles, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{ProfileID: "seedance-1-5-pro", Enabled: false}}}), model.PublicSetting{})
	if err != nil || len(profiles) != 0 {
		t.Fatalf("profiles = %#v, err = %v", profiles, err)
	}
}

func TestValidateGenerationBindingsAllowsDynamicChannelModelsWithoutExplicitProfiles(t *testing.T) {
	settings := model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{{
		Protocol: "xvanai", Name: "xvanai", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"doubao-seedance-2-0-pro", "vidu-q3-pro"},
	}}}}

	if err := ValidateGenerationBindings(settings); err != nil {
		t.Fatalf("dynamic channel models rejected: %v", err)
	}
}

func TestGenerationProfileForTaskUsesSnapshotAdapterAndLegacyTemplateFallback(t *testing.T) {
	previousProfiles := generationProfiles
	generationProfiles = func() []model.GenerationProfile { return nil }
	defer func() { generationProfiles = previousProfiles }()

	profile, ok := generationProfileForTask(model.GenerationTask{
		Model:          "vidu-headtail",
		ModelProfileID: "removed-binding",
		AdapterKey:     "seedance-contents-v1",
		UpstreamModel:  "vidu-headtail",
	})
	if !ok || profile.AdapterKey != "seedance-contents-v1" || profile.UpstreamModel != "vidu-headtail" {
		t.Fatalf("profile = %#v, ok = %v", profile, ok)
	}

	legacy, ok := generationProfileForTask(model.GenerationTask{Model: "seedance-legacy", ModelProfileID: "seedance-1-5-pro"})
	if !ok || legacy.AdapterKey != "seedance-contents-v1" || legacy.UpstreamModel != "seedance-legacy" {
		t.Fatalf("legacy profile = %#v, ok = %v", legacy, ok)
	}
}

func TestNormalizePrivateSettingAcceptsGeminiProtocol(t *testing.T) {
	got := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{
			{Protocol: "gemini", Name: "g", BaseURL: "https://x", APIKey: "k", Models: []string{"gemini-2.5-flash"}},
			{Protocol: "", Name: "o", BaseURL: "https://y", APIKey: "k", Models: []string{"gpt-5.5"}},
		},
	})
	if got.Channels[0].Protocol != "gemini" {
		t.Fatalf("gemini protocol should be preserved, got %q", got.Channels[0].Protocol)
	}
	if got.Channels[1].Protocol != "openai" {
		t.Fatalf("empty protocol should default to openai, got %q", got.Channels[1].Protocol)
	}
}
