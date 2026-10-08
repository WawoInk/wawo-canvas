package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

type imageCompletionResponseWriter struct {
	*httptest.ResponseRecorder
	onWrite func()
}

func (writer imageCompletionResponseWriter) Write(body []byte) (int, error) {
	n, err := writer.ResponseRecorder.Write(body)
	writer.onWrite()
	return n, err
}

func TestProxyAsyncImageEditsPersistsCompletionBeforeResponse(t *testing.T) {
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII="
	const result = `{"id":"task_fixture","object":"task","result":{"created":1791430575,"data":[{"b64_json":"` + png + `"}],"usage":{"input_tokens":1172,"output_tokens":397,"total_tokens":1569}},"status":"completed"}`
	for _, duringResponse := range []bool{true, false} {
		name := "metadata_after_response"
		if duringResponse {
			name = "metadata_during_response"
		}
		t.Run(name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, result)
			}))
			defer upstream.Close()
			modelName, userID := setupAIProxyHTTPTest(t, upstream.URL)
			settings, err := repository.GetSettings()
			if err != nil {
				t.Fatal(err)
			}
			settings.Public.ModelChannel.ImageModels = append(settings.Public.ModelChannel.ImageModels, modelName)
			if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
				t.Fatal(err)
			}
			fileID := "file-image-completion-" + uuid.NewString()
			if err := repository.CreateUserFile(model.UserFile{
				ID: fileID, UserID: userID, FileType: "results/images", S3Key: "results/images/" + fileID + ".png",
				MimeType: "image/png", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			metadata := `{"fileIds":["` + fileID + `"]}`
			materialize := func() {
				taskID := response.Header().Get("X-Generation-Task-Id")
				task, err := repository.GetGenerationTaskByID(taskID)
				if err != nil {
					t.Fatal(err)
				}
				if task.Status != model.TaskStatusPending {
					t.Errorf("task before metadata = %s; want pending before response is visible", task.Status)
				}
				if err := UpdateTaskMetadata(taskID, userID, metadata); err != nil {
					t.Fatal(err)
				}
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/edits", strings.NewReader(`{"model":"`+modelName+`","prompt":"edit source","images":[{"image_url":"data:image/png;base64,`+png+`"}],"n":1}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Source", "canvas")
			request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
			if duringResponse {
				ProxyAIRequest(imageCompletionResponseWriter{response, materialize}, request, "/async/images/edits")
			} else {
				ProxyAIRequest(response, request, "/async/images/edits")
				materialize()
			}
			if response.Code != http.StatusOK || response.Body.String() != result {
				t.Fatal("proxy changed the successful image response")
			}
			task, err := repository.GetGenerationTaskByID(response.Header().Get("X-Generation-Task-Id"))
			if err != nil {
				t.Fatal(err)
			}
			if task.Status != model.TaskStatusSuccess || task.Metadata != metadata {
				t.Errorf("materialized task = status %s, metadata %q; want success and %q", task.Status, task.Metadata, metadata)
			}
		})
	}
}
