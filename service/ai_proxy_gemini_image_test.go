package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func setupGeminiImageProxyTest(t *testing.T, upstreamURL string) (string, string) {
	t.Helper()
	previousModel, userID := setupAIProxyHTTPTestWithProtocol(t, upstreamURL, "gemini")
	modelName := "gemini-3-pro-image-" + previousModel
	settings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	for i := range settings.Private.Channels {
		if len(settings.Private.Channels[i].Models) == 1 && settings.Private.Channels[i].Models[0] == previousModel {
			settings.Private.Channels[i].Models = []string{modelName}
		}
	}
	settings.Public.ModelChannel.ImageModels = append(settings.Public.ModelChannel.ImageModels, modelName)
	settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: modelName, Credits: credit(2)})
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	return modelName, userID
}

func TestGeminiImageProxyGenerationsPreservePlatformLifecycle(t *testing.T) {
	var upstreamBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, ":generateContent") {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&upstreamBody); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer upstream.Close()
	modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/generations", strings.NewReader(`{"model":"`+modelName+`","prompt":"draw","size":"2880x2880","quality":"low","n":1,"output_format":"png"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Source", "image_workbench")
	request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
	response := httptest.NewRecorder()
	ProxyAIRequest(response, request, "/async/images/generations")
	encoded, _ := json.Marshal(upstreamBody)
	if string(encoded) != `{"contents":[{"parts":[{"text":"draw"}],"role":"user"}],"generationConfig":{"imageConfig":{"aspectRatio":"1:1","imageSize":"4K"},"responseModalities":["TEXT","IMAGE"]}}` {
		t.Fatalf("Gemini request = %s", encoded)
	}
	var result struct {
		Data []struct {
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].Base64 != "aW1hZ2U=" {
		t.Fatalf("platform response = %s, err=%v", response.Body.String(), err)
	}
	taskID := response.Header().Get("X-Generation-Task-Id")
	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil || task.Status != model.TaskStatusPending || task.Source != "image_workbench" || task.Provider != "gemini" {
		t.Fatalf("task=%#v err=%v", task, err)
	}
	if err := UpdateTaskMetadata(taskID, userID, `{"fileIds":["missing"]}`); err == nil {
		t.Fatal("completed without a platform file")
	}
	fileID := "gemini-result-" + taskID
	if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: userID, FileType: "results/images", S3Key: "results/images/" + fileID + ".png", MimeType: "image/png", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	if err := UpdateTaskMetadata(taskID, userID, `{"fileIds":["`+fileID+`"]}`); err != nil {
		t.Fatal(err)
	}
	task, err = repository.GetGenerationTaskByID(taskID)
	if err != nil || task.Status != model.TaskStatusSuccess || !strings.Contains(task.Metadata, fileID) {
		t.Fatalf("materialized task=%#v err=%v", task, err)
	}
	user, _, err := repository.GetUserByID(userID)
	if err != nil || !user.Credits.Equal(credit(8)) {
		t.Fatalf("credits=%s err=%v", user.Credits, err)
	}
}

func TestGeminiImageProxyJSONEditsPreserveReferences(t *testing.T) {
	var upstreamBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&upstreamBody); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer upstream.Close()
	modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/edits", strings.NewReader(`{"model":"`+modelName+`","prompt":"combine","size":"2048x1152","image":["data:image/png;base64,Zmlyc3Q=","data:image/jpeg;base64,c2Vjb25k"],"n":1}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
	response := httptest.NewRecorder()
	ProxyAIRequest(response, request, "/async/images/edits")
	encoded, _ := json.Marshal(upstreamBody["contents"])
	if string(encoded) != `[{"parts":[{"text":"combine"},{"inlineData":{"data":"Zmlyc3Q=","mimeType":"image/png"}},{"inlineData":{"data":"c2Vjb25k","mimeType":"image/jpeg"}}],"role":"user"}]` {
		t.Fatalf("contents = %s", encoded)
	}
	encoded, _ = json.Marshal(upstreamBody["generationConfig"])
	if !strings.Contains(string(encoded), `"imageConfig":{"aspectRatio":"16:9","imageSize":"2K"}`) {
		t.Fatalf("generation config = %s", encoded)
	}
	if !strings.Contains(response.Body.String(), `"b64_json":"aW1hZ2U="`) || response.Header().Get("X-Generation-Task-Id") == "" {
		t.Fatalf("response = %s", response.Body.String())
	}
}

func TestGeminiImageProxyMultipartReferences(t *testing.T) {
	for _, field := range []string{"image", "image[]"} {
		t.Run(field, func(t *testing.T) {
			var upstreamBody map[string]any
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("content type = %s", r.Header.Get("Content-Type"))
				}
				if err := json.NewDecoder(r.Body).Decode(&upstreamBody); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
			}))
			defer upstream.Close()
			modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			for key, value := range map[string]string{"model": modelName, "prompt": "combine", "size": "2016x864", "quality": "high", "n": "1"} {
				if err := form.WriteField(key, value); err != nil {
					t.Fatal(err)
				}
			}
			count := 1
			if field == "image[]" {
				count = 2
			}
			for i := 0; i < count; i++ {
				header := textproto.MIMEHeader{"Content-Disposition": {`form-data; name="` + field + `"; filename="ref.png"`}, "Content-Type": {"image/png"}}
				part, err := form.CreatePart(header)
				if err != nil {
					t.Fatal(err)
				}
				_, _ = part.Write([]byte("image"))
			}
			_ = form.Close()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/edits", &body)
			request.Header.Set("Content-Type", form.FormDataContentType())
			request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
			response := httptest.NewRecorder()
			ProxyAIRequest(response, request, "/async/images/edits")
			contents, ok := upstreamBody["contents"].([]any)
			if !ok || len(contents) != 1 {
				t.Fatalf("request not converted: %#v; response=%s", upstreamBody, response.Body.String())
			}
			parts := contents[0].(map[string]any)["parts"].([]any)
			if len(parts) != count+1 {
				t.Fatalf("reference parts = %#v", parts)
			}
			for _, part := range parts[1:] {
				encoded, _ := json.Marshal(part)
				if string(encoded) != `{"inlineData":{"data":"aW1hZ2U=","mimeType":"image/png"}}` {
					t.Fatalf("part=%s", encoded)
				}
			}
			encoded, _ := json.Marshal(upstreamBody["generationConfig"])
			if !strings.Contains(string(encoded), `"imageConfig":{"aspectRatio":"21:9","imageSize":"1K"}`) {
				t.Fatalf("config=%s", encoded)
			}
			if !strings.Contains(response.Body.String(), `"b64_json":"aW1hZ2U="`) {
				t.Fatalf("response=%s", response.Body.String())
			}
		})
	}
}

func TestGeminiImageProxyJSONArrayFieldPreservesBothReferenceFields(t *testing.T) {
	var contents json.RawMessage
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Contents json.RawMessage `json:"contents"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		contents = body.Contents
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer upstream.Close()
	modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/edits", strings.NewReader(`{"model":"`+modelName+`","prompt":"combine","image":"data:image/png;base64,Zmlyc3Q=","image[]":["data:image/png;base64,c2Vjb25k"]}`))
	request.Header.Set("Content-Type", "application/json")
	request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
	response := httptest.NewRecorder()
	ProxyAIRequest(response, request, "/async/images/edits")
	if !strings.Contains(string(contents), `"data":"Zmlyc3Q="`) || !strings.Contains(string(contents), `"data":"c2Vjb25k"`) {
		t.Fatalf("missing reference: %s", contents)
	}
}

func TestGeminiImageProxyRejectsUnsupportedSemanticsBeforeCharging(t *testing.T) {
	for _, field := range []string{"mask", "n", "background"} {
		for _, format := range []string{"application/json", "multipart/form-data"} {
			t.Run(field+"/"+format, func(t *testing.T) {
				called := false
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					called = true
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
				}))
				defer upstream.Close()
				modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
				fields := map[string]any{"model": modelName, "prompt": "draw", "size": "1024x1024"}
				fields[field] = map[string]any{"mask": "data:image/png;base64,aW1hZ2U=", "n": 2, "background": "transparent"}[field]
				body, _ := json.Marshal(fields)
				contentType := format
				if format == "multipart/form-data" {
					var buffer bytes.Buffer
					form := multipart.NewWriter(&buffer)
					for key, value := range fields {
						if key == "mask" {
							part, _ := form.CreateFormFile("mask", "mask.png")
							_, _ = part.Write([]byte("mask"))
						} else {
							_ = form.WriteField(key, fmt.Sprint(value))
						}
					}
					_ = form.Close()
					body, contentType = buffer.Bytes(), form.FormDataContentType()
				}
				request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/edits", bytes.NewReader(body))
				request.Header.Set("Content-Type", contentType)
				request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
				response := httptest.NewRecorder()
				ProxyAIRequest(response, request, "/async/images/edits")
				if called || !strings.Contains(response.Body.String(), `"code":1`) || !strings.Contains(response.Body.String(), "不支持") {
					t.Fatalf("ignored %s: upstream=%v response=%s", field, called, response.Body.String())
				}
				user, _, err := repository.GetUserByID(userID)
				if err != nil || !user.Credits.Equal(credit(10)) || response.Header().Get("X-Generation-Task-Id") != "" {
					t.Fatalf("unsupported request charged: credits=%s err=%v", user.Credits, err)
				}
			})
		}
	}
}

func TestGeminiImageProxyFailuresRefundExactlyOnce(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		status     int
		body, code string
	}{
		{"provider-json-error", 200, `{"error":{"code":400,"message":"invalid image size"}}`, "400"},
		{"http-error", 429, `{"error":{"message":"rate limited"}}`, "UPSTREAM_429"},
		{"no-image", 200, `{"candidates":[{"content":{"parts":[{"text":"blocked"}]},"finishReason":"SAFETY"}]}`, "RESULT_FILE_MISSING"},
		{"malformed-response", 200, `not-json`, "UPSTREAM_INVALID_RESPONSE"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(scenario.status)
				_, _ = w.Write([]byte(scenario.body))
			}))
			defer upstream.Close()
			modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
			request := httptest.NewRequest(http.MethodPost, "/api/v1/async/images/generations", strings.NewReader(`{"model":"`+modelName+`","prompt":"draw","size":"1024x1024"}`))
			request.Header.Set("Content-Type", "application/json")
			request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
			response := httptest.NewRecorder()
			ProxyAIRequest(response, request, "/async/images/generations")
			taskID := response.Header().Get("X-Generation-Task-Id")
			task, _, err := GetUserTaskDetail(taskID, userID, false)
			if err != nil || task.Status != model.TaskStatusFailed || task.ErrorCode != scenario.code {
				t.Fatalf("task=%#v err=%v", task, err)
			}
			user, _, err := repository.GetUserByID(userID)
			if err != nil || !user.Credits.Equal(credit(10)) {
				t.Fatalf("credits=%s err=%v", user.Credits, err)
			}
			logs, _, err := repository.ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
			consumed, refunded := 0, 0
			for _, entry := range logs {
				if entry.TaskID != taskID {
					continue
				}
				if entry.Type == model.CreditLogTypeAIConsume {
					consumed++
				}
				if entry.Type == model.CreditLogTypeAIRefund {
					refunded++
				}
			}
			if err != nil || consumed != 1 || refunded != 1 {
				t.Fatalf("credit events consume=%d refund=%d err=%v", consumed, refunded, err)
			}
		})
	}
}

func TestGeminiImageProxyRejectsUnsupportedRatioBeforeCharging(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer upstream.Close()
	modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
	for _, size := range []string{"9:21", "864x2016", "1152x2688", "1648x3840"} {
		for _, path := range []string{"/async/images/generations", "/async/images/edits"} {
			request := httptest.NewRequest(http.MethodPost, "/api/v1"+path, strings.NewReader(`{"model":"`+modelName+`","prompt":"draw","size":"`+size+`"}`))
			request.Header.Set("Content-Type", "application/json")
			request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
			response := httptest.NewRecorder()
			ProxyAIRequest(response, request, path)
			if called || !strings.Contains(response.Body.String(), "Gemini 不支持所选图片比例") || response.Header().Get("X-Generation-Task-Id") != "" {
				t.Fatalf("unsupported ratio was silently changed: %s", response.Body.String())
			}
		}
	}
	user, _, err := repository.GetUserByID(userID)
	if err != nil || !user.Credits.Equal(credit(10)) {
		t.Fatalf("credits=%s err=%v", user.Credits, err)
	}
}

func TestGeminiImageProxySynchronousCompatibilityAndNativeBodies(t *testing.T) {
	var upstreamBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&upstreamBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer upstream.Close()
	modelName, userID := setupGeminiImageProxyTest(t, upstream.URL)
	for _, path := range []string{"/images/generations", "/images/edits"} {
		for _, native := range []bool{false, true} {
			body := `{"model":"` + modelName + `","prompt":"draw","size":"2048x1152"}`
			if native {
				body = `{"model":"` + modelName + `","contents":[{"role":"user","parts":[{"text":"draw"}]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"16:9","imageSize":"2K"}}}`
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1"+path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request = request.WithContext(WithUser(request.Context(), model.AuthUser{ID: userID}))
			response := httptest.NewRecorder()
			ProxyAIRequest(response, request, path)
			if upstreamBody["contents"] == nil || upstreamBody["prompt"] != nil {
				t.Fatalf("compatibility image request not converted: %#v", upstreamBody)
			}
			field := `"b64_json"`
			if native {
				field = `"candidates"`
			}
			if !strings.Contains(response.Body.String(), field) {
				t.Fatalf("response changed format: %s", response.Body.String())
			}
		}
	}
}
