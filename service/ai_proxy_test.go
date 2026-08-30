package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

const aiProxyTestAPIKey = "compatibility-channel-api-key-secret"

func setupAIProxyHTTPTest(t *testing.T, upstreamURL string) (string, string) {
	t.Helper()
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	t.Cleanup(func() {
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	})

	key := uuid.NewString()
	modelName := "stream-test-model-" + key
	settings := previousSettings
	settings.Private.Channels = append(settings.Private.Channels, model.ModelChannel{
		Name: "stream-test-channel-" + key, Protocol: "openai", BaseURL: upstreamURL, APIKey: aiProxyTestAPIKey,
		Enabled: true, Weight: 1, Models: []string{modelName},
	})
	settings.Public.ModelChannel.TextModels = append(settings.Public.ModelChannel.TextModels, modelName)
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: modelName, Credits: credit(2)})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	userID := "stream-test-user-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "stream-test-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: credit(10), CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	return modelName, userID
}

func newAIProxyHTTPServer(t *testing.T, userID string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(WithUser(r.Context(), model.AuthUser{ID: userID}))
		ProxyAIRequest(w, r, "/chat/completions")
	}))
	t.Cleanup(server.Close)
	return server
}

func TestProxyAIRequestPreservesNonStreamingJSONResponse(t *testing.T) {
	wantBody := `{"id":"chatcmpl-test","choices":[{"message":{"content":"done"}}]}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Upstream-Request-Id", "request-123")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(wantBody))
	}))
	t.Cleanup(upstream.Close)

	modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
	proxy := newAIProxyHTTPServer(t, userID)
	request, err := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"`+modelName+`","messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := proxy.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}

	if response.StatusCode != http.StatusAccepted || response.Header.Get("Content-Type") != "application/json" || response.Header.Get("X-Upstream-Request-Id") != "request-123" || string(body) != wantBody {
		t.Fatalf("response = status %d content-type %q request-id %q body %q", response.StatusCode, response.Header.Get("Content-Type"), response.Header.Get("X-Upstream-Request-Id"), body)
	}
}

func TestProxyAIRequestStreamsFirstChunkBeforeUpstreamCompletes(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		contentType string
		firstChunk  string
		secondChunk string
	}{
		{name: "sse", contentType: "text/event-stream", firstChunk: "data: {\"delta\":\"first\"}\n\n", secondChunk: "data: {\"delta\":\"second\"}\n\n"},
		{name: "ndjson", contentType: "application/x-ndjson", firstChunk: "{\"delta\":\"first\"}\n", secondChunk: "{\"delta\":\"second\"}\n"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			firstWritten := make(chan struct{})
			releaseSecond := make(chan struct{})
			released := false
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", testCase.contentType)
				_, _ = w.Write([]byte(testCase.firstChunk))
				w.(http.Flusher).Flush()
				close(firstWritten)
				<-releaseSecond
				_, _ = w.Write([]byte(testCase.secondChunk))
			}))
			defer upstream.Close()
			defer func() {
				if !released {
					close(releaseSecond)
				}
			}()

			modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
			proxy := newAIProxyHTTPServer(t, userID)
			request, err := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"`+modelName+`","stream":true,"messages":[]}`))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			ctx, cancel := context.WithCancel(request.Context())
			defer cancel()
			request = request.WithContext(ctx)

			type firstChunkResult struct {
				response *http.Response
				chunk    []byte
				err      error
			}
			result := make(chan firstChunkResult, 1)
			go func() {
				response, err := proxy.Client().Do(request)
				if err != nil {
					result <- firstChunkResult{err: err}
					return
				}
				chunk := make([]byte, len(testCase.firstChunk))
				_, err = io.ReadFull(response.Body, chunk)
				result <- firstChunkResult{response: response, chunk: chunk, err: err}
			}()

			<-firstWritten
			select {
			case got := <-result:
				if got.response != nil {
					defer got.response.Body.Close()
				}
				if got.err != nil {
					t.Fatal(got.err)
				}
				if string(got.chunk) != testCase.firstChunk || got.response.Header.Get("Content-Type") != testCase.contentType || got.response.Header.Get("Content-Length") != "" {
					t.Fatalf("first response = chunk %q content-type %q content-length %q", got.chunk, got.response.Header.Get("Content-Type"), got.response.Header.Get("Content-Length"))
				}
				close(releaseSecond)
				released = true
				rest, err := io.ReadAll(got.response.Body)
				if err != nil || string(rest) != testCase.secondChunk {
					t.Fatalf("remaining response = %q, err = %v", rest, err)
				}
			case <-time.After(time.Second):
				cancel()
				t.Fatal("first chunk did not reach the client before upstream completion")
			}
		})
	}
}

func TestProxyAIRequestCancellationPropagatesAndRefundsInterruptedStream(t *testing.T) {
	firstChunk := "data: {\"delta\":\"first\"}\n\n"
	upstreamCancelled := make(chan struct{})
	releaseUpstream := make(chan struct{})
	released := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(firstChunk))
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			close(upstreamCancelled)
		case <-releaseUpstream:
		}
	}))
	defer upstream.Close()
	defer func() {
		if !released {
			close(releaseUpstream)
		}
	}()

	modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
	handlerDone := make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		r = r.WithContext(WithUser(r.Context(), model.AuthUser{ID: userID}))
		ProxyAIRequest(w, r, "/chat/completions")
	}))
	defer proxy.Close()

	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, proxy.URL, strings.NewReader(`{"model":"`+modelName+`","stream":true,"messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := proxy.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	taskID := response.Header.Get("X-Generation-Task-Id")
	if taskID == "" {
		t.Fatal("missing X-Generation-Task-Id")
	}
	chunk := make([]byte, len(firstChunk))
	if _, err := io.ReadFull(response.Body, chunk); err != nil || string(chunk) != firstChunk {
		t.Fatalf("first chunk = %q, err = %v", chunk, err)
	}
	cancel()
	_ = response.Body.Close()

	cancelled, returned := false, false
	cancelledCh, returnedCh := upstreamCancelled, handlerDone
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for !cancelled || !returned {
		select {
		case <-cancelledCh:
			cancelled = true
			cancelledCh = nil
		case <-returnedCh:
			returned = true
			returnedCh = nil
		case <-timer.C:
			if !cancelled {
				t.Error("upstream request context was not cancelled")
			}
			if !returned {
				t.Error("proxy handler did not return after client cancellation")
			}
			close(releaseUpstream)
			released = true
			if !returned {
				select {
				case <-handlerDone:
				case <-time.After(time.Second):
					t.Fatal("proxy handler did not return during test cleanup")
				}
			}
			cancelled, returned = true, true
		}
	}

	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != model.TaskStatusFailed || task.ErrorCode == "" {
		t.Errorf("task status = %q, error code = %q; want failed with an error code", task.Status, task.ErrorCode)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || !user.Credits.Equal(credit(10)) {
		t.Errorf("user = %#v, ok = %v, err = %v; want initial credits restored", user, ok, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	consumeCount, refundCount := 0, 0
	for _, log := range logs {
		if log.TaskID != taskID {
			continue
		}
		switch log.Type {
		case model.CreditLogTypeAIConsume:
			consumeCount++
		case model.CreditLogTypeAIRefund:
			refundCount++
		}
	}
	if err != nil || consumeCount != 1 || refundCount != 1 {
		t.Errorf("credit logs = consume %d refund %d, err = %v; want one each", consumeCount, refundCount, err)
	}
}

func TestProxyAIRequestMarksStreamSuccessOnlyAfterEOF(t *testing.T) {
	firstChunk := "data: {\"delta\":\"first\"}\n\n"
	secondChunk := "data: {\"delta\":\"second\"}\n\n"
	releaseSecond := make(chan struct{})
	released := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(firstChunk))
		w.(http.Flusher).Flush()
		<-releaseSecond
		_, _ = w.Write([]byte(secondChunk))
	}))
	defer upstream.Close()
	defer func() {
		if !released {
			close(releaseSecond)
		}
	}()

	modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
	handlerDone := make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		r = r.WithContext(WithUser(r.Context(), model.AuthUser{ID: userID}))
		ProxyAIRequest(w, r, "/chat/completions")
	}))
	defer proxy.Close()

	request, err := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"`+modelName+`","stream":true,"messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := proxy.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	taskID := response.Header.Get("X-Generation-Task-Id")
	if taskID == "" {
		t.Fatal("missing X-Generation-Task-Id")
	}
	chunk := make([]byte, len(firstChunk))
	if _, err := io.ReadFull(response.Body, chunk); err != nil || string(chunk) != firstChunk {
		t.Fatalf("first chunk = %q, err = %v", chunk, err)
	}

	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil || task.Status != model.TaskStatusRunning {
		t.Fatalf("task before EOF = %#v, err = %v; want running", task, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || !user.Credits.Equal(credit(8)) {
		t.Fatalf("user before EOF = %#v, ok = %v, err = %v; want 8 credits", user, ok, err)
	}

	close(releaseSecond)
	released = true
	rest, err := io.ReadAll(response.Body)
	if err != nil || string(rest) != secondChunk {
		t.Fatalf("remaining response = %q, err = %v", rest, err)
	}
	select {
	case <-handlerDone:
	case <-time.After(time.Second):
		t.Fatal("proxy handler did not return after stream EOF")
	}

	task, err = repository.GetGenerationTaskByID(taskID)
	if err != nil || task.Status != model.TaskStatusSuccess || task.ErrorCode != "" {
		t.Fatalf("task after EOF = %#v, err = %v; want success", task, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	consumeCount, refundCount := 0, 0
	for _, log := range logs {
		if log.TaskID != taskID {
			continue
		}
		switch log.Type {
		case model.CreditLogTypeAIConsume:
			consumeCount++
		case model.CreditLogTypeAIRefund:
			refundCount++
		}
	}
	if err != nil || consumeCount != 1 || refundCount != 0 {
		t.Fatalf("credit logs = consume %d refund %d, err = %v; want one consume and no refund", consumeCount, refundCount, err)
	}
}

func TestProxyAIRequestReturnsReadableJSONForStreamingUpstreamErrors(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":{"code":"provider_error","message":"provider detail"}}`))
			}))
			t.Cleanup(upstream.Close)

			modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
			proxy := newAIProxyHTTPServer(t, userID)
			request, err := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"`+modelName+`","stream":true,"messages":[]}`))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			response, err := proxy.Client().Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			var envelope struct {
				Code int    `json:"code"`
				Data any    `json:"data"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(body, &envelope); err != nil {
				t.Fatalf("decode response %q: %v", body, err)
			}
			if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") || envelope.Code != 1 || envelope.Data != nil || !strings.Contains(envelope.Msg, "provider detail") || strings.HasPrefix(string(body), "data:") {
				t.Fatalf("response = status %d content-type %q body %s", response.StatusCode, response.Header.Get("Content-Type"), body)
			}

			taskID := response.Header.Get("X-Generation-Task-Id")
			task, err := repository.GetGenerationTaskByID(taskID)
			if taskID == "" || err != nil || task.Status != model.TaskStatusFailed || task.ErrorCode != "UPSTREAM_"+fmt.Sprint(status) {
				t.Fatalf("taskID = %q task = %#v, err = %v", taskID, task, err)
			}
			user, ok, err := repository.GetUserByID(userID)
			if err != nil || !ok || !user.Credits.Equal(credit(10)) {
				t.Fatalf("user = %#v, ok = %v, err = %v; want refunded balance", user, ok, err)
			}
		})
	}
}

func TestProxyAIRequestPersistsRedactedCompatibilityAudit(t *testing.T) {
	wantBody := `{"api_key":"response-json-secret","url":"https://cdn.example/output.png?X-Amz-Signature=response-url-secret"}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-API-Key", "response-header-secret")
		w.Header().Set("X-Result-URL", "https://cdn.example/output.png?token=response-header-url-secret")
		_, _ = w.Write([]byte(wantBody))
	}))
	t.Cleanup(upstream.Close)

	modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
	handlerDone := make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		r = r.WithContext(WithUser(r.Context(), model.AuthUser{ID: userID}))
		ProxyAIRequest(w, r, "/chat/completions")
	}))
	t.Cleanup(proxy.Close)

	requestBody := `{"model":"` + modelName + `","api_key":"request-json-secret","url":"https://cdn.example/input.png?token=request-url-secret","messages":[]}`
	request, err := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(requestBody))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := proxy.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != wantBody || response.Header.Get("X-API-Key") != "response-header-secret" || response.Header.Get("X-Result-URL") != "https://cdn.example/output.png?token=response-header-url-secret" {
		t.Fatalf("client response = api-key %q result-url %q body %q; want original upstream values", response.Header.Get("X-API-Key"), response.Header.Get("X-Result-URL"), body)
	}
	select {
	case <-handlerDone:
	case <-time.After(time.Second):
		t.Fatal("proxy handler did not return")
	}

	taskID := response.Header.Get("X-Generation-Task-Id")
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if taskID == "" || err != nil {
		t.Fatalf("taskID = %q, get payload: %v", taskID, err)
	}
	audit := strings.Join([]string{payload.RequestHeaders, payload.RequestBody, payload.ResponseHeaders, payload.ResponseBody, payload.RawError}, "\n")
	for _, secret := range []string{aiProxyTestAPIKey, "request-json-secret", "request-url-secret", "response-header-secret", "response-header-url-secret", "response-json-secret", "response-url-secret"} {
		if strings.Contains(audit, secret) {
			t.Errorf("audit leaked %q: %s", secret, audit)
		}
	}
	lowerAudit := strings.ToLower(audit)
	for _, marker := range []string{"authorization", "api_key", "token", "x-amz-signature", "x-api-key", "x-result-url", "[redacted]"} {
		if !strings.Contains(lowerAudit, marker) {
			t.Errorf("audit missing %q: %s", marker, audit)
		}
	}
}

func TestReadAIRequestMultipart(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range map[string]string{"model": "gpt-image-2", "prompt": "edit", "image": "https://example.com/source.png", "n": "2"} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/async/images/edits", bytes.NewReader(body.Bytes()))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	gotBody, gotContentType, gotModel, err := readAIRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if gotModel != "gpt-image-2" || gotContentType != writer.FormDataContentType() || !bytes.Equal(gotBody, body.Bytes()) {
		t.Fatalf("multipart request changed: model=%q contentType=%q", gotModel, gotContentType)
	}
	if got := readAIRequestCount(gotBody, gotContentType); got != 2 {
		t.Fatalf("count = %d, want 2", got)
	}
}

func TestProxyAsyncImageFailureRefundsAndFinalizesTask(t *testing.T) {
	const (
		upstreamTaskID = "async-image-failed"
		upstreamSecret = "async-image-upstream-secret"
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte(`{"id":"` + upstreamTaskID + `","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"` + upstreamTaskID + `","status":"failed","error":{"code":"INVALID_IMAGE_SIZE","message":"image size must be at least 2K: https://cdn.example/image.png?token=async-image-upstream-secret"}}`))
	}))
	defer upstream.Close()

	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	defer func() {
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}()

	key := uuid.NewString()
	modelName := "Dola-Seedream-5.0-lite-" + key
	settings := previousSettings
	settings.Private.Channels = append(settings.Private.Channels, model.ModelChannel{
		Name: "async-image-" + key, Protocol: "openai", BaseURL: upstream.URL, APIKey: "secret",
		Enabled: true, Weight: 1, Models: []string{modelName},
	})
	settings.Public.ModelChannel.ImageModels = append(settings.Public.ModelChannel.ImageModels, modelName)
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: modelName, Credits: credit(2)})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	userID := "async-image-user-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "async-image-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: credit(10), CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/generations", strings.NewReader(`{"model":"`+modelName+`","prompt":"test","size":"1024x1024","n":1}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Source", string(model.SourceCanvas))
	request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
	response := httptest.NewRecorder()
	ProxyAIRequest(response, request, "/async/images/generations")

	taskID := response.Header().Get("X-Generation-Task-Id")
	if response.Code != http.StatusOK || taskID == "" {
		t.Fatalf("submit response = %d %s, taskID = %q", response.Code, response.Body.String(), taskID)
	}

	pollRequest := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/"+upstreamTaskID+"?model="+modelName, nil)
	pollRequest = pollRequest.WithContext(WithUser(pollRequest.Context(), model.AuthUser{ID: userID}))
	pollResponse := httptest.NewRecorder()
	ProxyAIGetRequest(pollResponse, pollRequest, "/tasks/"+upstreamTaskID)
	if pollResponse.Code != http.StatusOK {
		t.Fatalf("poll response = %d %s", pollResponse.Code, pollResponse.Body.String())
	}
	repeatedPollRequest := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/"+upstreamTaskID+"?model="+modelName, nil)
	repeatedPollRequest = repeatedPollRequest.WithContext(WithUser(repeatedPollRequest.Context(), model.AuthUser{ID: userID}))
	ProxyAIGetRequest(httptest.NewRecorder(), repeatedPollRequest, "/tasks/"+upstreamTaskID)

	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil || task.TaskType != model.TaskTypeImage || task.Source != string(model.SourceCanvas) || task.Provider != "openai" ||
		task.Model != modelName || !task.Credits.Equal(credit(2)) || task.Status != model.TaskStatusFailed || task.UpstreamTaskID != upstreamTaskID ||
		task.ErrorCode != "INVALID_IMAGE_SIZE" || !strings.Contains(task.ErrorMessage, "at least 2K") || strings.Contains(task.ErrorMessage, upstreamSecret) {
		t.Fatalf("task = %#v, err = %v", task, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || !user.Credits.Equal(credit(10)) {
		t.Fatalf("user = %#v, ok = %v, err = %v", user, ok, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	consumeCount, refundCount := 0, 0
	for _, log := range logs {
		if log.TaskID != taskID {
			continue
		}
		switch log.Type {
		case model.CreditLogTypeAIConsume:
			consumeCount++
		case model.CreditLogTypeAIRefund:
			refundCount++
		}
	}
	if err != nil || len(logs) != 2 || consumeCount != 1 || refundCount != 1 {
		t.Fatalf("credit logs = %#v, err = %v", logs, err)
	}
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if err != nil || !strings.Contains(payload.RequestBody, "1024x1024") || !strings.Contains(payload.ResponseBody, `"status":"failed"`) ||
		!strings.Contains(payload.ResponseHeaders, "Content-Type") || !strings.Contains(payload.RawError, "at least 2K") || strings.Contains(payload.RawError, upstreamSecret) {
		t.Fatalf("payload = %#v, err = %v", payload, err)
	}
}

func TestAsyncImageSuccessWaitsForMaterializedFileMetadata(t *testing.T) {
	key := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	user, err := SaveUser(model.User{ID: "async-image-pending-user-" + key, Username: "async-image-pending-" + key, AffCode: "async-image-pending-aff-" + key, Credits: credit(5)}, "password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	task := model.GenerationTask{
		ID: "async-image-pending-" + key, UserID: user.ID, TaskType: model.TaskTypeImage,
		Status: model.TaskStatusRunning, Source: string(model.SourceImageWorkbench), Model: "image-model",
		Credits: credit(2), CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "async-image-pending-payload-" + key, CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := ConsumeUserCreditsWithTask(user.ID, task.Model, task.Credits, "/api/v1/async/images/generations", task.ID); err != nil {
		t.Fatalf("consume task credits: %v", err)
	}

	finalizeAsyncImageTask(task, ProviderTaskRef{ID: "upstream-" + key, Status: model.TaskStatusSucceeded}, "poll", []byte(`{"data":[{"url":"https://example.com/image.png"}]}`), "")
	pending, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || pending.Status != model.TaskStatusPending {
		t.Fatalf("task after upstream success = %#v, err=%v; want pending", pending, err)
	}
	fileID := "file-materialized-" + key
	if err := repository.CreateUserFile(model.UserFile{
		ID: fileID, UserID: user.ID, FileType: "results/images",
		S3Key: "results/images/" + fileID + ".png", MimeType: "image/png", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create materialized file: %v", err)
	}
	if err := UpdateTaskMetadata(task.ID, user.ID, `{"fileIds":["`+fileID+`"],"width":1024,"height":1024}`); err != nil {
		t.Fatalf("materialize metadata: %v", err)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSuccess || !strings.Contains(stored.Metadata, fileID) {
		t.Fatalf("task after materialization = %#v, err=%v", stored, err)
	}
}

func TestAsyncImageMetadataRequiresMaterializedUserFile(t *testing.T) {
	key := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	user, err := SaveUser(model.User{ID: "async-image-file-user-" + key, Username: "async-image-file-" + key, AffCode: "async-image-file-aff-" + key, Credits: credit(5)}, "password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	task := model.GenerationTask{
		ID: "async-image-file-task-" + key, UserID: user.ID, TaskType: model.TaskTypeImage,
		Status: model.TaskStatusPending, Model: "image-model", CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "async-image-file-payload-" + key, CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}

	if err := UpdateTaskMetadata(task.ID, user.ID, `{"fileIds":["missing-file"],"width":1024,"height":1024}`); err == nil {
		t.Fatal("metadata update succeeded for a missing materialized file")
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusPending {
		t.Fatalf("task after invalid materialization = %#v, err=%v; want pending", stored, err)
	}
}

func TestAsyncImageServerTimeoutRefundsRunningTask(t *testing.T) {
	key := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	user, err := SaveUser(model.User{ID: "async-image-timeout-user-" + key, Username: "async-image-timeout-" + key, AffCode: "async-image-timeout-aff-" + key, Credits: credit(5)}, "password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	task := model.GenerationTask{
		ID: "async-image-timeout-" + key, UserID: user.ID, TaskType: model.TaskTypeImage,
		Status: model.TaskStatusRunning, Model: "image-model", UpstreamTaskID: "upstream-" + key,
		Credits: credit(2), CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "async-image-timeout-payload-" + key, CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := ConsumeUserCreditsWithTask(user.ID, task.Model, task.Credits, "/api/v1/async/images/generations", task.ID); err != nil {
		t.Fatalf("consume task credits: %v", err)
	}

	scheduleAsyncImageTaskTimeout(task.ID, time.Millisecond)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		stored, getErr := repository.GetGenerationTaskByID(task.ID)
		if getErr == nil && stored.Status == model.TaskStatusFailed {
			if stored.ErrorCode != "TASK_SYNC_TIMEOUT" {
				t.Fatalf("timeout error code = %q", stored.ErrorCode)
			}
			refreshed, ok, getErr := repository.GetUserByID(user.ID)
			if getErr != nil || !ok || !refreshed.Credits.Equal(credit(5)) {
				t.Fatalf("credits after timeout = %#v, ok=%v, err=%v", refreshed, ok, getErr)
			}
			return
		}
		time.Sleep(time.Millisecond * 10)
	}
	t.Fatalf("task did not settle by server timeout")
}

func TestAsyncImageServerTimeoutRefundsPendingTaskOnce(t *testing.T) {
	key := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	user, err := SaveUser(model.User{ID: "async-image-pending-timeout-user-" + key, Username: "async-image-pending-timeout-" + key, AffCode: "async-image-pending-timeout-aff-" + key, Credits: credit(5)}, "password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	task := model.GenerationTask{
		ID: "async-image-pending-timeout-" + key, UserID: user.ID, TaskType: model.TaskTypeImage,
		Status: model.TaskStatusPending, Model: "image-model", UpstreamTaskID: "upstream-" + key,
		Credits: credit(2), CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "async-image-pending-timeout-payload-" + key, CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := ConsumeUserCreditsWithTask(user.ID, task.Model, task.Credits, "/api/v1/async/images/generations", task.ID); err != nil {
		t.Fatalf("consume task credits: %v", err)
	}

	scheduleAsyncImageTaskTimeout(task.ID, time.Millisecond)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		stored, getErr := repository.GetGenerationTaskByID(task.ID)
		if getErr == nil && stored.Status == model.TaskStatusFailed {
			if stored.ErrorCode != "TASK_SYNC_TIMEOUT" {
				t.Fatalf("timeout error code = %q", stored.ErrorCode)
			}
			refreshed, ok, getErr := repository.GetUserByID(user.ID)
			if getErr != nil || !ok || !refreshed.Credits.Equal(credit(5)) {
				t.Fatalf("credits after timeout = %#v, ok=%v, err=%v", refreshed, ok, getErr)
			}
			scheduleAsyncImageTaskTimeout(task.ID, time.Millisecond)
			time.Sleep(time.Millisecond * 20)
			logs, _, logErr := repository.ListCreditLogsByUserID(user.ID, model.Query{PageSize: 20})
			refunds := 0
			for _, log := range logs {
				if log.TaskID == task.ID && log.Type == model.CreditLogTypeAIRefund {
					refunds++
				}
			}
			if logErr != nil || refunds != 1 {
				t.Fatalf("refund logs = %d, err=%v; want 1", refunds, logErr)
			}
			return
		}
		time.Sleep(time.Millisecond * 10)
	}
	t.Fatalf("pending task did not settle by server timeout")
}

func TestAsyncImageTaskRefAcceptsTopLevelImageData(t *testing.T) {
	ref, terminal := asyncImageTaskRef([]byte(`{"model":"Images","data":[{"url":"https://example.com/result.png"}]}`), "images-task")
	if !terminal || ref.ID != "images-task" || ref.Status != model.TaskStatusSucceeded || ref.Error != nil {
		t.Fatalf("ref = %#v, terminal = %v", ref, terminal)
	}
}

func TestProxyVideoTaskCreateChargesBoundViduByUpstreamCredits(t *testing.T) {
	requestedModels := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			var body struct {
				Model string `json:"model"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			requestedModels <- body.Model
			_, _ = w.Write([]byte(`{"id":"compat-vidu-billed","model":"vidu_hq_t2v-oversea","status":"queued"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"compat-vidu-billed","model":"vidu_hq_t2v-oversea","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"},"credits":18}`))
	}))
	defer upstream.Close()

	previousProfiles := generationProfiles
	previousRouteChannel := generationRouteChannel
	previousClient := generationHTTPClient
	previousPollInterval := generationPollInterval
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	defer func() {
		generationProfiles = previousProfiles
		generationRouteChannel = previousRouteChannel
		generationHTTPClient = previousClient
		generationPollInterval = previousPollInterval
		_, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano))
	}()

	key := uuid.NewString()
	profileID := "compat-credit-profile-" + key
	upstreamModel := "vidu_hq_t2v-oversea-" + key
	channelName := "compat-credit-channel-" + key
	channel := model.ModelChannel{Name: channelName, Protocol: "xvanai", BaseURL: upstream.URL, APIKey: "secret", Enabled: true, Models: []string{upstreamModel}}
	profile := model.GenerationProfile{
		ID: profileID, Version: 1, AdapterKey: "seedance-contents-v1", UpstreamModel: upstreamModel, ChannelName: channelName,
		Intents: []model.GenerationIntentKind{model.IntentVideoGenerate}, Capabilities: seedanceCapabilities(),
	}
	generationProfiles = func() []model.GenerationProfile { return []model.GenerationProfile{profile} }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return channel, nil }
	generationHTTPClient = upstream.Client()
	generationPollInterval = time.Millisecond

	settings := previousSettings
	settings.Private.Channels = append(settings.Private.Channels, channel)
	settings.Private.GenerationProfiles = append(settings.Private.GenerationProfiles, model.GenerationProfileBinding{
		ID: profileID, ProfileID: "seedance-1-5-pro", UpstreamModel: upstreamModel, ChannelName: channelName, BillingMode: model.BillingModePerCredit, Enabled: true,
	})
	settings.Public.ModelChannel.VideoModels = append(settings.Public.ModelChannel.VideoModels, profileID)
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: profileID, Credits: credit(2)})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	userID := "compat-credit-user-" + key
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(model.User{ID: userID, Username: "compat-credit-" + key, AffCode: "aff-" + key, Role: model.UserRoleUser, Credits: credit(100), CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save user: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/contents/generations/tasks", strings.NewReader(`{"model":"`+profileID+`","content":[{"type":"text","text":"test"}],"resolution":"720p","duration":6}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
	response := httptest.NewRecorder()
	ProxyVideoTaskCreate(response, request)

	taskID := response.Header().Get("X-Generation-Task-Id")
	if response.Code != http.StatusOK || taskID == "" {
		t.Fatalf("response = %d %s, taskID = %q", response.Code, response.Body.String(), taskID)
	}
	if requestedModel := <-requestedModels; requestedModel != upstreamModel {
		t.Fatalf("upstream model = %q, want %q", requestedModel, upstreamModel)
	}
	if _, err := GetVideoTaskByTaskIDAndUser("compat-vidu-billed", userID); err != nil {
		t.Fatalf("video task ownership: %v", err)
	}
	if !processGenerationTask(context.Background(), taskID, "compat-credit-worker-"+key) {
		t.Fatal("compatibility task was not claimed")
	}
	stored, err := repository.GetGenerationTaskByID(taskID)
	if err != nil || stored.Model != profileID || stored.UpstreamModel != upstreamModel || stored.Status != model.TaskStatusSucceeded ||
		!stored.Credits.Equal(credit(36)) || stored.UpstreamCredits == nil || !stored.UpstreamCredits.Equal(credit(18)) ||
		stored.BillingMode != model.BillingModePerCredit || !stored.BillingRate.Equal(credit(2)) {
		t.Fatalf("stored task = %#v, err = %v", stored, err)
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil || !ok || !user.Credits.Equal(credit(64)) {
		t.Fatalf("user = %#v, ok = %v, err = %v", user, ok, err)
	}
}

func TestMultipartRequestAuditOmitsFileBytes(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", "gpt-image-2"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("prompt", "change the sky"); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("image", "source.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte{'P', 'N', 'G', 0, 0xff}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	audit := requestAuditBody(body.Bytes(), writer.FormDataContentType())
	if !json.Valid(audit) {
		t.Fatalf("audit is not JSON: %q", audit)
	}
	if bytes.Contains(audit, []byte{0}) || bytes.Contains(audit, []byte{0xff}) {
		t.Fatalf("audit contains image bytes: %q", audit)
	}
	got := string(audit)
	for _, want := range []string{`"model":"gpt-image-2"`, `"prompt":"change the sky"`, `"field":"image"`, `"filename":"source.png"`, `"bytes":5`} {
		if !strings.Contains(got, want) {
			t.Fatalf("audit missing %s: %s", want, got)
		}
	}
}

func TestMultipartRequestAuditCanBeLogged(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", "gpt-image-2"); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("image", "source.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(bytes.Repeat([]byte{0xff}, 1024)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	userID := "multipart-log-user"
	id, err := LogTaskStart(model.AuthUser{ID: userID}, model.TaskTypeImage, "openai", "gpt-image-2", requestAuditBody(body.Bytes(), writer.FormDataContentType()), "{}", string(model.SourceCanvas), "")
	if err != nil {
		t.Fatalf("LogTaskStart: %v", err)
	}
	task, err := repository.GetGenerationTaskByIDAndUser(id, userID)
	if err != nil {
		t.Fatalf("GetGenerationTaskByIDAndUser: %v", err)
	}
	if task.TaskType != model.TaskTypeImage || task.Source != string(model.SourceCanvas) {
		t.Fatalf("logged task = type %q source %q", task.TaskType, task.Source)
	}
}

func TestAIUpstreamErrorDetail(t *testing.T) {
	got := proxyAIUpstreamErrorDetail([]byte(`{"error":{"code":"InvalidParameter","message":"reference video fps is invalid"}}`))
	if got != "InvalidParameter reference video fps is invalid" {
		t.Fatalf("detail = %q", got)
	}
}

func TestAIUpstreamErrorDetailExplainsSensitiveVideo(t *testing.T) {
	got := proxyAIUpstreamErrorDetail([]byte(`{"error":{"code":"InputVideoSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input video may contain real person."}}`))
	if !strings.Contains(got, "参考视频疑似包含真人") || !strings.Contains(got, "asset://") {
		t.Fatalf("detail = %q", got)
	}
}

func TestSafeUpstreamTextTruncates(t *testing.T) {
	got := safeUpstreamText(strings.Repeat("错", 320))
	if len([]rune(got)) != 303 {
		t.Fatalf("truncated rune length = %d", len([]rune(got)))
	}
}

func TestBuildGeminiUpstreamURLAndAuth(t *testing.T) {
	channel := model.ModelChannel{Protocol: "gemini", BaseURL: "https://generativelanguage.googleapis.com", APIKey: "secret-key", Models: []string{"gemini-2.5-flash"}}
	body := []byte(`{"model":"gemini-2.5-flash","stream":true,"contents":[{"parts":[{"text":"hi"}]}]}`)
	got := resolveUpstreamRequest(channel, "gemini-2.5-flash", "/chat/completions", body, "application/json")
	if !strings.HasPrefix(got.URL, "https://generativelanguage.googleapis.com/models/gemini-2.5-flash:streamGenerateContent?alt=sse") {
		t.Fatalf("gemini stream URL = %q", got.URL)
	}
	if !strings.Contains(got.URL, "key=secret-key") {
		t.Fatalf("gemini URL missing key= param: %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "" {
		t.Fatalf("gemini must not set Bearer, got %q", got.Headers.Get("Authorization"))
	}
}

func TestBuildGeminiUpstreamNonStreamImage(t *testing.T) {
	channel := model.ModelChannel{Protocol: "gemini", BaseURL: "https://generativelanguage.googleapis.com", APIKey: "k", Models: []string{"gemini-2.5-flash-image"}}
	body := []byte(`{"model":"gemini-2.5-flash-image","contents":[{"parts":[{"text":"a cat"}]}]}`)
	got := resolveUpstreamRequest(channel, "gemini-2.5-flash-image", "/images/generations", body, "application/json")
	if !strings.Contains(got.URL, ":generateContent") || strings.Contains(got.URL, "streamGenerateContent") {
		t.Fatalf("gemini image URL = %q", got.URL)
	}
}

func TestBuildOpenAIUpstreamStillBearer(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://api.openai.com", APIKey: "sk-x", Models: []string{"gpt-5.5"}}
	got := resolveUpstreamRequest(channel, "gpt-5.5", "/chat/completions", []byte(`{}`), "application/json")
	if !strings.HasPrefix(got.URL, "https://api.openai.com/v1/chat/completions") {
		t.Fatalf("openai URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer sk-x" {
		t.Fatalf("openai Bearer = %q", got.Headers.Get("Authorization"))
	}
}

func TestOpenAIAsyncImageAuthUsesNormalizedChannelKeyForSubmitAndPoll(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://example.com", APIKey: " Bearer sk-upstream "}
	for _, path := range []string{"/async/images/generations", "/tasks/task-id"} {
		got := resolveUpstreamRequest(channel, "gpt-image-2-open-1-gen", path, []byte(`{}`), "application/json")
		if authorization := got.Headers.Get("Authorization"); authorization != "Bearer sk-upstream" {
			t.Errorf("%s Authorization = %q", path, authorization)
		}
	}
}

func TestBuildArkSeedanceUpstreamAddsMediaRoles(t *testing.T) {
	body := []byte(`{"model":"seedance-2.0","content":[{"type":"text","text":"test"},{"type":"image_url","image_url":{"url":"https://example.com/image.png"}},{"type":"video_url","video_url":{"url":"https://example.com/video.mp4"}},{"type":"audio_url","audio_url":{"url":"https://example.com/audio.mp3"}}]}`)
	got := resolveUpstreamRequest(model.ModelChannel{Protocol: "openai", BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", APIKey: "secret"}, "seedance-2.0", "/contents/generations/tasks", body, "application/json")
	var payload struct {
		Content []map[string]any `json:"content"`
	}
	if err := json.Unmarshal(got.Body, &payload); err != nil {
		t.Fatalf("decode upstream body: %v", err)
	}
	for index, role := range []string{"", "reference_image", "reference_video", "reference_audio"} {
		if payload.Content[index]["role"] != role && role != "" {
			t.Fatalf("content[%d].role = %#v, want %q; body=%s", index, payload.Content[index]["role"], role, got.Body)
		}
	}
}

func TestGeminiUnsupportedPathsError(t *testing.T) {
	_, err := geminiActionFor("/audio/speech")
	if err == nil {
		t.Fatal("expected error for gemini /audio/speech")
	}
	_, err = geminiActionFor("/videos")
	if err == nil {
		t.Fatal("expected error for gemini /videos")
	}
	_ = http.Header{} // keep import used if not elsewhere
}

func TestRedactUpstreamURLStripsKey(t *testing.T) {
	got := redactUpstreamURL("https://x/models/gemini-2.5-flash:generateContent?key=secret&alt=sse")
	if strings.Contains(got, "secret") {
		t.Fatalf("key not redacted: %q", got)
	}
	if !strings.Contains(got, "alt=sse") {
		t.Fatalf("non-key param lost: %q", got)
	}
}

func TestResolveAIProxyPathPassesThroughTasksPath(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	got := resolveAIProxyPath(base, "seedance-2.0", "/contents/generations/tasks")
	if got != "/contents/generations/tasks" {
		t.Fatalf("tasks path should pass through unchanged, got %q", got)
	}
}

func TestResolveAIProxyPathPassesThroughTasksIdAndRemixPath(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	cases := []string{
		"/contents/generations/tasks/pub_abc123",
		"/contents/generations/tasks/pub_abc123/remix",
	}
	for _, path := range cases {
		got := resolveAIProxyPath(base, "seedance-2.0", path)
		if got != path {
			t.Fatalf("path %q should pass through unchanged, got %q", path, got)
		}
	}
}

func TestResolveAIProxyPathStillRewritesVideosForSeedance(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	got := resolveAIProxyPath(base, "seedance-2.0", "/videos")
	if got != "/contents/generations/tasks" {
		t.Fatalf("legacy /videos should still rewrite for seedance, got %q", got)
	}
	// /videos/:id（非 /content 结尾）也应改写
	gotID := resolveAIProxyPath(base, "seedance-2.0", "/videos/pub_abc")
	if gotID != "/contents/generations/tasks/pub_abc" {
		t.Fatalf("legacy /videos/:id should still rewrite, got %q", gotID)
	}
	// /videos/:id/content 不改写（保持现状）
	gotContent := resolveAIProxyPath(base, "seedance-2.0", "/videos/pub_abc/content")
	if gotContent != "/videos/pub_abc/content" {
		t.Fatalf("legacy /videos/:id/content should not rewrite, got %q", gotContent)
	}
}

func TestBuildOpenAIUpstreamTasksCreateURL(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", APIKey: "ark-key", Models: []string{"seedance-2.0"}}
	body := []byte(`{"model":"seedance-2.0","content":[{"type":"text","text":"a cat"}],"x_vendor_extension":{"preserve":true,"nested":{"value":7}}}`)
	got := resolveUpstreamRequest(channel, "seedance-2.0", "/contents/generations/tasks", body, "application/json")
	if got.URL != "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks" {
		t.Fatalf("tasks create URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer ark-key" {
		t.Fatalf("tasks create Bearer = %q", got.Headers.Get("Authorization"))
	}
	if string(got.Body) != string(body) {
		t.Fatalf("tasks create body should be preserved, got %q", string(got.Body))
	}
}

func TestBuildOpenAIUpstreamTasksRemixURL(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", APIKey: "ark-key", Models: []string{"seedance-2.0"}}
	got := resolveUpstreamRequest(channel, "seedance-2.0", "/contents/generations/tasks/pub_abc/remix", []byte(`{"prompt":"x"}`), "application/json")
	if got.URL != "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/pub_abc/remix" {
		t.Fatalf("tasks remix URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer ark-key" {
		t.Fatalf("tasks remix Bearer = %q", got.Headers.Get("Authorization"))
	}
}
