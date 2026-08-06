package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/google/uuid"
)

type apiResponse[T any] struct {
	Code int    `json:"code"`
	Data T      `json:"data"`
	Msg  string `json:"msg"`
}

func TestGenerationHTTPSeam(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "generation-http-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	upstreamRequests := make(chan string, 4)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamRequests <- r.Method + " " + r.URL.Path
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"temporary provider outage"}}`))
	}))
	defer upstream.Close()

	settings := previousSettings
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: "seedance-1-5-pro", Credits: credit(0)})
	settings.Public.ModelChannel.VideoModels = append(settings.Public.ModelChannel.VideoModels, "seedance-1-5-pro")
	settings.Private.Channels = append(settings.Private.Channels, model.ModelChannel{
		Protocol: "openai", Name: "generation-http-" + uuid.NewString(), BaseURL: upstream.URL, APIKey: "test-secret",
		Models: []string{"seedance-1-5-pro"}, Weight: 1, Enabled: true,
	})
	channelName := settings.Private.Channels[len(settings.Private.Channels)-1].Name
	settings.Private.GenerationProfiles = []model.GenerationProfileBinding{{
		ID: "seedance-1-5-pro", ProfileID: "seedance-1-5-pro", UpstreamModel: "seedance-1-5-pro", ChannelName: channelName, Enabled: true,
	}}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveSettings(settings, now); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	t.Cleanup(func() { _, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano)) })

	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := registerUser(t, server.URL, "generation-owner-"+uuid.NewString())
	other := registerUser(t, server.URL, "generation-other-"+uuid.NewString())

	invalid := postGeneration(t, server.URL, owner.Token, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: "invalid-profile-" + uuid.NewString(), ModelProfileID: "missing-profile", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "invalid profile"},
	})
	if invalid.Code != 1 || invalid.Data.Error == nil || invalid.Data.Error.Code != "MODEL_DISABLED" || invalid.Data.Error.FieldPath != "modelProfileId" {
		t.Fatalf("invalid profile response = %#v", invalid)
	}
	select {
	case request := <-upstreamRequests:
		t.Fatalf("invalid profile reached upstream: %s", request)
	default:
	}

	clientRequestID := "upstream-failure-" + uuid.NewString()
	created := postGeneration(t, server.URL, owner.Token, model.GenerationCommand{
		CommandVersion: 1, ClientRequestID: clientRequestID, ModelProfileID: "seedance-1-5-pro", Source: string(model.SourceCanvas),
		Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "人物走进雨夜街道"},
	})
	if created.Code != 0 || created.Data.Task.ID == "" || created.Data.Task.Status != model.TaskStatusQueued {
		t.Fatalf("create response = %#v", created)
	}
	recovered := getGenerationByClientRequestID(t, server.URL, owner.Token, clientRequestID)
	if recovered.Code != 0 || recovered.Data.Task.ID != created.Data.Task.ID {
		t.Fatalf("client request lookup = %#v", recovered)
	}
	foreignRecovered := getGenerationByClientRequestID(t, server.URL, other.Token, clientRequestID)
	if foreignRecovered.Code != 0 || foreignRecovered.Data.Task.ID != "" {
		t.Fatalf("foreign client request lookup = %#v", foreignRecovered)
	}
	select {
	case request := <-upstreamRequests:
		if request != "POST /v1/contents/generations/tasks" {
			t.Fatalf("upstream request = %q", request)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request was not received")
	}

	terminal := waitForGeneration(t, server.URL, owner.Token, created.Data.Task.ID)
	if terminal.Status != model.TaskStatusFailed || terminal.Error == nil || terminal.Error.Code != "UPSTREAM_UNAVAILABLE" || !terminal.Error.Retryable {
		t.Fatalf("terminal task = %#v", terminal)
	}
	owned := getGeneration(t, server.URL, owner.Token, created.Data.Task.ID)
	if owned.Code != 0 || owned.Data.Task.ID != created.Data.Task.ID {
		t.Fatalf("owner query = %#v", owned)
	}
	foreign := getGeneration(t, server.URL, other.Token, created.Data.Task.ID)
	if foreign.Code != 1 || foreign.Msg != "任务不存在或无权操作" {
		t.Fatalf("foreign query = %#v", foreign)
	}
}

type generationData struct {
	Task  model.FirstPartyGenerationTask `json:"-"`
	Error *struct {
		Code      string `json:"code"`
		Retryable bool   `json:"retryable"`
		FieldPath string `json:"fieldPath"`
	} `json:"-"`
}

func (data *generationData) UnmarshalJSON(body []byte) error {
	if len(body) == 0 || bytes.Equal(body, []byte("null")) {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return err
	}
	if _, ok := fields["status"]; ok {
		return json.Unmarshal(body, &data.Task)
	}
	return json.Unmarshal(body, &data.Error)
}

func registerUser(t *testing.T, baseURL, username string) model.AuthSession {
	t.Helper()
	body := doJSON[model.AuthSession](t, http.MethodPost, baseURL+"/api/auth/register", "", map[string]string{"username": username, "password": "generation-test-password"})
	if body.Code != 0 || body.Data.Token == "" {
		t.Fatalf("register response = %#v", body)
	}
	return body.Data
}

func postGeneration(t *testing.T, baseURL, token string, command model.GenerationCommand) apiResponse[generationData] {
	t.Helper()
	return doJSON[generationData](t, http.MethodPost, baseURL+"/api/v1/generations", token, command)
}

func getGeneration(t *testing.T, baseURL, token, taskID string) apiResponse[generationData] {
	t.Helper()
	return doJSON[generationData](t, http.MethodGet, baseURL+"/api/v1/generations/"+taskID, token, nil)
}

func getGenerationByClientRequestID(t *testing.T, baseURL, token, clientRequestID string) apiResponse[generationData] {
	t.Helper()
	return doJSON[generationData](t, http.MethodGet, baseURL+"/api/v1/generations/client-requests/"+clientRequestID, token, nil)
}

func waitForGeneration(t *testing.T, baseURL, token, taskID string) model.FirstPartyGenerationTask {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		response := getGeneration(t, baseURL, token, taskID)
		if response.Code == 0 && response.Data.Task.Status == model.TaskStatusFailed {
			return response.Data.Task
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("task %s did not fail", taskID)
	return model.FirstPartyGenerationTask{}
}

func doJSON[T any](t *testing.T, method, url, token string, payload any) apiResponse[T] {
	t.Helper()
	var requestBody []byte
	if payload != nil {
		requestBody, _ = json.Marshal(payload)
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(requestBody))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request %s: %v", url, err)
	}
	defer response.Body.Close()
	var body apiResponse[T]
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%s status = %d, body=%s", url, response.StatusCode, fmt.Sprintf("%#v", body))
	}
	return body
}
