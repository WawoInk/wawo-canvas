package service

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

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
