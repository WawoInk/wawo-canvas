package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestVideoBindingMetadataKeepsJSONTypesInUpstreamRequest(t *testing.T) {
	var got map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode upstream request: %v", err)
		}
		_, _ = w.Write([]byte(`{"id":"upstream-1","status":"queued"}`))
	}))
	defer upstream.Close()

	var binding model.GenerationProfileBinding
	if err := json.Unmarshal([]byte(`{"id":"video","profileId":"sora-2","upstreamModel":"sora-2","channelName":"video","enabled":true,"metadata":{"count":7,"enabled":true,"mode":"fast"}}`), &binding); err != nil {
		t.Fatalf("decode admin binding: %v", err)
	}
	profiles, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(model.PrivateSetting{
		Channels:           []model.ModelChannel{{Name: "video", BaseURL: upstream.URL, APIKey: "secret", Enabled: true, Models: []string{"sora-2"}}},
		GenerationProfiles: []model.GenerationProfileBinding{binding},
	}), model.PublicSetting{})
	if err != nil || len(profiles) != 1 {
		t.Fatalf("resolve binding: profiles=%#v err=%v", profiles, err)
	}
	_, err = NewSoraVideosV1Adapter(upstream.Client()).Create(context.Background(), AdapterCreateRequest{
		Profile: profiles[0], Channel: model.ModelChannel{BaseURL: upstream.URL, APIKey: "secret"},
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "视频"}, Metadata: profiles[0].Metadata,
	})
	if err != nil {
		t.Fatalf("create upstream task: %v", err)
	}
	want := map[string]any{"count": float64(7), "enabled": true, "mode": "fast", "aspect_ratio": "16:9"}
	if !reflect.DeepEqual(got["metadata"], want) {
		t.Fatalf("upstream metadata = %#v, want %#v", got["metadata"], want)
	}
}

func TestVideoBindingRejectsUnsupportedMetadataValues(t *testing.T) {
	for _, value := range []any{2.5, []any{"unexpected"}, nil} {
		settings := model.Settings{Private: model.PrivateSetting{
			Channels:           []model.ModelChannel{{Name: "video", BaseURL: "https://example.com", APIKey: "secret", Enabled: true, Models: []string{"sora-2"}}},
			GenerationProfiles: []model.GenerationProfileBinding{{ID: "video", ProfileID: "sora-2", UpstreamModel: "sora-2", ChannelName: "video", Enabled: true, Metadata: map[string]any{"bad": value}}},
		}}
		if err := ValidateGenerationBindings(settings); err == nil {
			t.Fatalf("accepted metadata value %#v", value)
		}
	}
}
