package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type enterpriseView struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	OwnerID      string `json:"ownerId"`
	OwnerName    string `json:"ownerName"`
	OwnerStatus  string `json:"ownerStatus"`
	MemberCount  int    `json:"memberCount"`
	OwnerCredits int    `json:"ownerCredits"`
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

type enterpriseMember struct {
	ID             string               `json:"id"`
	Username       string               `json:"username"`
	DisplayName    string               `json:"displayName"`
	Email          string               `json:"email"`
	Status         model.UserStatus     `json:"status"`
	Credits        int                  `json:"credits"`
	Role           model.UserRole       `json:"role"`
	EnterpriseID   string               `json:"enterpriseId"`
	EnterpriseRole model.EnterpriseRole `json:"enterpriseRole"`
}

type enterpriseMemberList struct {
	Items []enterpriseMember `json:"items"`
	Total int                `json:"total"`
}

type enterpriseCreditTransfer struct {
	RequestID    string           `json:"requestId"`
	Action       string           `json:"action"`
	Amount       int              `json:"amount"`
	OwnerCredits int              `json:"ownerCredits"`
	Member       enterpriseMember `json:"member"`
}

type enterpriseCreditLog struct {
	UserID         string              `gorm:"column:user_id"`
	Type           model.CreditLogType `gorm:"column:type"`
	Amount         int                 `gorm:"column:amount"`
	Balance        int                 `gorm:"column:balance"`
	RelatedID      string              `gorm:"column:related_id"`
	CounterpartyID string              `gorm:"column:counterparty_id"`
}

func TestEnterpriseOwnerCreatesAndListsMembersThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-member-create-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "member-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "成员测试企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	invalidUsername := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "invalid member", "password": "member-password"})
	if invalidUsername.Code != 1 || invalidUsername.Msg != "用户名不能包含空格" {
		t.Fatalf("invalid member username = %#v", invalidUsername)
	}
	emptyPassword := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "empty-password-" + uuid.NewString(), "password": ""})
	if emptyPassword.Code != 1 || emptyPassword.Msg != "密码不能为空" {
		t.Fatalf("empty member password = %#v", emptyPassword)
	}
	memberUsername := "created-member-" + uuid.NewString()
	created := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]any{
		"username": memberUsername, "password": "member-password", "displayName": "新成员", "email": "member@example.com",
		"enterpriseId": "enterprise-other", "enterpriseRole": "owner", "role": "admin", "status": "ban", "credits": 999,
	})
	if created.Code != 0 || created.Data.ID == "" || created.Data.Username != memberUsername || created.Data.DisplayName != "新成员" || created.Data.Email != "member@example.com" {
		t.Fatalf("create member response = %#v", created)
	}
	if created.Data.EnterpriseID != enterprise.ID || created.Data.EnterpriseRole != model.EnterpriseRoleMember || created.Data.Role != model.UserRoleUser || created.Data.Status != model.UserStatusActive || created.Data.Credits != 0 {
		t.Fatalf("server-controlled member fields = %#v", created.Data)
	}

	listed := doJSON[enterpriseMemberList](t, http.MethodGet, server.URL+"/api/v1/enterprise/members?keyword="+memberUsername+"&page=1&pageSize=10", owner.Data.Token, nil)
	if listed.Code != 0 || listed.Data.Total != 1 || len(listed.Data.Items) != 1 || listed.Data.Items[0].ID != created.Data.ID {
		t.Fatalf("member list response = %#v", listed)
	}
	login := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	if login.Code != 0 || login.Data.User.ID != created.Data.ID || login.Data.User.EnterpriseRole != model.EnterpriseRoleMember || login.Data.User.Credits != 0 {
		t.Fatalf("member login response = %#v", login)
	}
}

func TestEnterpriseMemberScopeIsEnforcedThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-member-scope-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerAUsername := "scope-owner-a-" + uuid.NewString()
	ownerBUsername := "scope-owner-b-" + uuid.NewString()
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "企业 A", OwnerUsername: ownerAUsername, OwnerPassword: "owner-password"}); err != nil {
		t.Fatalf("create enterprise A: %v", err)
	}
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "企业 B", OwnerUsername: ownerBUsername, OwnerPassword: "owner-password"}); err != nil {
		t.Fatalf("create enterprise B: %v", err)
	}
	personalUsername := "scope-personal-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: personalUsername}, "personal-password"); err != nil {
		t.Fatalf("create personal user: %v", err)
	}
	adminUsername := "scope-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	ownerA := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerAUsername, "password": "owner-password"})
	ownerB := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerBUsername, "password": "owner-password"})
	personal := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": personalUsername, "password": "personal-password"})
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "admin-password"})
	memberAUsername := "scope-member-a-" + uuid.NewString()
	memberBUsername := "scope-member-b-" + uuid.NewString()
	memberA := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", ownerA.Data.Token, map[string]string{"username": memberAUsername, "password": "member-password"})
	memberB := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", ownerB.Data.Token, map[string]string{"username": memberBUsername, "password": "member-password"})
	memberASession := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberAUsername, "password": "member-password"})

	for label, token := range map[string]string{"member": memberASession.Data.Token, "personal": personal.Data.Token, "admin": admin.Data.Token} {
		response := doJSON[enterpriseMemberList](t, http.MethodGet, server.URL+"/api/v1/enterprise/members", token, nil)
		if response.Code != 1 || response.Msg != "仅企业主账号可管理成员" {
			t.Fatalf("%s listed enterprise members = %#v", label, response)
		}
	}
	memberCreate := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", memberASession.Data.Token, map[string]string{"username": "forbidden-member-" + uuid.NewString(), "password": "member-password"})
	if memberCreate.Code != 1 || memberCreate.Msg != "仅企业主账号可管理成员" {
		t.Fatalf("member created enterprise member = %#v", memberCreate)
	}
	for label, token := range map[string]string{"member": memberASession.Data.Token, "personal": personal.Data.Token, "admin": admin.Data.Token} {
		response := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+memberA.Data.ID+"/credits", token, map[string]any{"action": "allocate", "amount": 1, "requestId": "forbidden-" + uuid.NewString()})
		if response.Code != 1 || response.Msg != "仅企业主账号可管理成员" {
			t.Fatalf("%s transferred enterprise credits = %#v", label, response)
		}
	}
	for label, targetID := range map[string]string{
		"self": ownerA.Data.User.ID, "other owner": ownerB.Data.User.ID, "personal": personal.Data.User.ID,
		"admin": admin.Data.User.ID, "other enterprise member": memberB.Data.ID,
	} {
		response := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+targetID+"/status", ownerA.Data.Token, map[string]string{"status": "ban"})
		if response.Code != 1 || response.Msg != "成员不存在或无权操作" {
			t.Fatalf("owner changed %s = %#v", label, response)
		}
	}
	crossEnterprise := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+memberA.Data.ID+"/status", ownerB.Data.Token, map[string]string{"status": "ban"})
	if crossEnterprise.Code != 1 || crossEnterprise.Msg != "成员不存在或无权操作" {
		t.Fatalf("cross-enterprise status response = %#v", crossEnterprise)
	}
	crossReset := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+memberA.Data.ID+"/password", ownerB.Data.Token, map[string]string{"password": "forbidden-password"})
	if crossReset.Code != 1 || crossReset.Msg != "成员不存在或无权操作" {
		t.Fatalf("cross-enterprise password response = %#v", crossReset)
	}
	crossTransfer := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+memberA.Data.ID+"/credits", ownerB.Data.Token, map[string]any{"action": "allocate", "amount": 1, "requestId": "cross-" + uuid.NewString()})
	if crossTransfer.Code != 1 || crossTransfer.Msg != "成员不存在或无权操作" {
		t.Fatalf("cross-enterprise transfer response = %#v", crossTransfer)
	}
	if login := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberAUsername, "password": "member-password"}); login.Code != 0 {
		t.Fatalf("rejected requests changed member = %#v", login)
	}
}

func TestEnterpriseMemberStatusAndPasswordInvalidateSessionsThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-member-session-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "session-owner-" + uuid.NewString()
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "会话测试企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"}); err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	memberUsername := "session-member-" + uuid.NewString()
	member := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": memberUsername, "password": "old-password"})
	oldSession := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "old-password"})

	disabled := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/status", owner.Data.Token, map[string]string{"status": "ban"})
	if disabled.Code != 0 || disabled.Data.Status != model.UserStatusBan {
		t.Fatalf("disable member = %#v", disabled)
	}
	assertRejectedSession(t, server.URL, oldSession.Data.Token)
	if login := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "old-password"}); login.Code != 1 || login.Msg != "账号已被禁用" {
		t.Fatalf("disabled member login = %#v", login)
	}

	enabled := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/status", owner.Data.Token, map[string]string{"status": "active"})
	if enabled.Code != 0 || enabled.Data.Status != model.UserStatusActive {
		t.Fatalf("enable member = %#v", enabled)
	}
	activeSession := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "old-password"})
	emptyPassword := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/password", owner.Data.Token, map[string]string{"password": ""})
	if emptyPassword.Code != 1 || emptyPassword.Msg != "密码不能为空" {
		t.Fatalf("empty member password = %#v", emptyPassword)
	}
	reset := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/password", owner.Data.Token, map[string]string{"password": "new-password"})
	if reset.Code != 0 || reset.Data.ID != member.Data.ID {
		t.Fatalf("reset member password = %#v", reset)
	}
	assertRejectedSession(t, server.URL, activeSession.Data.Token)
	if oldPassword := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "old-password"}); oldPassword.Code != 1 {
		t.Fatalf("old member password still works = %#v", oldPassword)
	}
	if newPassword := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "new-password"}); newPassword.Code != 0 {
		t.Fatalf("new member password login = %#v", newPassword)
	}
}

func TestEnterpriseOwnerAllocatesAndReclaimsMemberCreditsThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-transfer-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "transfer-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "积分划拨企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.AdjustEnterpriseOwnerCredits(enterprise.ID, "transfer-test-admin", 100, "测试充值"); err != nil {
		t.Fatalf("fund owner: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	member := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "transfer-member-" + uuid.NewString(), "password": "member-password"})
	allocateID := "allocate-" + uuid.NewString()
	allocate := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 40, "requestId": allocateID})
	duplicate := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 40, "requestId": allocateID})
	secondAllocateID := "allocate-" + uuid.NewString()
	secondAllocate := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 10, "requestId": secondAllocateID})
	reclaimID := "reclaim-" + uuid.NewString()
	reclaim := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "reclaim", "amount": 25, "requestId": reclaimID})
	if allocate.Code != 0 || allocate.Data.OwnerCredits != 60 || allocate.Data.Member.Credits != 40 || allocate.Data.RequestID != allocateID || allocate.Data.Action != "allocate" || allocate.Data.Amount != 40 {
		t.Fatalf("allocate response = %#v", allocate)
	}
	if duplicate.Code != 0 || duplicate.Data.OwnerCredits != 60 || duplicate.Data.Member.Credits != 40 {
		t.Fatalf("duplicate response = %#v", duplicate)
	}
	if secondAllocate.Code != 0 || secondAllocate.Data.OwnerCredits != 50 || secondAllocate.Data.Member.Credits != 50 {
		t.Fatalf("second allocation response = %#v", secondAllocate)
	}
	if reclaim.Code != 0 || reclaim.Data.OwnerCredits != 75 || reclaim.Data.Member.Credits != 25 || reclaim.Data.RequestID != reclaimID || reclaim.Data.Action != "reclaim" || reclaim.Data.Amount != 25 {
		t.Fatalf("reclaim response = %#v", reclaim)
	}

	storedOwner, ownerOK, err := repository.GetUserByID(owner.Data.User.ID)
	if err != nil || !ownerOK || storedOwner.Credits != 75 {
		t.Fatalf("stored owner = %#v ok=%v err=%v", storedOwner, ownerOK, err)
	}
	storedMember, memberOK, err := repository.GetUserByID(member.Data.ID)
	if err != nil || !memberOK || storedMember.Credits != 25 {
		t.Fatalf("stored member = %#v ok=%v err=%v", storedMember, memberOK, err)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	var logs []enterpriseCreditLog
	if err := db.Table("credit_logs").Where("related_id IN ?", []string{allocateID, secondAllocateID, reclaimID}).Order("related_id, user_id").Find(&logs).Error; err != nil {
		t.Fatalf("list transfer logs: %v", err)
	}
	if len(logs) != 6 {
		t.Fatalf("transfer logs = %#v", logs)
	}
	for _, log := range logs {
		if log.RelatedID == allocateID && ((log.UserID == owner.Data.User.ID && (log.Amount != -40 || log.Balance != 60 || log.CounterpartyID != member.Data.ID)) || (log.UserID == member.Data.ID && (log.Amount != 40 || log.Balance != 40 || log.CounterpartyID != owner.Data.User.ID))) {
			t.Fatalf("allocate log = %#v", log)
		}
		if log.RelatedID == secondAllocateID && ((log.UserID == owner.Data.User.ID && (log.Amount != -10 || log.Balance != 50 || log.CounterpartyID != member.Data.ID)) || (log.UserID == member.Data.ID && (log.Amount != 10 || log.Balance != 50 || log.CounterpartyID != owner.Data.User.ID))) {
			t.Fatalf("second allocate log = %#v", log)
		}
		if log.RelatedID == reclaimID && ((log.UserID == owner.Data.User.ID && (log.Amount != 25 || log.Balance != 75 || log.CounterpartyID != member.Data.ID)) || (log.UserID == member.Data.ID && (log.Amount != -25 || log.Balance != 25 || log.CounterpartyID != owner.Data.User.ID))) {
			t.Fatalf("reclaim log = %#v", log)
		}
	}
}

func TestSavingStaleUserDoesNotOverwriteEnterpriseCreditTransfer(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-transfer-stale-user-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "transfer-stale-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "陈旧写入企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.AdjustEnterpriseOwnerCredits(enterprise.ID, "transfer-stale-admin", 100, "测试充值"); err != nil {
		t.Fatalf("fund owner: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	member := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "transfer-stale-member-" + uuid.NewString(), "password": "member-password"})
	staleOwner, ok, err := repository.GetUserByID(owner.Data.User.ID)
	if err != nil || !ok {
		t.Fatalf("read stale owner: ok=%v err=%v", ok, err)
	}
	transferred := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 40, "requestId": "stale-" + uuid.NewString()})
	if transferred.Code != 0 || transferred.Data.OwnerCredits != 60 {
		t.Fatalf("transfer response = %#v", transferred)
	}
	staleOwner.LastLoginAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUser(staleOwner); err != nil {
		t.Fatalf("save stale owner: %v", err)
	}
	storedOwner, _, _ := repository.GetUserByID(owner.Data.User.ID)
	if storedOwner.Credits != 60 {
		t.Fatalf("stale user save restored credits to %d", storedOwner.Credits)
	}
}

func TestEnterpriseCreditTransfersSerializeWithConcurrentTransfersAndGenerationCharges(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-transfer-concurrency-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "transfer-concurrency-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "积分并发企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.AdjustEnterpriseOwnerCredits(enterprise.ID, "transfer-concurrency-admin", 50, "测试充值"); err != nil {
		t.Fatalf("fund owner: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	members := []enterpriseMember{
		doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "transfer-concurrency-a-" + uuid.NewString(), "password": "member-password"}).Data,
		doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "transfer-concurrency-b-" + uuid.NewString(), "password": "member-password"}).Data,
	}
	type transferResult struct {
		memberID  string
		requestID string
		response  apiResponse[enterpriseCreditTransfer]
		err       error
	}
	results := make(chan transferResult, 2)
	requestIDs := []string{"parallel-a-" + uuid.NewString(), "parallel-b-" + uuid.NewString()}
	start := make(chan struct{})
	for i := range members {
		go func(i int) {
			<-start
			response, err := requestEnterpriseMemberCredit(server.URL, owner.Data.Token, members[i].ID, "allocate", 40, requestIDs[i])
			results <- transferResult{memberID: members[i].ID, requestID: requestIDs[i], response: response, err: err}
		}(i)
	}
	close(start)
	successfulMemberID := ""
	successfulRequestID := ""
	failedRequestID := ""
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("parallel transfer request: %v", result.err)
		}
		if result.response.Code == 0 {
			if successfulMemberID != "" {
				t.Fatalf("both overcommitted transfers succeeded")
			}
			successfulMemberID = result.memberID
			successfulRequestID = result.requestID
		} else if result.response.Msg != "主账号余额不足" {
			t.Fatalf("parallel transfer response = %#v", result.response)
		} else {
			failedRequestID = result.requestID
		}
	}
	if successfulMemberID == "" {
		t.Fatal("both parallel transfers failed")
	}

	storedOwner, _, _ := repository.GetUserByID(owner.Data.User.ID)
	memberTotal := 0
	for _, item := range members {
		stored, _, err := repository.GetUserByID(item.ID)
		if err != nil || stored.Credits < 0 {
			t.Fatalf("stored member = %#v err=%v", stored, err)
		}
		memberTotal += stored.Credits
	}
	if storedOwner.Credits != 10 || memberTotal != 40 || storedOwner.Credits+memberTotal != 50 {
		t.Fatalf("balances after parallel transfers = owner %d members %d", storedOwner.Credits, memberTotal)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	var successfulLogs []enterpriseCreditLog
	if err := db.Table("credit_logs").Where("related_id = ?", successfulRequestID).Find(&successfulLogs).Error; err != nil || len(successfulLogs) != 2 {
		t.Fatalf("successful parallel transfer logs = %#v err=%v", successfulLogs, err)
	}
	for _, log := range successfulLogs {
		if log.UserID == owner.Data.User.ID && (log.Amount != -40 || log.Balance != 10 || log.CounterpartyID != successfulMemberID) {
			t.Fatalf("successful owner log = %#v", log)
		}
		if log.UserID == successfulMemberID && (log.Amount != 40 || log.Balance != 40 || log.CounterpartyID != owner.Data.User.ID) {
			t.Fatalf("successful member log = %#v", log)
		}
	}
	var failedLogs int64
	if err := db.Model(&model.CreditLog{}).Where("related_id = ?", failedRequestID).Count(&failedLogs).Error; err != nil || failedLogs != 0 {
		t.Fatalf("failed parallel transfer logs = %d err=%v", failedLogs, err)
	}

	raceID := "charge-race-" + uuid.NewString()
	taskID := "transfer-charge-task-" + uuid.NewString()
	chargeDone := make(chan error, 1)
	reclaimDone := make(chan transferResult, 1)
	start = make(chan struct{})
	go func() {
		<-start
		chargeDone <- service.ConsumeUserCreditsWithTask(successfulMemberID, "并发模型", 20, "/api/v1/images/generations", taskID)
	}()
	go func() {
		<-start
		response, err := requestEnterpriseMemberCredit(server.URL, owner.Data.Token, successfulMemberID, "reclaim", 30, raceID)
		reclaimDone <- transferResult{response: response, err: err}
	}()
	close(start)
	chargeErr := <-chargeDone
	reclaimResult := <-reclaimDone
	if reclaimResult.err != nil {
		t.Fatalf("concurrent reclaim request: %v", reclaimResult.err)
	}
	chargeSucceeded := chargeErr == nil
	reclaimSucceeded := reclaimResult.response.Code == 0
	if chargeSucceeded == reclaimSucceeded {
		t.Fatalf("charge success=%v reclaim=%#v chargeErr=%v", chargeSucceeded, reclaimResult.response, chargeErr)
	}
	if !reclaimSucceeded && reclaimResult.response.Msg != "成员余额不足" {
		t.Fatalf("concurrent reclaim response = %#v", reclaimResult.response)
	}

	storedOwner, _, _ = repository.GetUserByID(owner.Data.User.ID)
	chargedMember, _, _ := repository.GetUserByID(successfulMemberID)
	otherMember, _, _ := repository.GetUserByID(members[0].ID)
	if otherMember.ID == successfulMemberID {
		otherMember, _, _ = repository.GetUserByID(members[1].ID)
	}
	consumed := 0
	if chargeSucceeded {
		consumed = 20
	}
	if storedOwner.Credits < 0 || chargedMember.Credits < 0 || otherMember.Credits < 0 || storedOwner.Credits+chargedMember.Credits+otherMember.Credits+consumed != 50 {
		t.Fatalf("balances after charge race = owner %d member %d other %d consumed %d", storedOwner.Credits, chargedMember.Credits, otherMember.Credits, consumed)
	}
	var reclaimLogs, consumeLogs int64
	_ = db.Model(&model.CreditLog{}).Where("related_id = ?", raceID).Count(&reclaimLogs).Error
	_ = db.Model(&model.CreditLog{}).Where("task_id = ? AND type = ?", taskID, model.CreditLogTypeAIConsume).Count(&consumeLogs).Error
	if reclaimSucceeded && (reclaimLogs != 2 || consumeLogs != 0) {
		t.Fatalf("reclaim won: reclaim logs=%d consume logs=%d", reclaimLogs, consumeLogs)
	}
	if chargeSucceeded && (reclaimLogs != 0 || consumeLogs != 1) {
		t.Fatalf("charge won: reclaim logs=%d consume logs=%d", reclaimLogs, consumeLogs)
	}
}

func TestEnterpriseCreditTransferValidationInsufficientBalancesAndRollback(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-transfer-rollback-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "transfer-rollback-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "积分回滚企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.AdjustEnterpriseOwnerCredits(enterprise.ID, "transfer-rollback-admin", 30, "测试充值"); err != nil {
		t.Fatalf("fund owner: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	member := doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": "transfer-rollback-member-" + uuid.NewString(), "password": "member-password"})

	invalid := []struct {
		payload map[string]any
		message string
	}{
		{map[string]any{"action": "invalid", "amount": 1, "requestId": "invalid-" + uuid.NewString()}, "积分操作无效"},
		{map[string]any{"action": "allocate", "amount": 0, "requestId": "zero-" + uuid.NewString()}, "积分数量必须为正整数"},
		{map[string]any{"action": "allocate", "amount": 1, "requestId": ""}, "请求 ID 无效"},
	}
	for _, item := range invalid {
		response := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, item.payload)
		if response.Code != 1 || response.Msg != item.message {
			t.Fatalf("invalid transfer = %#v", response)
		}
	}
	allocateID := "insufficient-owner-" + uuid.NewString()
	allocate := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 31, "requestId": allocateID})
	reclaimID := "insufficient-member-" + uuid.NewString()
	reclaim := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "reclaim", "amount": 1, "requestId": reclaimID})
	if allocate.Code != 1 || allocate.Msg != "主账号余额不足" || reclaim.Code != 1 || reclaim.Msg != "成员余额不足" {
		t.Fatalf("insufficient responses = allocate %#v reclaim %#v", allocate, reclaim)
	}

	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	rollbackID := "rollback-" + uuid.NewString()
	suffix := uuid.NewString()[:8]
	functionName := "fail_transfer_" + suffix
	triggerName := "fail_transfer_log_" + suffix
	if err := db.Exec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger AS $$ BEGIN IF NEW.related_id = '%s' THEN RAISE EXCEPTION 'forced transfer log failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`, functionName, rollbackID)).Error; err != nil {
		t.Fatalf("create rollback function: %v", err)
	}
	if err := db.Exec(fmt.Sprintf("CREATE TRIGGER %s BEFORE INSERT ON credit_logs FOR EACH ROW EXECUTE FUNCTION %s()", triggerName, functionName)).Error; err != nil {
		t.Fatalf("create rollback trigger: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + triggerName + " ON credit_logs").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
	})
	rolledBack := doJSON[enterpriseCreditTransfer](t, http.MethodPost, server.URL+"/api/v1/enterprise/members/"+member.Data.ID+"/credits", owner.Data.Token, map[string]any{"action": "allocate", "amount": 10, "requestId": rollbackID})
	if rolledBack.Code != 1 {
		t.Fatalf("forced rollback response = %#v", rolledBack)
	}

	storedOwner, _, _ := repository.GetUserByID(owner.Data.User.ID)
	storedMember, _, _ := repository.GetUserByID(member.Data.ID)
	var logs int64
	_ = db.Model(&model.CreditLog{}).Where("related_id IN ?", []string{allocateID, reclaimID, rollbackID}).Count(&logs).Error
	if storedOwner.Credits != 30 || storedMember.Credits != 0 || logs != 0 {
		t.Fatalf("failed transfers changed state = owner %d member %d logs %d", storedOwner.Credits, storedMember.Credits, logs)
	}
	if err := db.Model(&model.User{}).Where("id = ?", member.Data.ID).Update("credits", -1).Error; err == nil {
		t.Fatal("database accepted a negative balance")
	}
	storedMember, _, _ = repository.GetUserByID(member.Data.ID)
	if storedMember.Credits != 0 {
		t.Fatalf("negative update changed member = %#v", storedMember)
	}
}

func TestGenerationCreditChargeRollsBackWhenLedgerWriteFails(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	user := model.User{ID: "transfer-charge-rollback-user-" + uuid.NewString(), Username: "transfer-charge-rollback-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: 20, CreatedAt: now, UpdatedAt: now}
	if _, err := repository.SaveUser(user); err != nil {
		t.Fatalf("create charged user: %v", err)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	taskID := "transfer-charge-rollback-task-" + uuid.NewString()
	suffix := uuid.NewString()[:8]
	functionName := "fail_charge_" + suffix
	triggerName := "fail_charge_log_" + suffix
	if err := db.Exec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger AS $$ BEGIN IF NEW.task_id = '%s' THEN RAISE EXCEPTION 'forced charge log failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`, functionName, taskID)).Error; err != nil {
		t.Fatalf("create charge rollback function: %v", err)
	}
	if err := db.Exec(fmt.Sprintf("CREATE TRIGGER %s BEFORE INSERT ON credit_logs FOR EACH ROW EXECUTE FUNCTION %s()", triggerName, functionName)).Error; err != nil {
		t.Fatalf("create charge rollback trigger: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + triggerName + " ON credit_logs").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
	})
	if err := service.ConsumeUserCreditsWithTask(user.ID, "回滚模型", 5, "/api/v1/images/generations", taskID); err == nil {
		t.Fatal("charge succeeded despite forced ledger failure")
	}
	stored, _, _ := repository.GetUserByID(user.ID)
	var logs int64
	_ = db.Model(&model.CreditLog{}).Where("task_id = ? AND type = ?", taskID, model.CreditLogTypeAIConsume).Count(&logs).Error
	if stored.Credits != 20 || logs != 0 {
		t.Fatalf("failed charge changed state = credits %d logs %d", stored.Credits, logs)
	}
	idempotentTaskID := "transfer-charge-idempotent-task-" + uuid.NewString()
	if err := service.ConsumeUserCreditsOnce(user.ID, "幂等模型", 5, "/api/v1/images/generations", idempotentTaskID); err != nil {
		t.Fatalf("consume credits: %v", err)
	}
	if err := service.ConsumeUserCreditsOnce(user.ID, "幂等模型", 5, "/api/v1/images/generations", idempotentTaskID); err != nil {
		t.Fatalf("repeat consume credits: %v", err)
	}
	if err := service.RefundUserCreditsOnce(user.ID, "幂等模型", 5, "/api/v1/images/generations", idempotentTaskID); err != nil {
		t.Fatalf("refund credits: %v", err)
	}
	if err := service.RefundUserCreditsOnce(user.ID, "幂等模型", 5, "/api/v1/images/generations", idempotentTaskID); err != nil {
		t.Fatalf("repeat refund credits: %v", err)
	}
	stored, _, _ = repository.GetUserByID(user.ID)
	var settledLogs int64
	_ = db.Model(&model.CreditLog{}).Where("task_id = ?", idempotentTaskID).Count(&settledLogs).Error
	if stored.Credits != 20 || settledLogs != 2 {
		t.Fatalf("idempotent charge/refund = credits %d logs %d", stored.Credits, settledLogs)
	}
}

func requestEnterpriseMemberCredit(baseURL, token, memberID, action string, amount int, requestID string) (apiResponse[enterpriseCreditTransfer], error) {
	body, _ := json.Marshal(map[string]any{"action": action, "amount": amount, "requestId": requestID})
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/enterprise/members/"+memberID+"/credits", bytes.NewReader(body))
	if err != nil {
		return apiResponse[enterpriseCreditTransfer]{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return apiResponse[enterpriseCreditTransfer]{}, err
	}
	defer response.Body.Close()
	var result apiResponse[enterpriseCreditTransfer]
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return result, err
	}
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("status %d", response.StatusCode)
	}
	return result, nil
}

func TestAdminAdjustsEnterpriseOwnerCreditsByDeltaAndRecordsLog(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-credit-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-credit-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "enterprise-test-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "enterprise-test-password"})
	enterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "充值测试企业", "ownerUsername": "enterprise-credit-owner-" + uuid.NewString(), "ownerPassword": "owner-test-password",
	})

	first := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": 100, "reason": "首次充值"})
	second := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": 50, "reason": "追加充值"})
	if first.Code != 0 || first.Data.OwnerCredits != 100 || second.Code != 0 || second.Data.OwnerCredits != 150 {
		t.Fatalf("delta adjustments = first %#v, second %#v", first, second)
	}

	doJSON[model.CreditLog](t, http.MethodPost, server.URL+"/api/admin/credit-logs", admin.Data.Token, model.CreditLog{
		UserID: enterprise.Data.OwnerID, Type: model.CreditLogTypeAIConsume, Amount: -1, Balance: 149, Remark: "测试类型筛选",
	})
	logs := doJSON[model.CreditLogList](t, http.MethodGet, server.URL+"/api/admin/credit-logs?keyword="+enterprise.Data.OwnerID+"&type=admin_adjust&pageSize=10", admin.Data.Token, nil)
	if logs.Code != 0 || logs.Data.Total != 2 || len(logs.Data.Items) != 2 {
		t.Fatalf("credit logs = %#v", logs)
	}
	amounts := map[int]bool{}
	for _, log := range logs.Data.Items {
		if log.UserID != enterprise.Data.OwnerID || log.RelatedID != admin.Data.User.ID || log.Type != model.CreditLogTypeAdminAdjust || log.Remark == "" {
			t.Fatalf("credit log association = %#v", log)
		}
		amounts[log.Amount] = true
	}
	if !amounts[100] || !amounts[50] {
		t.Fatalf("credit log amounts = %#v", logs.Data.Items)
	}
}

func TestEnterpriseOwnerCreditsCannotBeOverwrittenThroughUserAdminEndpoint(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-credit-overwrite-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-credit-overwrite-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "enterprise-test-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "enterprise-test-password"})
	enterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "覆盖保护企业", "ownerUsername": "enterprise-credit-overwrite-owner-" + uuid.NewString(), "ownerPassword": "owner-test-password",
	})
	doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": 100, "reason": "初始充值"})

	overwrite := doJSON[model.User](t, http.MethodPost, server.URL+"/api/admin/users/"+enterprise.Data.OwnerID+"/credits", admin.Data.Token, map[string]int{"credits": 999})
	if overwrite.Code != 1 || overwrite.Msg != "请在企业管理中按增量调整主账号积分" {
		t.Fatalf("owner overwrite response = %#v", overwrite)
	}
	listed := doJSON[enterpriseList](t, http.MethodGet, server.URL+"/api/admin/enterprises?keyword="+enterprise.Data.OwnerName, admin.Data.Token, nil)
	if listed.Code != 0 || listed.Data.Total != 1 || listed.Data.Items[0].OwnerCredits != 100 {
		t.Fatalf("owner balance after overwrite = %#v", listed)
	}
}

func TestEnterpriseOwnerCreditAdjustmentGuardsAndConcurrency(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-credit-guard-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-credit-guard-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "admin-password"})
	ownerUsername := "enterprise-credit-guard-owner-" + uuid.NewString()
	enterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "并发充值企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-password",
	})
	memberUsername := "enterprise-credit-guard-member-" + uuid.NewString()
	memberRole := model.EnterpriseRoleMember
	if _, err := service.SaveUser(model.User{Username: memberUsername, EnterpriseID: &enterprise.Data.ID, EnterpriseRole: &memberRole}, "member-password"); err != nil {
		t.Fatalf("create member: %v", err)
	}
	personalUsername := "enterprise-credit-guard-personal-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: personalUsername}, "personal-password"); err != nil {
		t.Fatalf("create personal user: %v", err)
	}

	added := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": 100, "reason": "充值"})
	deducted := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": -30, "reason": "人工扣减"})
	insufficient := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": -80, "reason": "余额不足"})
	if added.Code != 0 || added.Data.OwnerCredits != 100 || deducted.Code != 0 || deducted.Data.OwnerCredits != 70 {
		t.Fatalf("add/deduct responses = added %#v, deducted %#v", added, deducted)
	}
	if insufficient.Code != 1 || insufficient.Msg != "主账号余额不足" {
		t.Fatalf("insufficient response = %#v", insufficient)
	}

	results := make(chan creditRequestResult, 2)
	for _, delta := range []int{10, 20} {
		go func(delta int) {
			response, err := requestEnterpriseCredit(server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, delta, "并发充值")
			results <- creditRequestResult{response: response, err: err}
		}(delta)
	}
	for range 2 {
		result := <-results
		if result.err != nil || result.response.Code != 0 {
			t.Fatalf("concurrent adjustment = response %#v, error %v", result.response, result.err)
		}
	}

	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	personal := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": personalUsername, "password": "personal-password"})
	for label, token := range map[string]string{"owner": owner.Data.Token, "member": member.Data.Token, "personal": personal.Data.Token} {
		response := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", token, map[string]any{"delta": 10, "reason": "越权调整"})
		if response.Code != 1 || response.Msg != "未登录或权限不足" {
			t.Fatalf("%s adjustment response = %#v", label, response)
		}
	}

	listed := doJSON[enterpriseList](t, http.MethodGet, server.URL+"/api/admin/enterprises?keyword="+enterprise.Data.OwnerName, admin.Data.Token, nil)
	logs := doJSON[model.CreditLogList](t, http.MethodGet, server.URL+"/api/admin/credit-logs?keyword="+enterprise.Data.OwnerID+"&type=admin_adjust&pageSize=10", admin.Data.Token, nil)
	if listed.Code != 0 || listed.Data.Total != 1 || listed.Data.Items[0].OwnerCredits != 100 {
		t.Fatalf("final enterprise balance = %#v", listed)
	}
	if logs.Code != 0 || logs.Data.Total != 4 || len(logs.Data.Items) != 4 {
		t.Fatalf("final credit logs = %#v", logs)
	}
	amountTotal := 0
	concurrentFinalBalances := 0
	for _, log := range logs.Data.Items {
		amountTotal += log.Amount
		if log.UserID != enterprise.Data.OwnerID || log.RelatedID != admin.Data.User.ID || log.Balance < 0 {
			t.Fatalf("inconsistent credit log = %#v", log)
		}
		if (log.Amount == 10 || log.Amount == 20) && log.Balance == 100 {
			concurrentFinalBalances++
		}
	}
	if amountTotal != 100 || concurrentFinalBalances != 1 {
		t.Fatalf("credit log totals = %#v", logs.Data.Items)
	}
}

type creditRequestResult struct {
	response apiResponse[enterpriseView]
	err      error
}

func requestEnterpriseCredit(url, token string, delta int, reason string) (apiResponse[enterpriseView], error) {
	body, _ := json.Marshal(map[string]any{"delta": delta, "reason": reason})
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return apiResponse[enterpriseView]{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return apiResponse[enterpriseView]{}, err
	}
	defer response.Body.Close()
	var result apiResponse[enterpriseView]
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return result, err
	}
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("status %d", response.StatusCode)
	}
	return result, nil
}

type adminUserView struct {
	ID             string               `json:"id"`
	Username       string               `json:"username"`
	Credits        int                  `json:"credits"`
	EnterpriseID   string               `json:"enterpriseId"`
	EnterpriseName string               `json:"enterpriseName"`
	EnterpriseRole model.EnterpriseRole `json:"enterpriseRole"`
}

type adminUserList struct {
	Items []adminUserView `json:"items"`
	Total int             `json:"total"`
}

func TestAdminUserListShowsEnterpriseIdentityAndOwnerBalance(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-user-list-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-user-list-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "admin-password"})
	ownerUsername := "enterprise-user-list-owner-" + uuid.NewString()
	enterprise := doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises", admin.Data.Token, map[string]string{
		"name": "用户视图企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-password",
	})
	doJSON[enterpriseView](t, http.MethodPost, server.URL+"/api/admin/enterprises/"+enterprise.Data.ID+"/credits", admin.Data.Token, map[string]any{"delta": 80, "reason": "测试充值"})

	users := doJSON[adminUserList](t, http.MethodGet, server.URL+"/api/admin/users?keyword="+ownerUsername, admin.Data.Token, nil)
	if users.Code != 0 || users.Data.Total != 1 || len(users.Data.Items) != 1 {
		t.Fatalf("admin user list = %#v", users)
	}
	owner := users.Data.Items[0]
	if owner.ID != enterprise.Data.OwnerID || owner.Credits != 80 || owner.EnterpriseID != enterprise.Data.ID || owner.EnterpriseName != "用户视图企业" || owner.EnterpriseRole != model.EnterpriseRoleOwner {
		t.Fatalf("enterprise owner user view = %#v", owner)
	}
}
