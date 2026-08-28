package service

import (
	"net/http"
	"net/url"
	"testing"
)

func TestVolcengineAssetHTTPClientUsesProxyResolver(t *testing.T) {
	previous := volcengineAssetProxy
	t.Cleanup(func() { volcengineAssetProxy = previous })
	want := mustParseAssetTestURL(t, "http://proxy.example.test:8080")
	calls := 0
	volcengineAssetProxy = func(*http.Request) (*url.URL, error) {
		calls++
		return want, nil
	}

	client, closeIdle, err := volcengineAssetHTTPClient("https://asset.example.test/v1")
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	defer closeIdle()

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T", client.Transport)
	}
	proxy, err := transport.Proxy(&http.Request{URL: mustParseAssetTestURL(t, "https://asset.example.test/v1")})
	if err != nil {
		t.Fatalf("resolve proxy: %v", err)
	}
	if calls != 1 || proxy == nil || proxy.Host != want.Host {
		t.Fatalf("calls=%d proxy=%v, want %s", calls, proxy, want)
	}
}

func mustParseAssetTestURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse test URL: %v", err)
	}
	return parsed
}
