package service

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestTaskSyncParseFailureLogOmitsUpstreamBody(t *testing.T) {
	const secret = "TASK_SYNC_CONTEXT_SECRET_65"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`not-json ` + secret + ` https://provider.test/result?token=signed-secret`))
	}))
	t.Cleanup(upstream.Close)

	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })

	queryUpstreamTaskViaHTTP(TaskSyncConfig{
		GenTaskID:      "task-security",
		UpstreamTaskID: "upstream-security",
		Channel:        model.ModelChannel{BaseURL: upstream.URL},
	})

	logged := output.String()
	if strings.Contains(logged, secret) || strings.Contains(logged, "signed-secret") {
		t.Fatalf("task sync log leaked upstream body: %s", logged)
	}
}

type taskSyncRoundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip taskSyncRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestTaskSyncTransportFailureLogRedactsErrorURL(t *testing.T) {
	const secret = "TASK_SYNC_URL_SECRET_65"
	previousClient := upstreamHTTPClient
	upstreamHTTPClient = &http.Client{Transport: taskSyncRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("transport failed for %s", request.URL.String())
	})}
	t.Cleanup(func() { upstreamHTTPClient = previousClient })

	var output bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousWriter) })

	queryUpstreamTaskViaHTTP(TaskSyncConfig{
		GenTaskID:      "task-transport-security",
		UpstreamTaskID: "upstream-transport-security",
		Channel:        model.ModelChannel{BaseURL: "https://provider.test?token=" + secret},
	})

	if strings.Contains(output.String(), secret) {
		t.Fatalf("task sync transport log leaked URL secret: %s", output.String())
	}
}
