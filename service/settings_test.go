package service

import (
	"encoding/json"
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

func TestNormalizePublicSettingDefaultsNavigationVisibleAndPreservesHiddenItems(t *testing.T) {
	hidden := false
	setting := normalizePublicSetting(model.PublicSetting{
		Navigation: model.PublicNavigationSetting{
			Video: &hidden,
			StoryboardItems: model.PublicStoryboardNavigationSetting{
				ScriptAgent: &hidden,
			},
		},
	})

	if setting.Navigation.Enabled == nil || !*setting.Navigation.Enabled || setting.Navigation.Canvas == nil || !*setting.Navigation.Canvas {
		t.Fatal("navigation and unspecified items should default to visible")
	}
	if setting.Navigation.Video == nil || *setting.Navigation.Video {
		t.Fatal("explicitly hidden navigation item should stay hidden")
	}
	if setting.Navigation.StoryboardItems.BrainstormAgent == nil || !*setting.Navigation.StoryboardItems.BrainstormAgent {
		t.Fatal("unspecified storyboard item should default to visible")
	}
	if setting.Navigation.StoryboardItems.ScriptAgent == nil || *setting.Navigation.StoryboardItems.ScriptAgent {
		t.Fatal("explicitly hidden storyboard item should stay hidden")
	}
}

func TestNormalizePublicSettingKeepsLocalCanvasAgentHiddenByDefault(t *testing.T) {
	setting := normalizePublicSetting(model.PublicSetting{})
	if setting.Navigation.CanvasLocalAgent {
		t.Fatal("local Canvas Agent should be hidden by default")
	}

	setting = normalizePublicSetting(model.PublicSetting{Navigation: model.PublicNavigationSetting{CanvasLocalAgent: true}})
	if !setting.Navigation.CanvasLocalAgent {
		t.Fatal("explicitly enabled local Canvas Agent should stay visible")
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
				TextModels:        []string{"gpt-5.5"},
				ImageModels:       []string{"doubao-seedream-5.0-lite"},
				VideoModels:       []string{"doubao-seedance-2.0-fast"},
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

func TestNormalizeSettingsPublishesTextModelProtocolsFromEnabledChannels(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			DefaultTextModel: "brainstorm-gemini",
			TextModels:       []string{"brainstorm-gemini", "default-openai", "brainstorm-xvanai", "missing-model"},
		}},
		Private: model.PrivateSetting{Channels: []model.ModelChannel{
			{Enabled: true, Protocol: "gemini", Models: []string{"brainstorm-gemini"}},
			{Enabled: true, Models: []string{"default-openai"}},
			{Enabled: true, Protocol: "xvanai", Models: []string{"brainstorm-xvanai"}},
			{Enabled: false, Protocol: "openai", Models: []string{"brainstorm-gemini"}},
		}},
	})

	body, err := json.Marshal(settings.Public.ModelChannel)
	if err != nil {
		t.Fatal(err)
	}
	var publicContract struct {
		TextModelProtocols map[string]string `json:"textModelProtocols"`
	}
	if err := json.Unmarshal(body, &publicContract); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"brainstorm-gemini": "gemini",
		"default-openai":    "openai",
		"brainstorm-xvanai": "xvanai",
	}
	if !reflect.DeepEqual(publicContract.TextModelProtocols, want) {
		t.Fatalf("text model protocols = %#v, want %#v", publicContract.TextModelProtocols, want)
	}
}

func TestNormalizeSettingsOmitsConflictingTextModelProtocols(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			DefaultTextModel: "conflicted-model",
			TextModels:       []string{"conflicted-model", "consistent-model", "mixed-protocol-model"},
		}},
		Private: model.PrivateSetting{Channels: []model.ModelChannel{
			{Enabled: true, Protocol: "openai", Models: []string{"conflicted-model", "consistent-model"}},
			{Enabled: true, Protocol: "gemini", Models: []string{"conflicted-model"}},
			{Enabled: true, Protocol: "openai", Models: []string{"consistent-model"}},
			{Enabled: true, Protocol: "openai", Models: []string{"mixed-protocol-model"}},
			{Enabled: true, Protocol: "aidrama", Models: []string{"mixed-protocol-model"}},
		}},
	})

	channel := settings.Public.ModelChannel
	wantProtocols := map[string]string{"consistent-model": "openai"}
	if !reflect.DeepEqual(channel.TextModelProtocols, wantProtocols) {
		t.Fatalf("text model protocols = %#v, want %#v", channel.TextModelProtocols, wantProtocols)
	}
	if channel.DefaultTextModel != "conflicted-model" || !reflect.DeepEqual(channel.TextModels, []string{"conflicted-model", "consistent-model", "mixed-protocol-model"}) {
		t.Fatalf("default/allowlist changed while failing closed: %#v", channel)
	}
}

func TestNormalizeSettingsDropsCostsForUnselectedChannelModels(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			ModelCosts: []model.ModelCost{
				{Model: "gpt-image-1", Credits: credit(1)},
				{Model: "gpt-image-2-open-1-gen", Credits: credit(2)},
			},
		}},
		Private: model.PrivateSetting{Channels: []model.ModelChannel{{
			Enabled: true,
			Models:  []string{"gpt-image-1"},
		}}},
	})

	want := []model.ModelCost{{Model: "gpt-image-1", Credits: credit(1)}}
	if got := settings.Public.ModelChannel.ModelCosts; !reflect.DeepEqual(got, want) {
		t.Fatalf("model costs = %#v, want %#v", got, want)
	}
}

func TestResolveModelDisplayNameUsesConfiguredNameAndFallsBackToUpstreamModel(t *testing.T) {
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{
		{Model: "public-video", DisplayName: "精品视频模型"},
	}}}

	if got := ResolveModelDisplayName(public, "public-video", "vendor-video"); got != "精品视频模型" {
		t.Fatalf("display name = %q, want configured name", got)
	}
	if got := ResolveModelDisplayName(public, "missing-profile", "vendor-video"); got != "vendor-video" {
		t.Fatalf("display name = %q, want upstream fallback", got)
	}
}

func TestNormalizeSettingsPreservesExplicitCapabilityModels(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			TextModels:  []string{"gpt-5.5"},
			ImageModels: []string{"gpt-image-1"},
			VideoModels: []string{"public-video-1"},
			AudioModels: []string{"gpt-audio-1"},
		}},
		Private: model.PrivateSetting{
			Channels: []model.ModelChannel{{Enabled: true, Models: []string{
				"gpt-5.5", "gpt-5.6", "gpt-image-1", "gpt-image-2",
				"seedance-1", "seedance-2", "gpt-audio-1", "gpt-audio-2",
			}}},
			GenerationProfiles: []model.GenerationProfileBinding{
				{ID: "public-video-1", UpstreamModel: "seedance-1", Enabled: true},
				{ID: "public-video-2", UpstreamModel: "seedance-2", Enabled: true},
			},
		},
	})

	channel := settings.Public.ModelChannel
	for name, test := range map[string]struct {
		got  []string
		want []string
	}{
		"text":  {channel.TextModels, []string{"gpt-5.5"}},
		"image": {channel.ImageModels, []string{"gpt-image-1"}},
		"video": {channel.VideoModels, []string{"public-video-1"}},
		"audio": {channel.AudioModels, []string{"gpt-audio-1"}},
	} {
		t.Run(name, func(t *testing.T) {
			if !reflect.DeepEqual(test.got, test.want) {
				t.Fatalf("models = %#v, want %#v", test.got, test.want)
			}
		})
	}
}

func TestNormalizeSettingsKeepsExplicitImageRequestFormatsOnly(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			ImageModels: []string{"json-image", "multipart-image"},
			ImageRequestFormats: []model.ImageRequestFormatSetting{
				{Model: " json-image ", Format: " application/json "},
				{Model: "multipart-image", Format: "multipart/form-data"},
				{Model: "unknown-image", Format: "application/json"},
				{Model: "json-image", Format: "multipart/form-data"},
				{Model: "multipart-image", Format: "text/plain"},
			},
		}},
	})

	want := []model.ImageRequestFormatSetting{
		{Model: "json-image", Format: "application/json", CanvasRequestMode: "split", Resolutions: []string{"default"}},
		{Model: "multipart-image", Format: "multipart/form-data", CanvasRequestMode: "split", Resolutions: []string{"default"}},
	}
	if got := settings.Public.ModelChannel.ImageRequestFormats; !reflect.DeepEqual(got, want) {
		t.Fatalf("image request formats = %#v, want %#v", got, want)
	}
}

func TestNormalizeSettingsKeepsDefaultImageRequestFormat(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			ImageModels: []string{"default-image"},
			ImageRequestFormats: []model.ImageRequestFormatSetting{
				{Model: "default-image", Format: "default"},
			},
		}},
	})

	want := []model.ImageRequestFormatSetting{
		{Model: "default-image", Format: "default", CanvasRequestMode: "split", Resolutions: []string{"default"}},
	}
	if got := settings.Public.ModelChannel.ImageRequestFormats; !reflect.DeepEqual(got, want) {
		t.Fatalf("image request formats = %#v, want %#v", got, want)
	}
}

func TestNormalizeSettingsKeepsCanvasImageRequestModes(t *testing.T) {
	var settings model.Settings
	if err := json.Unmarshal([]byte(`{
		"public": {
			"modelChannel": {
				"imageModels": ["split-image", "generation-image", "default-image"],
				"imageRequestFormats": [
					{"model": "split-image", "format": "application/json", "canvasRequestMode": "split"},
					{"model": "generation-image", "format": "multipart/form-data", "canvasRequestMode": "generations"},
					{"model": "default-image", "format": "application/json", "canvasRequestMode": "unknown"}
				]
			}
		}
	}`), &settings); err != nil {
		t.Fatal(err)
	}

	normalized := normalizeSettings(settings)
	body, err := json.Marshal(normalized.Public.ModelChannel.ImageRequestFormats)
	if err != nil {
		t.Fatal(err)
	}
	var got []map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	want := []map[string]any{
		{"model": "split-image", "format": "application/json", "canvasRequestMode": "split", "resolutions": []any{"default"}},
		{"model": "generation-image", "format": "multipart/form-data", "canvasRequestMode": "generations", "resolutions": []any{"default"}},
		{"model": "default-image", "format": "application/json", "canvasRequestMode": "split", "resolutions": []any{"default"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("image request formats = %#v, want %#v", got, want)
	}
}

func TestNormalizeSettingsNormalizesImageRequestResolutions(t *testing.T) {
	var settings model.Settings
	if err := json.Unmarshal([]byte(`{
		"public": {
			"modelChannel": {
				"imageModels": ["default-image", "mixed-image", "empty-image", "invalid-image"],
				"imageRequestFormats": [
					{"model": "default-image", "format": "default", "resolutions": ["default", "2k"]},
					{"model": "mixed-image", "format": "default", "resolutions": [" 4k ", "1k", "2k", "1k"]},
					{"model": "empty-image", "format": "default", "resolutions": []},
					{"model": "invalid-image", "format": "default", "resolutions": ["8k"]}
				]
			}
		}
	}`), &settings); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(normalizeSettings(settings).Public.ModelChannel.ImageRequestFormats)
	if err != nil {
		t.Fatal(err)
	}
	var got []map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	want := []map[string]any{
		{"model": "default-image", "format": "default", "canvasRequestMode": "split", "resolutions": []any{"default"}},
		{"model": "mixed-image", "format": "default", "canvasRequestMode": "split", "resolutions": []any{"1k", "2k", "4k"}},
		{"model": "empty-image", "format": "default", "canvasRequestMode": "split", "resolutions": []any{"default"}},
		{"model": "invalid-image", "format": "default", "canvasRequestMode": "split", "resolutions": []any{"default"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("image request formats = %#v, want %#v", got, want)
	}
}

func TestNormalizeSettingsRequiresExplicitCapabilityModels(t *testing.T) {
	settings := normalizeSettings(model.Settings{
		Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
			DefaultImageModel: "gpt-image-1",
			DefaultVideoModel: "seedance-1",
			DefaultTextModel:  "gpt-5.5",
			DefaultAudioModel: "gpt-audio-1",
		}},
		Private: model.PrivateSetting{Channels: []model.ModelChannel{{Enabled: true, Models: []string{
			"gpt-5.5", "gpt-image-1", "seedance-1", "gpt-audio-1",
		}}}},
	})

	channel := settings.Public.ModelChannel
	for name, models := range map[string][]string{
		"text": channel.TextModels, "image": channel.ImageModels, "video": channel.VideoModels, "audio": channel.AudioModels,
	} {
		if len(models) != 0 {
			t.Fatalf("%s models = %#v, want no inferred models", name, models)
		}
	}
	if channel.DefaultTextModel != "" || channel.DefaultImageModel != "" || channel.DefaultVideoModel != "" || channel.DefaultAudioModel != "" {
		t.Fatalf("defaults = %#v, want empty defaults without explicit capability models", channel)
	}
}

func TestPublicModelAllowedUsesCapabilityLists(t *testing.T) {
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
		ImageModels: []string{"image-public"},
		VideoModels: []string{"video-public"},
		TextModels:  []string{"text-public"},
		AudioModels: []string{"audio-public"},
	}}
	for _, test := range []struct {
		taskType model.TaskType
		model    string
		allowed  bool
	}{
		{model.TaskTypeImage, "image-public", true},
		{model.TaskTypeVideo, "video-public", true},
		{model.TaskTypeChat, "text-public", true},
		{model.TaskTypeAudio, "audio-public", true},
		{model.TaskTypeVideo, "video-hidden", false},
		{model.TaskTypeImage, "video-public", false},
	} {
		if got := publicModelAllowed(public, test.taskType, test.model); got != test.allowed {
			t.Fatalf("publicModelAllowed(%s, %q) = %v, want %v", test.taskType, test.model, got, test.allowed)
		}
	}
}

func TestResolveGenerationProfilesAppliesOperationalBinding(t *testing.T) {
	maxDuration := 8
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "seedance-route", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"upstream-seedance"}}},
		GenerationProfiles: []model.GenerationProfileBinding{{
			ID: "stable-seedance", ProfileID: "seedance-1-5-pro", UpstreamModel: "upstream-seedance", ChannelName: "seedance-route", Enabled: true,
			LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &maxDuration},
		}},
	})
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{{Model: "upstream-seedance", DisplayName: "Seedance 展示", Credits: credit(7)}}}}

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, public)
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if len(profiles) != 1 {
		t.Fatalf("profiles = %#v", profiles)
	}
	profile := profiles[0]
	if profile.ID != "stable-seedance" || profile.DisplayName != "Seedance 展示" || profile.UpstreamModel != "upstream-seedance" || profile.ChannelName != "seedance-route" || !profile.Credits.Equal(credit(7)) {
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

func TestResolveGenerationProfilesRoutesSoraBinding(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{
			Protocol: "openai", Name: "openai", BaseURL: "https://api.openai.com", APIKey: "secret", Enabled: true,
			Models: []string{"sora-2-pro"},
		}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{
				ID: "sora-pro", ProfileID: "sora-2", UpstreamModel: "sora-2-pro", ChannelName: "openai", Enabled: true,
				Metadata: map[string]string{"action": "videogen"},
			},
		},
	})

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if len(profiles) != 1 || profiles[0].AdapterKey != "sora-videos-v1" || profiles[0].UpstreamModel != "sora-2-pro" || profiles[0].DisplayName != "sora-2-pro" {
		t.Fatalf("profiles = %#v", profiles)
	}
	if _, ok := profiles[0].Capabilities.Settings["generateAudio"]; ok {
		t.Fatalf("Sora profile exposed unsupported audio setting: %#v", profiles[0].Capabilities.Settings)
	}
	if profiles[0].Metadata["action"] != "videogen" {
		t.Fatalf("Sora profile metadata = %#v", profiles[0].Metadata)
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

func TestResolveGenerationProfilesPublishesPublicModelCosts(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"priced", "second-priced"}}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{ID: "first-price", ProfileID: "seedance-1-5-pro", UpstreamModel: "priced", ChannelName: "video", Enabled: true},
			{ID: "second-price", ProfileID: "seedance-1-5-pro", UpstreamModel: "second-priced", ChannelName: "video", Enabled: true},
		},
	})
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{{Model: "priced", Credits: credit(4)}, {Model: "second-priced", Credits: credit(5)}}}}

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, public)
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if !profiles[0].Credits.Equal(credit(4)) || !profiles[1].Credits.Equal(credit(5)) {
		t.Fatalf("credits = %s/%s, want 4/5", profiles[0].Credits.String(), profiles[1].Credits.String())
	}
}

func TestResolveGenerationProfilesPublishesPerCallCostByBindingID(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"vendor-video"}}},
		GenerationProfiles: []model.GenerationProfileBinding{{
			ID: "stable-video", ProfileID: "seedance-1-5-pro", UpstreamModel: "vendor-video", ChannelName: "video", BillingMode: model.BillingModePerCall, Enabled: true,
		}},
	})
	public := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{{Model: "stable-video", Credits: credit(7)}}}}

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, public)
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if len(profiles) != 1 || !profiles[0].Credits.Equal(credit(7)) {
		t.Fatalf("profiles = %#v", profiles)
	}
}

func TestGenerationProfileBindingMigratesLegacyCredits(t *testing.T) {
	var private model.PrivateSetting
	if err := json.Unmarshal([]byte(`{"generationProfiles":[{"id":"stable","profileId":"seedance-1-5-pro","upstreamModel":"vendor-seedance","credits":99,"enabled":true}]}`), &private); err != nil {
		t.Fatalf("unmarshal legacy setting: %v", err)
	}
	settings := normalizeSettings(model.Settings{Private: private})
	if len(settings.Public.ModelChannel.ModelCosts) != 1 || !reflect.DeepEqual(settings.Public.ModelChannel.ModelCosts[0], model.ModelCost{Model: "vendor-seedance", Credits: credit(99)}) {
		t.Fatalf("model costs = %#v", settings.Public.ModelChannel.ModelCosts)
	}
	encoded, err := json.Marshal(settings.Private)
	if err != nil {
		t.Fatalf("marshal setting: %v", err)
	}
	if !strings.Contains(string(encoded), `"credits":"99"`) {
		t.Fatalf("legacy credits lost: %s", encoded)
	}
}

func TestPublicModelCostOverridesLegacyCredits(t *testing.T) {
	legacyCredits := credit(99)
	settings := normalizeSettings(model.Settings{
		Public:  model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{ModelCosts: []model.ModelCost{{Model: "vendor-seedance", Credits: credit(5)}}}},
		Private: model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{UpstreamModel: "vendor-seedance", LegacyCredits: &legacyCredits}}},
	})
	if len(settings.Public.ModelChannel.ModelCosts) != 1 || !settings.Public.ModelChannel.ModelCosts[0].Credits.Equal(credit(5)) {
		t.Fatalf("model costs = %#v", settings.Public.ModelChannel.ModelCosts)
	}
}

func TestConflictingLegacyCreditsRequirePublicCost(t *testing.T) {
	zero, paid := credit(0), credit(99)
	settings := normalizeSettings(model.Settings{Private: model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{
		{ID: "free", UpstreamModel: "vendor-seedance", LegacyCredits: &zero},
		{ID: "paid", UpstreamModel: "vendor-seedance", LegacyCredits: &paid},
	}}})
	if len(settings.Public.ModelChannel.ModelCosts) != 0 {
		t.Fatalf("conflicting legacy costs migrated: %#v", settings.Public.ModelChannel.ModelCosts)
	}
}

func TestKeepLegacyGenerationCredits(t *testing.T) {
	credits := credit(9)
	settings := model.Settings{Private: model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{ID: "stable", UpstreamModel: "new-seedance"}}}}
	saved := model.Settings{Private: model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{ID: "stable", UpstreamModel: "vendor-seedance", LegacyCredits: &credits}}}}
	keepLegacyGenerationCredits(&settings, saved)
	if got := settings.Private.GenerationProfiles[0].LegacyCredits; got == nil || !got.Equal(credit(9)) {
		t.Fatalf("legacy credits = %#v", got)
	}
}

func TestNormalizePrivateSettingKeepsLegacyGenerationModel(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{GenerationProfiles: []model.GenerationProfileBinding{{UpstreamModel: " legacy-model "}}})
	binding := private.GenerationProfiles[0]
	if binding.ID != "legacy-model" || binding.UpstreamModel != "legacy-model" {
		t.Fatalf("binding = %#v", binding)
	}
}

func TestResolveGenerationProfilesAppliesResolutionLimits(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"limited", "preserved", "default"}}},
		GenerationProfiles: []model.GenerationProfileBinding{
			{ID: "limited", ProfileID: "seedance-1-5-pro", UpstreamModel: "limited", ChannelName: "video", Enabled: true, LimitOverrides: model.GenerationLimitOverrides{ResolutionValues: []string{"1080p", "480p"}}},
			{ID: "preserved", ProfileID: "seedance-1-5-pro", UpstreamModel: "preserved", ChannelName: "video", Enabled: true, LimitOverrides: model.GenerationLimitOverrides{ResolutionValues: []string{"1080p", "720p"}}},
			{ID: "default", ProfileID: "seedance-1-5-pro", UpstreamModel: "default", ChannelName: "video", Enabled: true},
		},
	})

	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	limited := profiles[0].Capabilities.Settings["resolution"]
	if !reflect.DeepEqual(limited.Values, []string{"1080p", "480p"}) || limited.Default != "1080p" {
		t.Fatalf("limited resolution = %#v", limited)
	}
	preserved := profiles[1].Capabilities.Settings["resolution"]
	if !reflect.DeepEqual(preserved.Values, []string{"1080p", "720p"}) || preserved.Default != "720p" {
		t.Fatalf("preserved resolution = %#v", preserved)
	}
	inherited := profiles[2].Capabilities.Settings["resolution"]
	if !reflect.DeepEqual(inherited.Values, []string{"480p", "720p", "1080p"}) || inherited.Default != "720p" {
		t.Fatalf("inherited resolution = %#v", inherited)
	}
	template := GenerationProfiles()[0].Capabilities.Settings["resolution"]
	if !reflect.DeepEqual(template.Values, []string{"480p", "720p", "1080p"}) || template.Default != "720p" {
		t.Fatalf("template resolution mutated: %#v", template)
	}

	settings, err := normalizeGenerationSettings(profiles[0], model.ScalarSettings{"resolution": "1080p"})
	if err != nil || settings["resolution"] != "1080p" {
		t.Fatalf("allowed resolution = %#v, err = %v", settings, err)
	}
	settings, err = normalizeGenerationSettings(profiles[0], nil)
	if err != nil || settings["resolution"] != "1080p" {
		t.Fatalf("default resolution = %#v, err = %v", settings, err)
	}
	if _, err = normalizeGenerationSettings(profiles[0], model.ScalarSettings{"resolution": "720p"}); err == nil {
		t.Fatal("excluded resolution accepted")
	} else if validationErr, ok := err.(GenerationValidationError); !ok || validationErr.Code != "INVALID_SETTING" || validationErr.FieldPath != "intent.settings.resolution" {
		t.Fatalf("error = %#v", err)
	}
}

func TestResolveGenerationProfilesRejectsUnsafeResolutionLimits(t *testing.T) {
	for name, values := range map[string][]string{
		"empty":     {},
		"unknown":   {"4k"},
		"mixed":     {"720p", "4k"},
		"duplicate": {"720p", "720p"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(model.PrivateSetting{
				Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"limited"}}},
				GenerationProfiles: []model.GenerationProfileBinding{{
					ID: "limited", ProfileID: "seedance-1-5-pro", UpstreamModel: "limited", ChannelName: "video", Enabled: true,
					LimitOverrides: model.GenerationLimitOverrides{ResolutionValues: values},
				}},
			}), model.PublicSetting{})
			if err == nil {
				t.Fatal("unsafe resolution limit accepted")
			}
		})
	}
}

func TestResolveGenerationProfilesPublishesCustomResolution(t *testing.T) {
	private := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"custom"}}},
		GenerationProfiles: []model.GenerationProfileBinding{{
			ID: "custom", ProfileID: "seedance-1-5-pro", UpstreamModel: "custom", ChannelName: "video", Enabled: true,
			LimitOverrides: model.GenerationLimitOverrides{ResolutionValues: []string{"480p", "720p", "1080p", "540p"}},
		}},
	})
	profiles, err := resolveGenerationProfiles(GenerationProfiles(), private, model.PublicSetting{})
	if err != nil {
		t.Fatalf("resolveGenerationProfiles: %v", err)
	}
	if got := profiles[0].Capabilities.Settings["resolution"].Values; !reflect.DeepEqual(got, []string{"480p", "720p", "1080p", "540p"}) {
		t.Fatalf("published resolutions = %v", got)
	}
	settings, err := normalizeGenerationSettings(profiles[0], model.ScalarSettings{"resolution": "540p"})
	if err != nil || settings["resolution"] != "540p" {
		t.Fatalf("submitted resolution = %v, err = %v", settings["resolution"], err)
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

func TestResolveGenerationProfilesAllowsAdministratorDurationMaxAboveTemplate(t *testing.T) {
	for _, test := range []struct {
		name      string
		profileID string
		model     string
	}{
		{name: "seedance", profileID: "seedance-1-5-pro", model: "upstream-seedance"},
		{name: "sora", profileID: "sora-2", model: "upstream-sora"},
		{name: "vidu drama", profileID: "vidu-q3-drama", model: "upstream-vidu"},
	} {
		t.Run(test.name, func(t *testing.T) {
			maxDuration := 30
			profiles, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(model.PrivateSetting{
				Channels: []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{test.model}}},
				GenerationProfiles: []model.GenerationProfileBinding{{
					ID: test.name, ProfileID: test.profileID, UpstreamModel: test.model, ChannelName: "video", Enabled: true,
					LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &maxDuration},
				}},
			}), model.PublicSetting{})
			if err != nil {
				t.Fatalf("resolveGenerationProfiles: %v", err)
			}
			if got := *profiles[0].Capabilities.Settings["durationSeconds"].Max; got != 30 {
				t.Fatalf("duration max = %d, want 30", got)
			}
			if _, err = normalizeGenerationSettings(profiles[0], model.ScalarSettings{"durationSeconds": 30}); err != nil {
				t.Fatalf("administrator duration max rejected: %v", err)
			}
			if _, err = normalizeGenerationSettings(profiles[0], model.ScalarSettings{"durationSeconds": 31}); err == nil {
				t.Fatal("duration above administrator max accepted")
			}
		})
	}
}

func TestResolveGenerationProfilesRejectsUnsafeOrUnroutableBindings(t *testing.T) {
	unsafeMax := 3
	for name, binding := range map[string]model.GenerationProfileBinding{
		"below minimum duration": {ProfileID: "seedance-1-5-pro", UpstreamModel: "upstream-seedance", Enabled: true, LimitOverrides: model.GenerationLimitOverrides{DurationSecondsMax: &unsafeMax}},
		"missing channel":        {ProfileID: "seedance-1-5-pro", UpstreamModel: "missing-model", Enabled: true},
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
