package router_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type accountEnterpriseSummary struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Status      model.EnterpriseStatus `json:"status"`
	Role        model.EnterpriseRole   `json:"role"`
	MemberCount int                    `json:"memberCount"`
}

type accountGenerationTaskDetail struct {
	Task    model.GenerationTask     `json:"task"`
	Payload *model.GenerationPayload `json:"payload"`
}

func TestAccountProfileAndPasswordThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "account-profile-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	username := "account-user-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username, DisplayName: "旧昵称", Email: "old@example.com"}, "old-password"); err != nil {
		t.Fatalf("create user: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "old-password"})

	invalidEmail := doJSON[model.AuthUser](t, http.MethodPut, server.URL+"/api/v1/account/profile", session.Data.Token, map[string]string{"displayName": "新昵称", "email": "invalid"})
	if invalidEmail.Code != 1 || invalidEmail.Msg != "邮箱格式不正确" {
		t.Fatalf("invalid email = %#v", invalidEmail)
	}
	updated := doJSON[model.AuthUser](t, http.MethodPut, server.URL+"/api/v1/account/profile", session.Data.Token, map[string]string{
		"username": "must-not-change", "displayName": "新昵称", "email": "new@example.com",
	})
	if updated.Code != 0 || updated.Data.Username != username || updated.Data.DisplayName != "新昵称" || updated.Data.Email != "new@example.com" {
		t.Fatalf("profile update = %#v", updated)
	}
	wrongPassword := doJSON[bool](t, http.MethodPost, server.URL+"/api/v1/account/password", session.Data.Token, map[string]string{"currentPassword": "wrong", "newPassword": "new-password"})
	if wrongPassword.Code != 1 || wrongPassword.Msg != "当前密码错误" {
		t.Fatalf("wrong current password = %#v", wrongPassword)
	}
	changed := doJSON[bool](t, http.MethodPost, server.URL+"/api/v1/account/password", session.Data.Token, map[string]string{"currentPassword": "old-password", "newPassword": "new-password"})
	if changed.Code != 0 || !changed.Data {
		t.Fatalf("password change = %#v", changed)
	}
	assertRejectedSession(t, server.URL, session.Data.Token)
	if oldLogin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "old-password"}); oldLogin.Code != 1 {
		t.Fatalf("old password still works = %#v", oldLogin)
	}
	newLogin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "new-password"})
	if newLogin.Code != 0 || newLogin.Data.User.Username != username || newLogin.Data.User.DisplayName != "新昵称" || newLogin.Data.User.Email != "new@example.com" {
		t.Fatalf("new password login = %#v", newLogin)
	}
}

func TestEnterpriseAccountSummaryAndRenamePermissionsThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "account-enterprise-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "account-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "原企业名称", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	memberUsername := "account-member-" + uuid.NewString()
	memberRole := model.EnterpriseRoleMember
	if _, err := service.SaveUser(model.User{Username: memberUsername, EnterpriseID: &enterprise.ID, EnterpriseRole: &memberRole}, "member-password"); err != nil {
		t.Fatalf("create member: %v", err)
	}
	personalUsername := "account-personal-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: personalUsername}, "personal-password"); err != nil {
		t.Fatalf("create personal user: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	personal := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": personalUsername, "password": "personal-password"})

	summary := doJSON[accountEnterpriseSummary](t, http.MethodGet, server.URL+"/api/v1/enterprise/summary", owner.Data.Token, nil)
	if summary.Code != 0 || summary.Data.Name != "原企业名称" || summary.Data.Role != model.EnterpriseRoleOwner || summary.Data.MemberCount != 1 {
		t.Fatalf("owner enterprise summary = %#v", summary)
	}
	renamed := doJSON[accountEnterpriseSummary](t, http.MethodPut, server.URL+"/api/v1/account/enterprise", owner.Data.Token, map[string]string{"name": "新企业名称"})
	if renamed.Code != 0 || renamed.Data.Name != "新企业名称" {
		t.Fatalf("owner rename = %#v", renamed)
	}
	memberSummary := doJSON[accountEnterpriseSummary](t, http.MethodGet, server.URL+"/api/v1/enterprise/summary", member.Data.Token, nil)
	if memberSummary.Code != 0 || memberSummary.Data.Name != "新企业名称" || memberSummary.Data.Role != model.EnterpriseRoleMember {
		t.Fatalf("member enterprise summary = %#v", memberSummary)
	}
	memberRename := doJSON[accountEnterpriseSummary](t, http.MethodPut, server.URL+"/api/v1/account/enterprise", member.Data.Token, map[string]string{"name": "越权修改"})
	if memberRename.Code != 1 || memberRename.Msg != "仅企业主账号可修改企业名称" {
		t.Fatalf("member rename = %#v", memberRename)
	}
	personalSummary := doJSON[accountEnterpriseSummary](t, http.MethodGet, server.URL+"/api/v1/enterprise/summary", personal.Data.Token, nil)
	if personalSummary.Code != 1 || personalSummary.Msg != "当前账号不属于企业" {
		t.Fatalf("personal enterprise access = %#v", personalSummary)
	}
}

func TestAccountLogsOnlyExposeCurrentUserThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "account-logs-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	userA, err := service.SaveUser(model.User{Username: "account-logs-a-" + uuid.NewString(), Credits: 100}, "password-a")
	if err != nil {
		t.Fatalf("create user A: %v", err)
	}
	userB, err := service.SaveUser(model.User{Username: "account-logs-b-" + uuid.NewString(), Credits: 100}, "password-b")
	if err != nil {
		t.Fatalf("create user B: %v", err)
	}
	taskA, err := service.RecordUserTask(model.PublicUser(userA), model.TaskTypeVideo, string(model.SourceCanvas), "provider-a", "model-a", model.TaskStatusSucceeded, 7, 2300, "upstream-a-"+uuid.NewString(), "{}", "{}", "")
	if err != nil {
		t.Fatalf("record user A task: %v", err)
	}
	taskB, err := service.RecordUserTask(model.PublicUser(userB), model.TaskTypeImage, string(model.SourceImageWorkbench), "provider-b", "model-b", model.TaskStatusSuccess, 11, 1200, "upstream-b-"+uuid.NewString(), "{}", "{}", "")
	if err != nil {
		t.Fatalf("record user B task: %v", err)
	}
	if err := service.ConsumeUserCreditsWithTask(userA.ID, "model-a", 7, "/v1/generations", taskA.ID); err != nil {
		t.Fatalf("consume user A credits: %v", err)
	}
	if err := service.ConsumeUserCreditsWithTask(userB.ID, "model-b", 11, "/v1/images", taskB.ID); err != nil {
		t.Fatalf("consume user B credits: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	sessionA := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": userA.Username, "password": "password-a"})

	tasks := doJSON[model.GenerationTaskList](t, http.MethodGet, server.URL+"/api/v1/generation-tasks?user_id="+userB.ID+"&page=1&pageSize=20", sessionA.Data.Token, nil)
	if tasks.Code != 0 || tasks.Data.Total != 1 || len(tasks.Data.Items) != 1 {
		t.Fatalf("user A tasks = %#v", tasks)
	}
	if task := tasks.Data.Items[0]; task.ID != taskA.ID || task.UserID != userA.ID || task.TaskType != model.TaskTypeVideo || task.Source != string(model.SourceCanvas) || task.Model != "model-a" || task.Credits != 7 {
		t.Fatalf("user A task detail = %#v", task)
	}

	credits := doJSON[model.CreditLogList](t, http.MethodGet, server.URL+"/api/v1/credit-logs?userId="+userB.ID+"&page=1&pageSize=20", sessionA.Data.Token, nil)
	if credits.Code != 0 || credits.Data.Total != 1 || len(credits.Data.Items) != 1 {
		t.Fatalf("user A credit logs = %#v", credits)
	}
	if log := credits.Data.Items[0]; log.UserID != userA.ID || log.TaskID != taskA.ID || log.Type != model.CreditLogTypeAIConsume || log.Amount != -7 || log.Balance != 93 || log.Remark != "调用模型 model-a" {
		t.Fatalf("user A credit log detail = %#v", log)
	}

	ownDetail := doJSON[accountGenerationTaskDetail](t, http.MethodGet, server.URL+"/api/v1/generation-tasks/"+taskA.ID, sessionA.Data.Token, nil)
	if ownDetail.Code != 0 || ownDetail.Data.Task.ID != taskA.ID {
		t.Fatalf("user A own task detail = %#v", ownDetail)
	}
	otherDetail := doJSON[accountGenerationTaskDetail](t, http.MethodGet, server.URL+"/api/v1/generation-tasks/"+taskB.ID, sessionA.Data.Token, nil)
	if otherDetail.Code != 1 {
		t.Fatalf("user A read user B task detail = %#v", otherDetail)
	}
}

func TestEnterpriseDiscountAppliesToOwnerAndMembersButNotOtherUsers(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "account-discount-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "discount-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "计费折扣企业", OwnerUsername: ownerUsername, OwnerPassword: "password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.SetEnterpriseDiscountRate(enterprise.ID, 0.5); err != nil {
		t.Fatalf("set discount rate: %v", err)
	}
	if _, err := service.AdjustEnterpriseOwnerCredits(enterprise.ID, "discount-test-admin", 20, "测试充值"); err != nil {
		t.Fatalf("credit owner: %v", err)
	}
	memberRole := model.EnterpriseRoleMember
	member, err := service.SaveUser(model.User{Username: "discount-member-" + uuid.NewString(), Credits: 20, EnterpriseID: &enterprise.ID, EnterpriseRole: &memberRole}, "password")
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	personal, err := service.SaveUser(model.User{Username: "discount-personal-" + uuid.NewString(), Credits: 20}, "password")
	if err != nil {
		t.Fatalf("create personal user: %v", err)
	}
	admin, err := service.SaveUser(model.User{Username: "discount-admin-" + uuid.NewString(), Role: model.UserRoleAdmin, Credits: 20}, "password")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	owner, err := service.Login(ownerUsername, "password")
	if err != nil {
		t.Fatalf("login owner: %v", err)
	}
	memberSession, err := service.Login(member.Username, "password")
	if err != nil {
		t.Fatalf("login member: %v", err)
	}
	personalSession, err := service.Login(personal.Username, "password")
	if err != nil {
		t.Fatalf("login personal user: %v", err)
	}
	adminSession, err := service.Login(admin.Username, "password")
	if err != nil {
		t.Fatalf("login admin: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	for _, account := range []struct {
		label    string
		session  model.AuthSession
		expected int
	}{
		{label: "owner", session: owner, expected: 3},
		{label: "member", session: memberSession, expected: 3},
		{label: "personal", session: personalSession, expected: 5},
		{label: "admin", session: adminSession, expected: 5},
	} {
		taskID, err := service.LogTaskStart(account.session.User, model.TaskTypeImage, "test", "discount-model", []byte(`{}`), "{}", string(model.SourceCanvas), "")
		if err != nil {
			t.Fatalf("%s start task: %v", account.label, err)
		}
		if err := service.ConsumeUserCreditsWithTask(account.session.User.ID, "discount-model", 5, "/api/v1/images/generations", taskID); err != nil {
			t.Fatalf("%s consume credits: %v", account.label, err)
		}
		service.LogTaskSuccess(taskID, []byte(`{}`), "{}", 1, 5, "")

		tasks := doJSON[model.GenerationTaskList](t, http.MethodGet, server.URL+"/api/v1/generation-tasks?page=1&pageSize=20", account.session.Token, nil)
		if tasks.Code != 0 || tasks.Data.Total != 1 || len(tasks.Data.Items) != 1 || tasks.Data.Items[0].Credits != account.expected {
			t.Fatalf("%s usage log = %#v", account.label, tasks)
		}
		logs := doJSON[model.CreditLogList](t, http.MethodGet, server.URL+"/api/v1/credit-logs?type=ai_consume&page=1&pageSize=20", account.session.Token, nil)
		if logs.Code != 0 || logs.Data.Total != 1 || len(logs.Data.Items) != 1 || logs.Data.Items[0].Amount != -account.expected || logs.Data.Items[0].Balance != 20-account.expected {
			t.Fatalf("%s credit log = %#v", account.label, logs)
		}
	}
}

func TestEnterpriseDiscountRefundsTheAmountActuallyCharged(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "account-discount-refund-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "折扣退款企业", OwnerUsername: "discount-refund-owner-" + uuid.NewString(), OwnerPassword: "password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	if _, err := service.SetEnterpriseDiscountRate(enterprise.ID, 0.5); err != nil {
		t.Fatalf("set discount rate: %v", err)
	}
	memberRole := model.EnterpriseRoleMember
	member, err := service.SaveUser(model.User{Username: "discount-refund-member-" + uuid.NewString(), Credits: 20, EnterpriseID: &enterprise.ID, EnterpriseRole: &memberRole}, "password")
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	session, err := service.Login(member.Username, "password")
	if err != nil {
		t.Fatalf("login member: %v", err)
	}
	taskID, err := service.LogTaskStart(session.User, model.TaskTypeImage, "test", "discount-model", []byte(`{}`), "{}", string(model.SourceCanvas), "")
	if err != nil {
		t.Fatalf("start task: %v", err)
	}
	if err := service.ConsumeUserCreditsWithTask(member.ID, "discount-model", 5, "/api/v1/images/generations", taskID); err != nil {
		t.Fatalf("consume credits: %v", err)
	}
	if _, err := service.SetEnterpriseDiscountRate(enterprise.ID, 0.2); err != nil {
		t.Fatalf("change discount rate: %v", err)
	}
	if err := service.RefundUserCreditsWithTask(member.ID, "discount-model", 5, "/api/v1/images/generations", taskID); err != nil {
		t.Fatalf("refund credits: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	logs := doJSON[model.CreditLogList](t, http.MethodGet, server.URL+"/api/v1/credit-logs?page=1&pageSize=20", session.Token, nil)
	if logs.Code != 0 || logs.Data.Total != 2 || len(logs.Data.Items) != 2 {
		t.Fatalf("credit logs = %#v", logs)
	}
	byType := map[model.CreditLogType]model.CreditLog{}
	for _, log := range logs.Data.Items {
		byType[log.Type] = log
	}
	refund, consume := byType[model.CreditLogTypeAIRefund], byType[model.CreditLogTypeAIConsume]
	if refund.Amount != 3 || refund.Balance != 20 || consume.Amount != -3 || consume.Balance != 17 {
		t.Fatalf("discount charge/refund = %#v", logs.Data.Items)
	}
}
