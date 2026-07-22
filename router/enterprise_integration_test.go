package router_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type enterpriseView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	OwnerID     string `json:"ownerId"`
	OwnerName   string `json:"ownerName"`
	OwnerStatus string `json:"ownerStatus"`
	MemberCount int    `json:"memberCount"`
	OwnerCredits int   `json:"ownerCredits"`
}

func TestEnterpriseOwnerIsEnforcedByDatabase(t *testing.T) {
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	enterprise := model.Enterprise{
		ID: "enterprise-orphan-" + uuid.NewString(), Name: "孤立企业", Status: model.EnterpriseStatusActive,
		OwnerID: "missing-owner-" + uuid.NewString(), CreatedAt: "2026-07-22T00:00:00Z", UpdatedAt: "2026-07-22T00:00:00Z",
	}
	if err := db.Create(&enterprise).Error; err == nil {
		t.Fatal("database accepted an enterprise without an owner")
	}
}

func TestEnterpriseOwnerMustHaveOwnerIdentity(t *testing.T) {
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	enterpriseID := "enterprise-invalid-owner-" + uuid.NewString()
	memberID := "user-invalid-owner-" + uuid.NewString()
	memberRole := model.EnterpriseRoleMember
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&model.Enterprise{ID: enterpriseID, Name: "错误主账号", Status: model.EnterpriseStatusActive, OwnerID: memberID, CreatedAt: "2026-07-22T00:00:00Z", UpdatedAt: "2026-07-22T00:00:00Z"}).Error; err != nil {
			return err
		}
		return tx.Create(&model.User{ID: memberID, Username: "invalid-owner-" + uuid.NewString(), Role: model.UserRoleUser, Status: model.UserStatusActive, EnterpriseID: &enterpriseID, EnterpriseRole: &memberRole, AffCode: uuid.NewString(), CreatedAt: "2026-07-22T00:00:00Z", UpdatedAt: "2026-07-22T00:00:00Z"}).Error
	})
	if err == nil {
		t.Fatal("database accepted an enterprise owner with member identity")
	}
}

type enterpriseList struct {
	Items []enterpriseView `json:"items"`
	Total int              `json:"total"`
}

func TestAdminCreatesEnterpriseAndOwnerThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-http-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "enterprise-test-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "enterprise-test-password"})
	ownerUsername := "enterprise-owner-" + uuid.NewString()
	created := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "测试企业 A", "ownerUsername": ownerUsername, "ownerPassword": "owner-test-password", "ownerDisplayName": "企业主账号",
	})

	if created.Code != 0 || created.Data.ID == "" || created.Data.Name != "测试企业 A" || created.Data.Status != "active" {
		t.Fatalf("create enterprise response = %#v", created)
	}
	if created.Data.OwnerID == "" || created.Data.OwnerName != ownerUsername || created.Data.OwnerStatus != "active" || created.Data.MemberCount != 0 || created.Data.OwnerCredits != 0 {
		t.Fatalf("create owner response = %#v", created.Data)
	}
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-test-password"})
	if owner.Code != 0 || owner.Data.User.Role != model.UserRoleUser {
		t.Fatalf("owner login response = %#v", owner)
	}
}

func TestAdminListsSearchesAndAtomicallyCreatesEnterprises(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-list-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-list-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "enterprise-test-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "enterprise-test-password"})
	ownerUsername := "searchable-owner-" + uuid.NewString()
	created := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "可搜索企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-test-password",
	})

	listed := doJSON[enterpriseList](t, http.MethodGet, server.URL+"/api/admin/enterprises?keyword="+ownerUsername+"&page=1&pageSize=10", admin.Data.Token, nil)
	if listed.Code != 0 || listed.Data.Total != 1 || len(listed.Data.Items) != 1 || listed.Data.Items[0].ID != created.Data.ID {
		t.Fatalf("enterprise list response = %#v", listed)
	}
	duplicate := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "不应保留的企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-test-password",
	})
	if duplicate.Code != 1 || duplicate.Msg != "用户名已存在" {
		t.Fatalf("duplicate response = %#v", duplicate)
	}
	afterFailure := doJSON[enterpriseList](t, http.MethodGet, server.URL+"/api/admin/enterprises?keyword=不应保留的企业", admin.Data.Token, nil)
	if afterFailure.Code != 0 || afterFailure.Data.Total != 0 {
		t.Fatalf("failed transaction left enterprise = %#v", afterFailure)
	}
}

func TestEnterpriseAndOwnerStatusInvalidateSessionsIndependently(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-auth-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-auth-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "enterprise-test-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "enterprise-test-password"})
	ownerUsername := "status-owner-" + uuid.NewString()
	enterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "状态测试企业", "ownerUsername": ownerUsername, "ownerPassword": "old-owner-password",
	})
	memberUsername := "status-member-" + uuid.NewString()
	memberRole := model.EnterpriseRoleMember
	if _, err := service.SaveUser(model.User{Username: memberUsername, Role: model.UserRoleUser, EnterpriseID: &enterprise.Data.ID, EnterpriseRole: &memberRole}, "member-password"); err != nil {
		t.Fatalf("create member: %v", err)
	}

	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "old-owner-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	if owner.Data.User.EnterpriseID != enterprise.Data.ID || owner.Data.User.EnterpriseName != "状态测试企业" || owner.Data.User.EnterpriseRole != model.EnterpriseRoleOwner || owner.Data.User.EnterpriseStatus != model.EnterpriseStatusActive {
		t.Fatalf("owner enterprise summary = %#v", owner.Data.User)
	}
	if member.Data.User.EnterpriseID != enterprise.Data.ID || member.Data.User.EnterpriseRole != model.EnterpriseRoleMember {
		t.Fatalf("member enterprise summary = %#v", member.Data.User)
	}

	disabled := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/status", admin.Data.Token, map[string]string{"status": "disabled"})
	if disabled.Code != 0 || disabled.Data.Status != "disabled" {
		t.Fatalf("disable enterprise = %#v", disabled)
	}
	assertRejectedSession(t, server.URL, owner.Data.Token)
	assertRejectedSession(t, server.URL, member.Data.Token)
	if login := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"}); login.Code != 1 {
		t.Fatalf("disabled enterprise login = %#v", login)
	}

	doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/status", admin.Data.Token, map[string]string{"status": "active"})
	member = doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	owner = doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "old-owner-password"})

	banned := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/owner/status", admin.Data.Token, map[string]string{"status": "ban"})
	if banned.Code != 0 || banned.Data.OwnerStatus != "ban" {
		t.Fatalf("ban owner = %#v", banned)
	}
	assertRejectedSession(t, server.URL, owner.Data.Token)
	if activeMember := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"}); activeMember.Code != 0 {
		t.Fatalf("owner ban affected member = %#v", activeMember)
	}

	doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/owner/status", admin.Data.Token, map[string]string{"status": "active"})
	owner = doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "old-owner-password"})
	reset := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/owner/password", admin.Data.Token, map[string]string{"password": "new-owner-password"})
	if reset.Code != 0 {
		t.Fatalf("reset owner password = %#v", reset)
	}
	assertRejectedSession(t, server.URL, owner.Data.Token)
	if oldPassword := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "old-owner-password"}); oldPassword.Code != 1 {
		t.Fatalf("old password still works = %#v", oldPassword)
	}
	if newPassword := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "new-owner-password"}); newPassword.Code != 0 {
		t.Fatalf("new password login = %#v", newPassword)
	}
}

func assertRejectedSession(t *testing.T, baseURL, token string) {
	t.Helper()
	response := doJSON[model.CreditLogList](t, http.MethodGet, baseURL+"/api/v1/credit-logs", token, nil)
	if response.Code != 1 {
		t.Fatalf("session remained active = %#v", response)
	}
}
