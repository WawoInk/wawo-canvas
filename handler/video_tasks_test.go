package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

func TestDurableCompatibilityVideoTaskOwnershipAcrossFollowUpRoutes(t *testing.T) {
	key := uuid.NewString()
	upstreamTaskID := "compat-owned-" + key
	remixTaskID := "compat-remix-" + key
	var mu sync.Mutex
	var requests []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests = append(requests, r.Method+" "+r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/remix"):
			_, _ = w.Write([]byte(`{"id":"` + remixTaskID + `","status":"queued"}`))
		case r.Method == http.MethodPost:
			_, _ = w.Write([]byte(`{"id":"` + upstreamTaskID + `","status":"queued"}`))
		case r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`{"id":"` + upstreamTaskID + `","status":"running"}`))
		case r.Method == http.MethodDelete:
			_, _ = w.Write([]byte(`{"id":"` + upstreamTaskID + `","status":"cancelled"}`))
		}
	}))
	defer upstream.Close()

	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	settings := previousSettings
	channelName := "compat-ownership-channel-" + key
	settings.Private.Channels = []model.ModelChannel{{Name: channelName, Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true, Weight: 1, Models: []string{"seedance-1-5-pro"}}}
	settings.Private.GenerationProfiles = []model.GenerationProfileBinding{{ID: "seedance-1-5-pro", ProfileID: "seedance-1-5-pro", UpstreamModel: "seedance-1-5-pro", ChannelName: channelName, BillingMode: model.BillingModePerCall, Enabled: true}}
	settings.Public.ModelChannel.VideoModels = []string{"seedance-1-5-pro"}
	settings.Public.ModelChannel.ModelCosts = []model.ModelCost{{Model: "seedance-1-5-pro", Credits: model.DecimalZero}}
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	t.Cleanup(func() { _, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano)) })

	ownerID := "compat-owner-" + key
	otherID := "compat-other-" + key
	create := videoTaskRequest(t, http.MethodPost, "/api/v1/contents/generations/tasks", ownerID, `{"model":"seedance-1-5-pro","content":[{"type":"text","text":"test"}]}`)
	createResponse := httptest.NewRecorder()
	CreateVideoTask(createResponse, create)
	if createResponse.Code != http.StatusOK || !strings.Contains(createResponse.Body.String(), upstreamTaskID) {
		t.Fatalf("create response = %d %s", createResponse.Code, createResponse.Body.String())
	}
	owned, err := repository.GetVideoTaskByTaskIDAndUser(upstreamTaskID, ownerID)
	if err != nil || owned.Model != "seedance-1-5-pro" {
		t.Fatalf("durable ownership = %#v, err = %v", owned, err)
	}
	if _, err := repository.GetVideoTaskByTaskIDAndUser(upstreamTaskID, otherID); err == nil {
		t.Fatal("foreign user unexpectedly owns durable task")
	}

	getResponse := httptest.NewRecorder()
	GetVideoTask(getResponse, videoTaskRequest(t, http.MethodGet, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"?model=seedance-1-5-pro", ownerID, ""), upstreamTaskID)
	if getResponse.Code != http.StatusOK || !strings.Contains(getResponse.Body.String(), `"status":"running"`) {
		t.Fatalf("get response = %d %s", getResponse.Code, getResponse.Body.String())
	}
	assertVideoTaskForbidden(t, func(w http.ResponseWriter, r *http.Request) { GetVideoTask(w, r, upstreamTaskID) }, videoTaskRequest(t, http.MethodGet, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"?model=seedance-1-5-pro", otherID, ""))

	remixResponse := httptest.NewRecorder()
	RemixVideoTask(remixResponse, videoTaskRequest(t, http.MethodPost, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"/remix", ownerID, `{"model":"seedance-1-5-pro","prompt":"remix"}`), upstreamTaskID)
	if remixResponse.Code != http.StatusOK || !strings.Contains(remixResponse.Body.String(), remixTaskID) {
		t.Fatalf("remix response = %d %s", remixResponse.Code, remixResponse.Body.String())
	}
	if _, err := repository.GetVideoTaskByTaskIDAndUser(remixTaskID, ownerID); err != nil {
		t.Fatalf("remix ownership: %v", err)
	}
	assertVideoTaskForbidden(t, func(w http.ResponseWriter, r *http.Request) { RemixVideoTask(w, r, upstreamTaskID) }, videoTaskRequest(t, http.MethodPost, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"/remix", otherID, `{"model":"seedance-1-5-pro"}`))
	assertVideoTaskForbidden(t, func(w http.ResponseWriter, r *http.Request) { CancelVideoTask(w, r, upstreamTaskID) }, videoTaskRequest(t, http.MethodDelete, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"?model=seedance-1-5-pro", otherID, ""))

	cancelResponse := httptest.NewRecorder()
	CancelVideoTask(cancelResponse, videoTaskRequest(t, http.MethodDelete, "/api/v1/contents/generations/tasks/"+upstreamTaskID+"?model=seedance-1-5-pro", ownerID, ""), upstreamTaskID)
	if cancelResponse.Code != http.StatusOK || !strings.Contains(cancelResponse.Body.String(), `"status":"cancelled"`) {
		t.Fatalf("cancel response = %d %s", cancelResponse.Code, cancelResponse.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 4 {
		t.Fatalf("upstream requests = %#v; foreign operations must not be forwarded", requests)
	}
}

func videoTaskRequest(t *testing.T, method, target, userID, body string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return request.WithContext(service.WithUser(request.Context(), model.AuthUser{ID: userID, Role: model.UserRoleUser}))
}

func assertVideoTaskForbidden(t *testing.T, handler http.HandlerFunc, request *http.Request) {
	t.Helper()
	response := httptest.NewRecorder()
	handler(response, request)
	body, err := io.ReadAll(response.Result().Body)
	if err != nil || !strings.Contains(string(body), "任务不存在或无权操作") {
		t.Fatalf("forbidden response = %q, err = %v", body, err)
	}
}
