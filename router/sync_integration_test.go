package router_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/google/uuid"
)

type syncHTTPDomain[T any] struct {
	Cursor  string   `json:"cursor"`
	Updates []T      `json:"updates"`
	Deletes []string `json:"deletes"`
}

type syncHTTPData struct {
	Cursor string                               `json:"cursor"`
	Assets syncHTTPDomain[model.Asset]          `json:"assets"`
	Canvas syncHTTPDomain[model.CanvasProject]  `json:"canvas"`
	Tasks  syncHTTPDomain[model.GenerationTask] `json:"tasks"`
}

func TestSyncHTTPColdStartAndAssetCursor(t *testing.T) {
	previousConfig := config.Cfg
	config.Cfg.JWTSecret, config.Cfg.JWTExpireHours = "sync-http-test-secret", 168
	t.Cleanup(func() { config.Cfg = previousConfig })
	server := httptest.NewServer(router.New())
	defer server.Close()
	first := registerUser(t, server.URL, "sync-first-"+uuid.NewString())
	response := doJSON[syncHTTPData](t, http.MethodGet, server.URL+"/api/v1/sync", first.Token, nil)
	if response.Code != 0 {
		t.Fatalf("cold-start sync = %#v", response)
	}
	data := response.Data
	if data.Cursor != "" || data.Canvas.Cursor != "0" || len(data.Assets.Updates) != 0 || len(data.Assets.Deletes) != 0 || len(data.Canvas.Updates) != 0 || len(data.Canvas.Deletes) != 0 || len(data.Tasks.Updates) != 0 || len(data.Tasks.Deletes) != 0 {
		t.Fatalf("new user sync domains = %#v", data)
	}
	if data.Assets.Updates == nil || data.Assets.Deletes == nil || data.Canvas.Updates == nil || data.Canvas.Deletes == nil || data.Tasks.Updates == nil || data.Tasks.Deletes == nil {
		t.Fatalf("empty sync domains must contain arrays: %#v", data)
	}
	createAsset := func(token, title string) model.Asset {
		result := doJSON[model.Asset](t, http.MethodPost, server.URL+"/api/v1/assets", token, model.Asset{Type: model.AssetTypeText, Title: title, Content: title})
		if result.Code != 0 || result.Data.ID == "" {
			t.Fatalf("create sync asset = %#v", result)
		}
		return result.Data
	}
	deleteAsset := func(token, id string) {
		result := doJSON[map[string]string](t, http.MethodDelete, server.URL+"/api/v1/assets/"+id, token, nil)
		if result.Code != 0 || result.Data["id"] != id {
			t.Fatalf("delete sync asset = %#v", result)
		}
	}
	createPair := func(token, title string) (model.Asset, []string) {
		live := createAsset(token, title)
		deleted := createAsset(token, title+"-deleted")
		deleteAsset(token, deleted.ID)
		return live, []string{deleted.ID}
	}
	firstLive, firstDeletes := createPair(first.Token, "first-live")
	second := registerUser(t, server.URL, "sync-second-"+uuid.NewString())
	secondLive, secondDeletes := createPair(second.Token, "second-live")
	firstSync := doJSON[syncHTTPData](t, http.MethodGet, server.URL+"/api/v1/sync", first.Token, nil)
	secondSync := doJSON[syncHTTPData](t, http.MethodGet, server.URL+"/api/v1/sync", second.Token, nil)
	for _, expected := range []struct {
		response apiResponse[syncHTTPData]
		live     model.Asset
		deletes  []string
	}{
		{firstSync, firstLive, firstDeletes},
		{secondSync, secondLive, secondDeletes},
	} {
		assets := expected.response.Data.Assets
		if expected.response.Code != 0 || len(assets.Updates) != 1 || assets.Updates[0].ID != expected.live.ID || assets.Updates[0].Content != expected.live.Content || !slices.Equal(assets.Deletes, expected.deletes) {
			t.Fatalf("sync must expose only this user's live assets and tombstones: %#v", expected.response)
		}
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, firstLive.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	fractionalCursor := updatedAt.Add(time.Nanosecond).UTC().Format(time.RFC3339Nano)
	fractional := doJSON[syncHTTPData](t, http.MethodGet, server.URL+"/api/v1/sync?domains=assets&cursor="+url.QueryEscape(fractionalCursor), first.Token, nil)
	if fractional.Code != 0 || len(fractional.Data.Assets.Updates) != 0 {
		t.Fatalf("fractional cursor must exclude the earlier second-precision asset: %#v", fractional)
	}
	if firstSync.Data.Cursor == "" {
		t.Fatal("sync with assets and tombstones returned no cursor")
	}
	nextURL := server.URL + "/api/v1/sync?cursor=" + url.QueryEscape(firstSync.Data.Cursor) + "&canvasCursor=" + url.QueryEscape(firstSync.Data.Canvas.Cursor)
	next := doJSON[syncHTTPData](t, http.MethodGet, nextURL, first.Token, nil)
	if next.Code != 0 || len(next.Data.Assets.Updates) != 0 || len(next.Data.Assets.Deletes) != 0 || len(next.Data.Canvas.Updates) != 0 || len(next.Data.Canvas.Deletes) != 0 || len(next.Data.Tasks.Updates) != 0 || len(next.Data.Tasks.Deletes) != 0 || next.Data.Cursor != firstSync.Data.Cursor {
		t.Fatalf("returned cursor must not replay old updates or deletes: cursor=%s next=%#v", firstSync.Data.Cursor, next)
	}
}
