package service_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

func TestGeminiImageHTTPQueryUploadAndBilling(t *testing.T) {
	const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII="
	const apiKey = "gemini-image-http-private-key"
	pixels, _ := base64.StdEncoding.DecodeString(image)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"` + image + `"}}]}}]}`))
	}))
	defer upstream.Close()
	var storedPixels []byte
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("unexpected storage method: %s", r.Method)
		}
		storedPixels, _ = io.ReadAll(r.Body)
		w.Header().Set("ETag", `"image"`)
	}))
	defer storage.Close()
	t.Setenv("AWS_ENDPOINT_URL_S3", storage.URL)
	t.Setenv("AWS_REQUEST_CHECKSUM_CALCULATION", "when_required")
	previousConfig := config.Cfg
	config.Cfg.AmazonS3URL, config.Cfg.AmazonRegion = "https://test-bucket.example", "us-east-1"
	config.Cfg.AmazonS3AccessKey, config.Cfg.AmazonS3SecretKey = "test", "test"
	t.Cleanup(func() { config.Cfg = previousConfig })
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano)) })
	key := uuid.NewString()
	modelName, userID := "gemini-3-pro-image-http-"+key, "gemini-http-user-"+key
	settings := previousSettings
	settings.Private.Channels = append(settings.Private.Channels, model.ModelChannel{Name: "gemini-http-" + key, Protocol: "gemini", BaseURL: upstream.URL, APIKey: apiKey, Enabled: true, Weight: 1, Models: []string{modelName}})
	settings.Public.ModelChannel.ImageModels = append(settings.Public.ModelChannel.ImageModels, modelName)
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: modelName, Credits: model.NewDecimal(2)})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SaveUser(model.User{ID: userID, Username: userID, AffCode: key, Role: model.UserRoleUser, Credits: model.NewDecimal(10), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/async/images/generations", func(w http.ResponseWriter, r *http.Request) {
		service.ProxyAIRequest(w, r, "/async/images/generations")
	})
	mux.HandleFunc("GET /api/v1/generation-tasks/{id}", func(w http.ResponseWriter, r *http.Request) { handler.GetGenerationTaskDetail(w, r, r.PathValue("id")) })
	mux.HandleFunc("PATCH /api/v1/generation-tasks/{id}/metadata", func(w http.ResponseWriter, r *http.Request) {
		handler.UpdateGenerationTaskMetadata(w, r, r.PathValue("id"))
	})
	mux.HandleFunc("POST /api/v1/files", handler.UploadUserFileDirect)
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r.WithContext(service.WithUser(r.Context(), model.AuthUser{ID: userID})))
	}))
	defer app.Close()
	send := func(method, path, contentType string, body io.Reader) ([]byte, http.Header) {
		t.Helper()
		request, err := http.NewRequest(method, app.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", contentType)
		request.Header.Set("X-Source", "image_workbench")
		response, err := app.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("HTTP status=%d err=%v", response.StatusCode, err)
		}
		return data, response.Header
	}
	result, headers := send("POST", "/api/v1/async/images/generations", "application/json", strings.NewReader(`{"model":"`+modelName+`","prompt":"draw","size":"2048x1152","n":1}`))
	var generated struct {
		Data []struct {
			Image string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(result, &generated); err != nil || len(generated.Data) != 1 || generated.Data[0].Image != image {
		t.Fatal("missing generated image")
	}
	taskID := headers.Get("X-Generation-Task-Id")
	if taskID == "" {
		t.Fatal("missing platform task id")
	}
	query := func() (model.GenerationTask, []byte) {
		t.Helper()
		body, _ := send("GET", "/api/v1/generation-tasks/"+taskID+"?include_payload=true", "", nil)
		var result struct {
			Code int `json:"code"`
			Data struct {
				Task model.GenerationTask `json:"task"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &result); err != nil || result.Code != 0 {
			t.Fatalf("query failed: %s", body)
		}
		return result.Data.Task, body
	}
	task, _ := query()
	if task.Status != model.TaskStatusPending || task.Source != "image_workbench" {
		t.Fatalf("query before materialization: %#v", task)
	}
	result, _ = send("PATCH", "/api/v1/generation-tasks/"+taskID+"/metadata", "application/json", strings.NewReader(`{"metadata":"{\"fileIds\":[\"missing\"]}"}`))
	if !strings.Contains(string(result), `"code":1`) {
		t.Fatal("missing file completed task")
	}

	var upload bytes.Buffer
	form := multipart.NewWriter(&upload)
	_ = form.WriteField("fileType", "results/images")
	part, _ := form.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="file"; filename="generated.png"`}, "Content-Type": {"image/png"}})
	_, _ = part.Write(pixels)
	_ = form.Close()
	result, _ = send("POST", "/api/v1/files", form.FormDataContentType(), &upload)
	var uploaded struct {
		Code int            `json:"code"`
		Data model.UserFile `json:"data"`
	}
	if err := json.Unmarshal(result, &uploaded); err != nil || uploaded.Code != 0 || uploaded.Data.ID == "" {
		t.Fatalf("upload failed: %s", result)
	}
	if !bytes.Equal(storedPixels, pixels) || uploaded.Data.Bytes != int64(len(pixels)) {
		t.Fatal("platform storage did not persist generated bytes")
	}
	patch, _ := json.Marshal(map[string]string{"metadata": `{"fileIds":["` + uploaded.Data.ID + `"]}`})
	result, _ = send("PATCH", "/api/v1/generation-tasks/"+taskID+"/metadata", "application/json", bytes.NewReader(patch))
	if !strings.Contains(string(result), `"code":0`) {
		t.Fatalf("metadata patch: %s", result)
	}
	task, audit := query()
	if task.Status != model.TaskStatusSuccess || !strings.Contains(task.Metadata, uploaded.Data.ID) || !task.Credits.Equal(model.NewDecimal(2)) {
		t.Fatalf("query after materialization: %#v", task)
	}
	user, _, err := repository.GetUserByID(userID)
	if err != nil || !user.Credits.Equal(model.NewDecimal(8)) {
		t.Fatalf("credits=%s err=%v", user.Credits, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].Type != model.CreditLogTypeAIConsume || logs[0].TaskID != taskID {
		t.Fatalf("billing logs=%#v err=%v", logs, err)
	}
	if bytes.Contains(audit, []byte(image)) || bytes.Contains(audit, []byte(apiKey)) {
		t.Fatal("task query audit leaks image base64 or supplier key")
	}
}
