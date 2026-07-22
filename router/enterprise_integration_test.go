package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
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
