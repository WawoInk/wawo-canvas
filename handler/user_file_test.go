package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func TestProxyUploadRejectsUpstreamErrorResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "invalid signed URL", http.StatusForbidden)
	}))
	defer upstream.Close()

	body, _ := json.Marshal(map[string]string{"url": upstream.URL, "fileType": "results/images", "fileName": "generated.png"})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/files/proxy-upload", bytes.NewReader(body))
	request = request.WithContext(service.WithUser(request.Context(), model.AuthUser{ID: "user-1", Role: model.UserRoleUser}))
	response := httptest.NewRecorder()

	ProxyUpload(response, request)

	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code == 0 || payload.Msg != "下载文件失败" {
		t.Fatalf("response = %#v", payload)
	}
}
