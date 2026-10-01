package router_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

func TestGeneratedUploadRespectsConfiguredMediaLimits(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })
	config.Cfg.JWTSecret = "generated-upload-test-secret"
	config.Cfg.AmazonRegion = "us-east-1"
	config.Cfg.AmazonS3URL = "https://generated-upload-test.s3.amazonaws.com"
	config.Cfg.AmazonS3AccessKey, config.Cfg.AmazonS3SecretKey = "test", "test"
	previousSettings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := repository.SaveSettings(previousSettings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			t.Error(err)
		}
	})
	settings := previousSettings
	settings.Private.FileSizeLimits = model.FileSizeLimits{Image: 3, Video: 5, Audio: 7}
	if _, err := repository.SaveSettings(settings, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	username := "generated-upload-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username}, "test-password"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "test-password"})
	if session.Code != 0 {
		t.Fatalf("login failed: %s", session.Msg)
	}
	var uploads atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("unexpected storage method: %s", r.Method)
		}
		uploads.Add(1)
	}))
	defer storage.Close()
	t.Setenv("AWS_ENDPOINT_URL_S3", storage.URL)
	for _, media := range []struct {
		fileType, name, mimeType string
		limit                    int
	}{
		{"results/images", "generated.png", "image/png", 3},
		{"results/videos", "generated.mp4", "video/mp4", 5},
		{"results/audios", "generated.mp3", "audio/mpeg", 7},
	} {
		t.Run(media.fileType, func(t *testing.T) {
			before := uploads.Load()
			rejected, _ := doMultipartJSON[model.UserFile](t, http.MethodPost, server.URL+"/api/v1/files", session.Data.Token, media.fileType, media.name, media.mimeType, bytes.Repeat([]byte("x"), media.limit+1))
			if rejected.Code != 1 || !strings.Contains(rejected.Msg, "文件大小超过限制") || uploads.Load() != before {
				t.Fatalf("oversized upload: code=%d msg=%s storage requests=%d", rejected.Code, rejected.Msg, uploads.Load()-before)
			}
			accepted, _ := doMultipartJSON[model.UserFile](t, http.MethodPost, server.URL+"/api/v1/files", session.Data.Token, media.fileType, media.name, media.mimeType, bytes.Repeat([]byte("x"), media.limit))
			if accepted.Code != 0 || accepted.Data.ID == "" || accepted.Data.Bytes != int64(media.limit) || uploads.Load() != before+1 {
				t.Fatalf("boundary upload: %#v storage requests=%d", accepted, uploads.Load()-before)
			}
			stored := doJSON[model.UserFile](t, http.MethodGet, server.URL+"/api/v1/files/"+accepted.Data.ID, session.Data.Token, nil)
			if stored.Code != 0 || stored.Data.FileType != media.fileType || stored.Data.Bytes != int64(media.limit) {
				t.Fatalf("stored upload: %#v", stored)
			}
		})
	}
}
