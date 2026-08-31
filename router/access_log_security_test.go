package router_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/router"
	"github.com/gin-gonic/gin"
)

func TestAccessLogOmitsQuerySecrets(t *testing.T) {
	var accessLog bytes.Buffer
	previousWriter, previousMode := gin.DefaultWriter, gin.Mode()
	gin.DefaultWriter = &accessLog
	gin.SetMode(gin.ReleaseMode)
	t.Cleanup(func() {
		gin.DefaultWriter = previousWriter
		gin.SetMode(previousMode)
	})

	const sentinel = "callback-token-sentinel-issue65"
	request := httptest.NewRequest(http.MethodGet, "/api/health?callback_token="+sentinel+"&api_key=other-secret", nil)
	response := httptest.NewRecorder()
	router.New().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	logged := accessLog.String()
	if !strings.Contains(logged, "/api/health") || !strings.Contains(logged, "200") {
		t.Fatalf("access log missing path or status: %q", logged)
	}
	for _, secret := range []string{sentinel, "callback_token=", "api_key="} {
		if strings.Contains(logged, secret) {
			t.Fatalf("access log leaked query secret %q: %q", secret, logged)
		}
	}
}

func TestRecoveryLogOmitsQuerySecrets(t *testing.T) {
	var logs bytes.Buffer
	previousWriter, previousErrorWriter, previousMode := gin.DefaultWriter, gin.DefaultErrorWriter, gin.Mode()
	gin.DefaultWriter = &logs
	gin.DefaultErrorWriter = &logs
	gin.SetMode(gin.DebugMode)
	t.Cleanup(func() {
		gin.DefaultWriter = previousWriter
		gin.DefaultErrorWriter = previousErrorWriter
		gin.SetMode(previousMode)
	})

	engine := router.New()
	engine.GET("/panic-security", func(*gin.Context) { panic("expected test panic") })
	const sentinel = "panic-query-secret-issue65"
	request := httptest.NewRequest(http.MethodGet, "/panic-security?token="+sentinel, nil)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	logged := logs.String()
	if !strings.Contains(logged, "/panic-security") {
		t.Fatalf("recovery log missing safe path: %q", logged)
	}
	if strings.Contains(logged, sentinel) || strings.Contains(logged, "?token=") {
		t.Fatalf("recovery log leaked query secret: %q", logged)
	}
}
