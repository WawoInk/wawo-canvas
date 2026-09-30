package router_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

func TestAudioUploadPreservesFormatThroughS3AndDatabase(t *testing.T) {
	previousConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = previousConfig })
	config.Cfg.JWTSecret = "audio-upload-test-secret"
	config.Cfg.AmazonRegion = "us-east-1"
	config.Cfg.AmazonS3URL = "https://audio-upload-test.s3.amazonaws.com"
	config.Cfg.AmazonS3AccessKey = "test-access-key"
	config.Cfg.AmazonS3SecretKey = "test-secret-key"

	username := "audio-upload-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username}, "test-password"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "test-password"})

	for _, audio := range []struct{ name, mimeType, ext string }{
		{"旁白.mp3", "audio/mpeg", ".mp3"},
		{"旁白.MP3", "audio/mpeg", ".mp3"},
		{"recording.wav", "audio/x-wav", ".wav"},
		{"recording.m4a", "audio/mp4", ".m4a"},
		{"recording.opus", "audio/ogg", ".opus"},
		{"unknown.mp3", "application/octet-stream", ".mp3"},
	} {
		t.Run(audio.name, func(t *testing.T) {
			content := []byte("original-audio-bytes")
			received := false
			storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received = true
				body, err := io.ReadAll(r.Body)
				if err != nil || r.Method != http.MethodPut || !strings.HasSuffix(r.URL.Path, audio.ext) || r.Header.Get("Content-Type") != audio.mimeType || !bytes.Equal(body, content) {
					t.Errorf("S3 upload changed audio: method=%s path=%s MIME=%s body=%q error=%v", r.Method, r.URL.Path, r.Header.Get("Content-Type"), body, err)
				}
			}))
			defer storage.Close()
			t.Setenv("AWS_ENDPOINT_URL_S3", storage.URL)
			uploaded, _ := doMultipartJSON[model.UserFile](t, http.MethodPost, server.URL+"/api/v1/files", session.Data.Token, "audios", audio.name, audio.mimeType, content)
			if uploaded.Code != 0 || !received {
				t.Fatalf("audio upload failed: code=%d msg=%s received=%v", uploaded.Code, uploaded.Msg, received)
			}
			stored, err := service.GetUserFile(uploaded.Data.ID, session.Data.User.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.OriginalName != audio.name || stored.MimeType != audio.mimeType || !strings.HasSuffix(stored.S3Key, audio.ext) || stored.Bytes != int64(len(content)) {
				t.Fatalf("stored audio changed: %#v", stored)
			}
		})
	}
}
