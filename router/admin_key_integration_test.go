package router_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/middleware"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestAdminKeyLifecycleAndScope(t *testing.T) {
	adminKeyFixture(t)
	admin := adminKeySession(t, model.UserRoleAdmin)
	ordinary := adminKeySession(t, model.UserRoleUser)
	engine := router.New()
	engine.GET("/_admin-key-actor", middleware.AdminKeyAuth, gin.WrapF(handler.CurrentUser))
	adminHeader := http.Header{"Authorization": {"Bearer " + admin.Token}}
	path := "/api/admin/settings/admin-key"
	status := adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodGet, path, adminHeader))
	if status.Code != 0 || status.Data.Enabled || status.Data.Key != "" {
		t.Fatalf("initial status = %#v", status)
	}
	createdResponse := adminKeyRequest(t, engine, http.MethodPost, path, adminHeader)
	created := adminKeyJSON[model.AdminKeyStatus](t, createdResponse)
	key := created.Data.Key
	random, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(key, "ak_"))
	if created.Code != 0 || !created.Data.Enabled || !strings.HasPrefix(key, "ak_") || len(random) != 32 || err != nil || created.Data.CreatedAt == "" {
		t.Fatalf("invalid generated key response: code=%d enabled=%v key length=%d", created.Code, created.Data.Enabled, len(key))
	}
	if createdResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("generated key response permits caching")
	}
	record, err := repository.GetAdminKey()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(key))
	if record.Hash != hex.EncodeToString(hash[:]) || record.UserID != admin.User.ID {
		t.Fatal("stored key is not a SHA-256 digest attributed to its issuer")
	}
	statusResponse := adminKeyRequest(t, engine, http.MethodGet, path, adminHeader)
	status = adminKeyJSON[model.AdminKeyStatus](t, statusResponse)
	if status.Code != 0 || !status.Data.Enabled || status.Data.Key != "" || statusResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status leaked key or is incorrect: %#v", status)
	}
	for _, settingsPath := range []string{"/api/settings", "/api/admin/settings"} {
		response := adminKeyRequest(t, engine, http.MethodGet, settingsPath, adminHeader)
		if strings.Contains(response.Body.String(), key) || strings.Contains(response.Body.String(), record.Hash) {
			t.Fatal("settings response leaked Admin Key material")
		}
	}
	settings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SaveSettings(settings, created.Data.CreatedAt); err != nil {
		t.Fatal(err)
	}
	keyHeader := http.Header{"X-Admin-Key": {key}}
	actor := adminKeyJSON[model.AuthUser](t, adminKeyRequest(t, engine, http.MethodGet, "/_admin-key-actor", keyHeader))
	if actor.Code != 0 || actor.Data.ID != admin.User.ID || actor.Data.Role != model.UserRoleAdmin {
		t.Fatalf("key actor = %#v", actor)
	}
	for name, headers := range map[string]http.Header{
		"missing":   nil,
		"wrong":     {"X-Admin-Key": {"ak_" + strings.Repeat("x", 43)}},
		"JWT":       adminHeader,
		"duplicate": {"X-Admin-Key": {key, key}},
	} {
		response := adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", headers)
		if response.Code != http.StatusUnauthorized || adminKeyJSON[any](t, response).Code != 1 {
			t.Fatalf("%s header accepted: HTTP %d %s", name, response.Code, response.Body.String())
		}
	}
	queryOnly := adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users?adminKey="+key, nil)
	if queryOnly.Code != http.StatusUnauthorized {
		t.Fatal("query string can authenticate an Admin Key")
	}
	for _, restricted := range []string{path, "/api/admin/users", "/api/v1/credit-logs"} {
		response := adminKeyRequest(t, engine, http.MethodGet, restricted, keyHeader)
		if adminKeyJSON[any](t, response).Code != 1 {
			t.Fatalf("Admin Key accessed JWT-only endpoint %s", restricted)
		}
	}
	for _, headers := range []http.Header{keyHeader, {"Authorization": {"Bearer " + ordinary.Token}}} {
		for _, method := range []string{http.MethodPost, http.MethodDelete} {
			if adminKeyJSON[any](t, adminKeyRequest(t, engine, method, path, headers)).Code != 1 {
				t.Fatalf("non-admin JWT authentication can %s Admin Key", method)
			}
		}
	}
	rotated := adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodPost, path, adminHeader))
	if rotated.Code != 0 || rotated.Data.Key == "" || rotated.Data.Key == key {
		t.Fatal("rotation did not return a new key")
	}
	if adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", keyHeader).Code != http.StatusUnauthorized {
		t.Fatal("old key survived rotation")
	}
	keyHeader.Set("X-Admin-Key", rotated.Data.Key)
	if response := adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", keyHeader); response.Code != http.StatusOK || adminKeyJSON[any](t, response).Code != 0 {
		t.Fatalf("rotated key rejected: %s", response.Body.String())
	}
	if revoked := adminKeyJSON[bool](t, adminKeyRequest(t, engine, http.MethodDelete, path, adminHeader)); revoked.Code != 0 || !revoked.Data {
		t.Fatal("revoke failed")
	}
	if adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", keyHeader).Code != http.StatusUnauthorized {
		t.Fatal("revoked key remained active")
	}
	status = adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodGet, path, adminHeader))
	if status.Code != 0 || status.Data.Enabled || status.Data.Key != "" {
		t.Fatalf("revoked status = %#v", status)
	}
}

func TestAdminKeyTracksIssuerAuthorization(t *testing.T) {
	adminKeyFixture(t)
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"ban", "demote", "delete"} {
		t.Run(change, func(t *testing.T) {
			admin := adminKeySession(t, model.UserRoleAdmin)
			engine := router.New()
			created := adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodPost, "/api/admin/settings/admin-key", http.Header{"Authorization": {"Bearer " + admin.Token}}))
			if created.Code != 0 || created.Data.Key == "" {
				t.Fatal("generate key failed")
			}
			switch change {
			case "ban":
				err = db.Model(&model.User{}).Where("id = ?", admin.User.ID).Update("status", model.UserStatusBan).Error
			case "demote":
				err = db.Model(&model.User{}).Where("id = ?", admin.User.ID).Update("role", model.UserRoleUser).Error
			case "delete":
				err = db.Delete(&model.User{}, "id = ?", admin.User.ID).Error
			}
			if err != nil {
				t.Fatal(err)
			}
			response := adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", http.Header{"X-Admin-Key": {created.Data.Key}})
			if response.Code != http.StatusUnauthorized || adminKeyJSON[any](t, response).Code != 1 {
				t.Fatalf("%s issuer key accepted: %s", change, response.Body.String())
			}
			status, err := service.AdminKeyStatus()
			if err != nil || status.Enabled {
				t.Fatalf("invalid issuer status = %#v, %v", status, err)
			}
		})
	}
}

func TestAdminKeyStorageErrorsPropagate(t *testing.T) {
	adminKeyFixture(t)
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Setting{Key: model.SettingKeyAdminKey, Value: json.RawMessage(`[]`)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.AdminKeyStatus(); err == nil {
		t.Fatal("status swallowed corrupt key storage")
	}
	response := adminKeyRequest(t, router.New(), http.MethodGet, "/api/v1/admin/users", http.Header{"X-Admin-Key": {"ak_" + strings.Repeat("x", 43)}})
	if response.Code != http.StatusInternalServerError || adminKeyJSON[any](t, response).Code != 1 {
		t.Fatalf("storage error = HTTP %d %s", response.Code, response.Body.String())
	}
}

func TestAdminKeyRejectsDisabledIssuerEnterprise(t *testing.T) {
	adminKeyFixture(t)
	username := "admin-key-enterprise-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "密钥签发企业", OwnerUsername: username, OwnerPassword: "admin-key-owner-password"})
	if err != nil {
		t.Fatal(err)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", enterprise.OwnerID).Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	admin, err := service.Login(username, "admin-key-owner-password")
	if err != nil {
		t.Fatal(err)
	}
	engine := router.New()
	created := adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodPost, "/api/admin/settings/admin-key", http.Header{"Authorization": {"Bearer " + admin.Token}}))
	if created.Code != 0 || created.Data.Key == "" {
		t.Fatal("generate enterprise issuer key failed")
	}
	if _, err := service.SetEnterpriseStatus(enterprise.ID, model.EnterpriseStatusDisabled); err != nil {
		t.Fatal(err)
	}
	response := adminKeyRequest(t, engine, http.MethodGet, "/api/v1/admin/users", http.Header{"X-Admin-Key": {created.Data.Key}})
	if response.Code != http.StatusUnauthorized || adminKeyJSON[any](t, response).Code != 1 {
		t.Fatalf("disabled enterprise issuer accepted: HTTP %d %s", response.Code, response.Body.String())
	}
	status, err := service.AdminKeyStatus()
	if err != nil || status.Enabled {
		t.Fatalf("disabled enterprise status = %#v, %v", status, err)
	}
}

func TestAdminKeyWriteErrorsPropagate(t *testing.T) {
	adminKeyFixture(t)
	admin := adminKeySession(t, model.UserRoleAdmin)
	engine := router.New()
	path := "/api/admin/settings/admin-key"
	headers := http.Header{"Authorization": {"Bearer " + admin.Token}}
	created := adminKeyJSON[model.AdminKeyStatus](t, adminKeyRequest(t, engine, http.MethodPost, path, headers))
	if created.Code != 0 || created.Data.Key == "" {
		t.Fatal("generate key failed")
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	rejectWrite := func(tx *gorm.DB) {
		if tx.Statement.Table == "settings" {
			tx.AddError(errors.New("forced Admin Key write failure"))
		}
	}
	if err := db.Callback().Create().Before("gorm:create").Register("test:admin_key_write_failure", rejectWrite); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove("test:admin_key_write_failure") })
	if err := db.Callback().Delete().Before("gorm:delete").Register("test:admin_key_delete_failure", rejectWrite); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Delete().Remove("test:admin_key_delete_failure") })
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		response := adminKeyJSON[*model.AdminKeyStatus](t, adminKeyRequest(t, engine, method, path, headers))
		if response.Code != 1 || response.Data != nil {
			t.Fatalf("%s ignored storage failure: %#v", method, response)
		}
		if _, valid, err := service.CurrentAdminKeyUser(created.Data.Key); err != nil || !valid {
			t.Fatalf("%s failure changed existing key: valid=%v err=%v", method, valid, err)
		}
	}
}

func adminKeyFixture(t *testing.T) {
	t.Helper()
	previous, err := repository.GetAdminKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.DeleteAdminKey(); err != nil {
		t.Fatal(err)
	}
	previousSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "admin-key-test-secret"
	t.Cleanup(func() {
		config.Cfg.JWTSecret = previousSecret
		var err error
		if previous.Hash == "" {
			err = repository.DeleteAdminKey()
		} else {
			err = repository.SaveAdminKey(previous)
		}
		if err != nil {
			t.Errorf("restore Admin Key: %v", err)
		}
	})
}

func adminKeySession(t *testing.T, role model.UserRole) model.AuthSession {
	t.Helper()
	username := "admin-key-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username, Role: role}, "admin-key-test-password"); err != nil {
		t.Fatal(err)
	}
	session, err := service.Login(username, "admin-key-test-password")
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func adminKeyRequest(t *testing.T, engine http.Handler, method, path string, headers http.Header) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	if headers != nil {
		request.Header = headers.Clone()
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func adminKeyJSON[T any](t *testing.T, response *httptest.ResponseRecorder) apiResponse[T] {
	t.Helper()
	var body apiResponse[T]
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode HTTP %d: %v", response.Code, err)
	}
	return body
}
