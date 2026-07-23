package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"sync"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type enterpriseFileView struct {
	ID           string  `json:"id"`
	UserID       string  `json:"userId"`
	EnterpriseID string  `json:"enterpriseId"`
	FileType     string  `json:"fileType"`
	URL          string  `json:"url"`
	OriginalName string  `json:"originalName"`
	MimeType     string  `json:"mimeType"`
	Bytes        int64   `json:"bytes"`
	CreatedAt    string  `json:"createdAt"`
	S3Key        *string `json:"s3Key"`
}

func TestEnterpriseMediaFilesAndAssetsAreSharedReadOnlyWithMembersThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	previousRegion := config.Cfg.AmazonRegion
	previousURL := config.Cfg.AmazonS3URL
	previousAccessKey := config.Cfg.AmazonS3AccessKey
	previousSecretKey := config.Cfg.AmazonS3SecretKey
	config.Cfg.JWTSecret = "enterprise-media-test-secret"
	config.Cfg.AmazonRegion = "us-east-1"
	config.Cfg.AmazonS3URL = "https://enterprise-media-test.s3.amazonaws.com"
	config.Cfg.AmazonS3AccessKey = "test-access-key"
	config.Cfg.AmazonS3SecretKey = "test-secret-key"
	t.Cleanup(func() {
		config.Cfg.JWTSecret = previousJWTSecret
		config.Cfg.AmazonRegion = previousRegion
		config.Cfg.AmazonS3URL = previousURL
		config.Cfg.AmazonS3AccessKey = previousAccessKey
		config.Cfg.AmazonS3SecretKey = previousSecretKey
	})

	objectServer := newObjectStorageStub(t)
	t.Setenv("AWS_ENDPOINT_URL_S3", objectServer.URL)

	ownerUsername := "media-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "媒体测试企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	otherOwnerUsername := "media-other-owner-" + uuid.NewString()
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "其他媒体企业", OwnerUsername: otherOwnerUsername, OwnerPassword: "owner-password"}); err != nil {
		t.Fatalf("create other enterprise: %v", err)
	}
	personalUsername := "media-personal-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: personalUsername}, "personal-password"); err != nil {
		t.Fatalf("create personal user: %v", err)
	}
	adminUsername := "media-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	otherOwner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": otherOwnerUsername, "password": "owner-password"})
	personal := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": personalUsername, "password": "personal-password"})
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "admin-password"})
	memberUsername := "media-member-" + uuid.NewString()
	memberCreated := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": memberUsername, "password": "member-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})

	uploaded, raw := doMultipartJSON[enterpriseFileView](t, http.MethodPost, server.URL+"/api/v1/enterprise/files", owner.Data.Token, "images", "brand.png", "image/png", []byte("image-v1"))
	if uploaded.Code != 0 || uploaded.Data.ID == "" || uploaded.Data.EnterpriseID != enterprise.ID || uploaded.Data.UserID != owner.Data.User.ID || uploaded.Data.FileType != "images" || uploaded.Data.URL == "" || uploaded.Data.Bytes != int64(len("image-v1")) {
		t.Fatalf("owner enterprise file upload = %#v", uploaded)
	}
	if uploaded.Data.S3Key != nil || bytes.Contains(raw, []byte(`"s3Key"`)) {
		t.Fatalf("enterprise file leaked raw s3 key: %s", raw)
	}

	memberFile := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID, member.Data.Token, nil)
	if memberFile.Code != 0 || memberFile.Data.ID != uploaded.Data.ID || memberFile.Data.URL == "" || memberFile.Data.S3Key != nil {
		t.Fatalf("member enterprise file read = %#v", memberFile)
	}
	status, content := doRawRequest(t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID+"/content", member.Data.Token, "", nil)
	if status != http.StatusOK || string(content) != "image-v1" {
		t.Fatalf("member enterprise file download status=%d content=%q", status, content)
	}

	memberUpload, _ := doMultipartJSON[enterpriseFileView](t, http.MethodPost, server.URL+"/api/v1/enterprise/files", member.Data.Token, "images", "blocked.png", "image/png", []byte("blocked"))
	if memberUpload.Code != 1 || memberUpload.Msg != "仅企业主账号可管理企业素材" {
		t.Fatalf("member enterprise file upload = %#v", memberUpload)
	}
	memberUpdate, _ := doMultipartJSON[enterpriseFileView](t, http.MethodPut, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID, member.Data.Token, "images", "blocked.png", "image/png", []byte("blocked"))
	if memberUpdate.Code != 1 || memberUpdate.Msg != "仅企业主账号可管理企业素材" {
		t.Fatalf("member enterprise file update = %#v", memberUpdate)
	}
	memberDelete := doJSON[bool](t, http.MethodDelete, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID, member.Data.Token, nil)
	if memberDelete.Code != 1 || memberDelete.Msg != "仅企业主账号可管理企业素材" {
		t.Fatalf("member enterprise file delete = %#v", memberDelete)
	}

	created := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", owner.Data.Token, map[string]any{
		"enterpriseId": "forged-enterprise", "userId": "forged-user", "type": "image", "title": "品牌主视觉", "tags": []string{"品牌"},
		"description": "企业共享图片", "fileId": uploaded.Data.ID, "width": 1200, "height": 800, "bytes": 999999, "mimeType": "forged/type",
	})
	if created.Code != 0 || created.Data.Type != model.AssetTypeImage || created.Data.FileID != uploaded.Data.ID || created.Data.URL == "" || created.Data.EnterpriseID != enterprise.ID || created.Data.Bytes != int64(len("image-v1")) || created.Data.MimeType != "image/png" {
		t.Fatalf("owner enterprise image asset create = %#v", created)
	}
	preview := doJSON[enterpriseAssetView](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, member.Data.Token, nil)
	if preview.Code != 0 || preview.Data.FileID != uploaded.Data.ID || preview.Data.URL == "" {
		t.Fatalf("member enterprise image preview = %#v", preview)
	}
	updatedAsset := doJSON[enterpriseAssetView](t, http.MethodPut, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, owner.Data.Token, map[string]any{
		"type": "image", "title": "品牌主视觉（新版）", "description": "更新后的企业共享图片", "fileId": uploaded.Data.ID, "width": 1600, "height": 900,
	})
	if updatedAsset.Code != 0 || updatedAsset.Data.Title != "品牌主视觉（新版）" || updatedAsset.Data.FileID != uploaded.Data.ID || updatedAsset.Data.URL == "" {
		t.Fatalf("owner enterprise image asset update = %#v", updatedAsset)
	}

	orphanFile, _ := doMultipartJSON[enterpriseFileView](t, http.MethodPost, server.URL+"/api/v1/enterprise/files", owner.Data.Token, "images", "orphan.png", "image/png", []byte("orphan"))
	ownerFileDelete := doJSON[bool](t, http.MethodDelete, server.URL+"/api/v1/enterprise/files/"+orphanFile.Data.ID, owner.Data.Token, nil)
	if ownerFileDelete.Code != 0 || !ownerFileDelete.Data {
		t.Fatalf("owner direct enterprise file delete = %#v", ownerFileDelete)
	}
	missingOrphan := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+orphanFile.Data.ID, member.Data.Token, nil)
	if missingOrphan.Code != 1 || missingOrphan.Msg != "文件不存在或无权访问" {
		t.Fatalf("deleted enterprise file remained readable = %#v", missingOrphan)
	}

	videoFile, videoRaw := doMultipartJSON[enterpriseFileView](t, http.MethodPost, server.URL+"/api/v1/enterprise/files", owner.Data.Token, "videos", "demo.mp4", "video/mp4", []byte("video-v1"))
	videoAsset := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", owner.Data.Token, map[string]any{
		"type": "video", "title": "产品演示", "fileId": videoFile.Data.ID, "width": 1920, "height": 1080,
	})
	if videoFile.Code != 0 || videoAsset.Code != 0 || videoAsset.Data.Type != model.AssetTypeVideo || videoAsset.Data.URL == "" || bytes.Contains(videoRaw, []byte(`"s3Key"`)) {
		t.Fatalf("enterprise video file=%#v asset=%#v raw=%s", videoFile, videoAsset, videoRaw)
	}
	videos := doJSON[enterpriseAssetList](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets?type=video", member.Data.Token, nil)
	if videos.Code != 0 || videos.Data.Total != 1 || len(videos.Data.Items) != 1 || videos.Data.Items[0].ID != videoAsset.Data.ID {
		t.Fatalf("member enterprise video list = %#v", videos)
	}

	for label, response := range map[string]apiResponse[enterpriseFileView]{
		"cross enterprise read":    doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, otherOwner.Data.Token, nil),
		"personal enterprise read": doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, personal.Data.Token, nil),
	} {
		if response.Code != 1 || response.Data.URL != "" {
			t.Fatalf("%s = %#v", label, response)
		}
	}
	crossDownload := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID+"/content", otherOwner.Data.Token, nil)
	if crossDownload.Code != 1 || crossDownload.Msg != "文件不存在或无权访问" {
		t.Fatalf("cross enterprise download = %#v", crossDownload)
	}
	crossUpdate, _ := doMultipartJSON[enterpriseFileView](t, http.MethodPut, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, otherOwner.Data.Token, "videos", "stolen.mp4", "video/mp4", []byte("stolen"))
	if crossUpdate.Code != 1 || crossUpdate.Msg != "文件不存在或无权操作" {
		t.Fatalf("cross enterprise update = %#v", crossUpdate)
	}
	crossDelete := doJSON[bool](t, http.MethodDelete, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, otherOwner.Data.Token, nil)
	if crossDelete.Code != 1 || crossDelete.Msg != "文件不存在或无权操作" {
		t.Fatalf("cross enterprise delete = %#v", crossDelete)
	}
	crossAsset := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", otherOwner.Data.Token, map[string]any{"type": "video", "title": "越权素材", "fileId": videoFile.Data.ID})
	if crossAsset.Code != 1 || crossAsset.Msg != "文件不存在或无权操作" {
		t.Fatalf("cross enterprise asset create = %#v", crossAsset)
	}

	ownerPersonalRead := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/files/"+videoFile.Data.ID, owner.Data.Token, nil)
	if ownerPersonalRead.Code != 1 || ownerPersonalRead.Msg != "文件不存在" {
		t.Fatalf("enterprise file leaked through personal API = %#v", ownerPersonalRead)
	}
	personalFile, personalRaw := doMultipartJSON[enterpriseFileView](t, http.MethodPost, server.URL+"/api/v1/files", personal.Data.Token, "images", "personal.png", "image/png", []byte("personal"))
	if personalFile.Code != 0 || personalFile.Data.EnterpriseID != "" || personalFile.Data.URL == "" || bytes.Contains(personalRaw, []byte(`"s3Key"`)) {
		t.Fatalf("personal file behavior = %#v raw=%s", personalFile, personalRaw)
	}
	personalThroughEnterprise := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+personalFile.Data.ID, owner.Data.Token, nil)
	if personalThroughEnterprise.Code != 1 || personalThroughEnterprise.Msg != "文件不存在或无权访问" {
		t.Fatalf("personal file leaked through enterprise API = %#v", personalThroughEnterprise)
	}

	replaced, _ := doMultipartJSON[enterpriseFileView](t, http.MethodPut, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID, owner.Data.Token, "images", "brand-new.png", "image/png", []byte("image-v2"))
	if replaced.Code != 0 || replaced.Data.ID != uploaded.Data.ID || replaced.Data.OriginalName != "brand-new.png" || replaced.Data.Bytes != int64(len("image-v2")) {
		t.Fatalf("owner enterprise file update = %#v", replaced)
	}
	status, content = doRawRequest(t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID+"/content", member.Data.Token, "", nil)
	if status != http.StatusOK || string(content) != "image-v2" {
		t.Fatalf("member updated enterprise file download status=%d content=%q", status, content)
	}

	deleted := doJSON[map[string]string](t, http.MethodDelete, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, owner.Data.Token, nil)
	if deleted.Code != 0 || deleted.Data["id"] != created.Data.ID {
		t.Fatalf("owner enterprise media asset delete = %#v", deleted)
	}
	missingFile := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+uploaded.Data.ID, member.Data.Token, nil)
	if missingFile.Code != 1 || missingFile.Msg != "文件不存在或无权访问" {
		t.Fatalf("deleted enterprise asset file remained readable = %#v", missingFile)
	}

	banned := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+memberCreated.Data.ID+"/status", owner.Data.Token, map[string]string{"status": "ban"})
	if banned.Code != 0 || banned.Data.Status != model.UserStatusBan {
		t.Fatalf("ban member = %#v", banned)
	}
	disabledMemberFile := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, member.Data.Token, nil)
	if disabledMemberFile.Code != 1 || disabledMemberFile.Data.URL != "" {
		t.Fatalf("disabled member received media URL = %#v", disabledMemberFile)
	}
	disabledEnterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.ID+"/status", admin.Data.Token, map[string]string{"status": "disabled"})
	if disabledEnterprise.Code != 0 || disabledEnterprise.Data.Status != "disabled" {
		t.Fatalf("disable enterprise = %#v", disabledEnterprise)
	}
	disabledOwnerFile := doJSON[enterpriseFileView](t, http.MethodGet, server.URL+"/api/v1/enterprise/files/"+videoFile.Data.ID, owner.Data.Token, nil)
	if disabledOwnerFile.Code != 1 || disabledOwnerFile.Data.URL != "" {
		t.Fatalf("disabled enterprise received media URL = %#v", disabledOwnerFile)
	}
}

func doMultipartJSON[T any](t *testing.T, method, endpoint, token, fileType, fileName, mimeType string, content []byte) (apiResponse[T], []byte) {
	t.Helper()
	body := bytes.NewBuffer(nil)
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("fileType", fileType); err != nil {
		t.Fatal(err)
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, fileName))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	status, raw := doRawRequest(t, method, endpoint, token, writer.FormDataContentType(), body)
	if status < 200 || status >= 500 {
		t.Fatalf("%s %s returned HTTP %d: %s", method, endpoint, status, raw)
	}
	var response apiResponse[T]
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("decode %s %s: %v: %s", method, endpoint, err, raw)
	}
	return response, raw
}

func doRawRequest(t *testing.T, method, endpoint, token, contentType string, body io.Reader) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, endpoint, body)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, content
}

func newObjectStorageStub(t *testing.T) *httptest.Server {
	t.Helper()
	var mu sync.Mutex
	objects := map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			content, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read object upload: %v", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			objects[r.URL.Path] = content
			w.Header().Set("ETag", `"test-etag"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			content, ok := objects[r.URL.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write(content)
		case http.MethodDelete:
			delete(objects, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(server.Close)
	return server
}
