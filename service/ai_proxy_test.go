package service

import (
	"net/http"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

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
