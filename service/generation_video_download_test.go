package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestGenerationVideoDownloadAuthentication(t *testing.T) {
	for _, testCase := range []struct {
		name, path, adapter string
		authenticated       bool
	}{
		{"provider content", "/v1/videos/provider-task/content", "sora-videos-v1", true},
		{"ordinary CDN", "/video.mp4", "sora-videos-v1", false},
		{"different task", "/v1/videos/another-task/content", "sora-videos-v1", false},
		{"different adapter", "/v1/videos/provider-task/content", "seedance-contents-v1", false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var advertisedCalls, channelCalls atomic.Int32
			advertised := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				advertisedCalls.Add(1)
				if r.Header.Get("Authorization") != "" {
					t.Error("channel credentials reached the advertised media host")
				}
				if testCase.authenticated {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				_, _ = w.Write([]byte("video"))
			}))
			defer advertised.Close()
			channel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				channelCalls.Add(1)
				if r.URL.Path != "/v1/videos/provider-task/content" || r.Header.Get("Authorization") != "Bearer channel-secret" {
					t.Error("canonical channel download lacked the expected path or authentication")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				_, _ = w.Write([]byte("video"))
			}))
			defer channel.Close()
			previous := generationRouteChannel
			defer func() { generationRouteChannel = previous }()
			generationRouteChannel = func(channelID, modelName string) (model.ModelChannel, error) {
				if channelID != "saved-channel" || modelName != "wan3.0-video" {
					t.Error("download did not use the task route snapshot")
				}
				return model.ModelChannel{BaseURL: channel.URL, APIKey: "channel-secret"}, nil
			}
			task := model.GenerationTask{AdapterKey: testCase.adapter, UpstreamTaskID: "provider-task", ChannelID: "saved-channel", UpstreamModel: "wan3.0-video"}
			response, err := downloadGenerationVideo(context.Background(), task, advertised.URL+testCase.path)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || string(body) != "video" {
				t.Fatalf("download body=%q err=%v", body, err)
			}
			if testCase.authenticated && (channelCalls.Load() != 1 || advertisedCalls.Load() != 0) {
				t.Fatal("provider content was not downloaded exclusively through the saved channel")
			}
			if !testCase.authenticated && (channelCalls.Load() != 0 || advertisedCalls.Load() != 1) {
				t.Fatal("ordinary media unexpectedly used the authenticated channel")
			}
		})
	}
}

func TestGenerationVideoAuthenticatedDownloadRejectsRedirect(t *testing.T) {
	for _, sameOrigin := range []bool{true, false} {
		t.Run(map[bool]string{true: "same origin", false: "external origin"}[sameOrigin], func(t *testing.T) {
			var redirectedCalls atomic.Int32
			external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				redirectedCalls.Add(1)
				_, _ = w.Write([]byte("video"))
			}))
			defer external.Close()
			var channel *httptest.Server
			channel = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/videos/provider-task/content" {
					redirectedCalls.Add(1)
					_, _ = w.Write([]byte("video"))
					return
				}
				target := external.URL
				if sameOrigin {
					target = channel.URL + "/redirected.mp4"
				}
				http.Redirect(w, r, target, http.StatusFound)
			}))
			defer channel.Close()
			previous := generationRouteChannel
			defer func() { generationRouteChannel = previous }()
			generationRouteChannel = func(string, string) (model.ModelChannel, error) {
				return model.ModelChannel{BaseURL: channel.URL, APIKey: "channel-secret"}, nil
			}
			task := model.GenerationTask{AdapterKey: "sora-videos-v1", UpstreamTaskID: "provider-task"}
			response, err := downloadGenerationVideo(context.Background(), task, channel.URL+"/v1/videos/provider-task/content")
			if response != nil {
				response.Body.Close()
			}
			if err == nil || !strings.Contains(err.Error(), "302") || redirectedCalls.Load() != 0 {
				t.Fatalf("authenticated redirect must fail without following: err=%v requests=%d", err, redirectedCalls.Load())
			}
		})
	}
}
