package router_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type adminEnterpriseCreditLogHTTPItem struct {
	model.CreditLog
	EnterpriseID   string           `json:"enterpriseId"`
	EnterpriseName string           `json:"enterpriseName"`
	Username       string           `json:"username"`
	DisplayName    string           `json:"displayName"`
	Model          string           `json:"model"`
	Status         model.TaskStatus `json:"status"`
}

type adminEnterpriseCreditLogHTTPList struct {
	Items []adminEnterpriseCreditLogHTTPItem `json:"items"`
	Total int                                `json:"total"`
}

func TestAdminListsFilteredEnterpriseCreditLogsThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "admin-enterprise-credit-log-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "enterprise-log-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	target, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "目标流水企业-" + uuid.NewString(), OwnerUsername: "enterprise-log-owner-" + uuid.NewString(), OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create target enterprise: %v", err)
	}
	other, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "其他流水企业-" + uuid.NewString(), OwnerUsername: "enterprise-log-other-owner-" + uuid.NewString(), OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create other enterprise: %v", err)
	}
	personal, err := service.SaveUser(model.User{Username: "enterprise-log-personal-" + uuid.NewString()}, "user-password")
	if err != nil {
		t.Fatalf("create personal user: %v", err)
	}

	stamp := "2026-08-02T12:00:00Z"
	modelName := "enterprise-log-model-" + uuid.NewString()
	fixtures := []struct {
		userID string
		model  string
		status model.TaskStatus
		type_  model.CreditLogType
		amount model.Decimal
		stamp  string
	}{
		{target.OwnerID, modelName, model.TaskStatusFailed, model.CreditLogTypeAIRefund, credit(5), stamp},
		{target.OwnerID, "different-model", model.TaskStatusFailed, model.CreditLogTypeAIRefund, credit(4), stamp},
		{target.OwnerID, modelName, model.TaskStatusSucceeded, model.CreditLogTypeAIConsume, credit(-3), stamp},
		{target.OwnerID, modelName, model.TaskStatusFailed, model.CreditLogTypeAIRefund, credit(2), "2026-08-03T00:00:00Z"},
		{other.OwnerID, modelName, model.TaskStatusFailed, model.CreditLogTypeAIRefund, credit(7), stamp},
		{personal.ID, modelName, model.TaskStatusFailed, model.CreditLogTypeAIRefund, credit(9), stamp},
	}
	matchingLogID := "enterprise-log-credit-" + uuid.NewString()
	for i, fixture := range fixtures {
		taskID := "enterprise-log-task-" + uuid.NewString()
		if err := repository.CreateGenerationTask(model.GenerationTask{ID: taskID, UserID: fixture.userID, TaskType: model.TaskTypeImage, Model: fixture.model, Status: fixture.status, CreatedAt: fixture.stamp, UpdatedAt: fixture.stamp}, model.GenerationPayload{ID: "enterprise-log-payload-" + uuid.NewString(), CreatedAt: fixture.stamp}); err != nil {
			t.Fatalf("create generation task %d: %v", i, err)
		}
		logID := "enterprise-log-credit-" + uuid.NewString()
		if i == 0 {
			logID = matchingLogID
		}
		if _, err := repository.SaveCreditLog(model.CreditLog{ID: logID, UserID: fixture.userID, TaskID: taskID, Type: fixture.type_, Amount: fixture.amount, Balance: credit(20), Remark: "测试流水", CreatedAt: fixture.stamp}); err != nil {
			t.Fatalf("create credit log %d: %v", i, err)
		}
	}
	adjustmentLogID := "enterprise-log-adjustment-" + uuid.NewString()
	if _, err := repository.SaveCreditLog(model.CreditLog{ID: adjustmentLogID, UserID: target.OwnerID, Type: model.CreditLogTypeAdminAdjust, Amount: credit(10), Balance: credit(30), Remark: "平台调整", CreatedAt: stamp}); err != nil {
		t.Fatalf("create enterprise adjustment log: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": adminUsername, "password": "admin-password"})
	query := url.Values{
		"enterprise_id":   {target.ID},
		"enterprise_name": {target.Name},
		"model":           {modelName},
		"status":          {string(model.TaskStatusFailed)},
		"start_time":      {"2026-08-02T00:00:00Z"},
		"end_time":        {"2026-08-02T23:59:59.999Z"},
		"page":            {"1"},
		"pageSize":        {"20"},
	}
	logs := doJSON[adminEnterpriseCreditLogHTTPList](t, http.MethodGet, server.URL+"/api/admin/enterprise-credit-logs?"+query.Encode(), session.Data.Token, nil)
	if logs.Code != 0 || logs.Data.Total != 1 || len(logs.Data.Items) != 1 {
		t.Fatalf("filtered enterprise credit logs = %#v", logs)
	}
	item := logs.Data.Items[0]
	if item.ID != matchingLogID || item.EnterpriseID != target.ID || item.EnterpriseName != target.Name || item.Model != modelName || item.Status != model.TaskStatusFailed || item.Type != model.CreditLogTypeAIRefund || !item.Amount.Equal(credit(5)) {
		t.Fatalf("enterprise refund log = %#v", item)
	}

	allLogs := doJSON[adminEnterpriseCreditLogHTTPList](t, http.MethodGet, server.URL+"/api/admin/enterprise-credit-logs?enterprise_id="+url.QueryEscape(target.ID)+"&page=1&pageSize=20", session.Data.Token, nil)
	if allLogs.Code != 0 || allLogs.Data.Total != 5 {
		t.Fatalf("all target enterprise credit logs = %#v", allLogs)
	}
	for _, candidate := range allLogs.Data.Items {
		if candidate.ID == adjustmentLogID {
			if candidate.Model != "" || candidate.Status != "" || candidate.Type != model.CreditLogTypeAdminAdjust {
				t.Fatalf("enterprise adjustment log = %#v", candidate)
			}
			return
		}
	}
	t.Fatalf("enterprise adjustment log missing from %#v", allLogs.Data.Items)
}
