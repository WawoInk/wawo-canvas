package router_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type adminGenerationTaskRefundDetail struct {
	Task            model.GenerationTask     `json:"task"`
	Payload         *model.GenerationPayload `json:"payload"`
	CanRepairRefund bool                     `json:"canRepairRefund"`
}

func TestAdminRepairsMissingEnterpriseMemberRefundOnceThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "admin-generation-refund-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	admin, err := service.SaveUser(model.User{Username: "refund-admin-" + uuid.NewString(), Role: model.UserRoleAdmin}, "admin-password")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{
		Name: "退款修复企业", OwnerUsername: "refund-owner-" + uuid.NewString(), OwnerPassword: "owner-password",
	})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	memberRole := model.EnterpriseRoleMember
	member, err := service.SaveUser(model.User{
		Username: "refund-member-" + uuid.NewString(), Credits: credit(20), EnterpriseID: &enterprise.ID, EnterpriseRole: &memberRole,
	}, "member-password")
	if err != nil {
		t.Fatalf("create member: %v", err)
	}

	taskID := "task-" + uuid.NewString()
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if err := repository.CreateGenerationTask(model.GenerationTask{
		ID: taskID, UserID: member.ID, TaskType: model.TaskTypeImage, Model: "refund-model", Status: model.TaskStatusFailed, CreatedAt: stamp, UpdatedAt: stamp,
	}, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: stamp}); err != nil {
		t.Fatalf("create failed task: %v", err)
	}
	if err := service.ConsumeUserCreditsWithTask(member.ID, "refund-model", credit(5), "/api/v1/images/generations", taskID); err != nil {
		t.Fatalf("charge member: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": admin.Username, "password": "admin-password"})
	detail := doJSON[adminGenerationTaskRefundDetail](t, http.MethodGet, server.URL+"/api/admin/generation-tasks/"+taskID+"?include_payload=true", session.Data.Token, nil)
	if detail.Code != 0 || !detail.Data.CanRepairRefund {
		t.Fatalf("repairable detail = %#v", detail)
	}

	reason := "系统退款失败人工补发"
	for range 2 {
		repaired := doJSON[bool](t, http.MethodPost, server.URL+"/api/admin/generation-tasks/"+taskID+"/refund", session.Data.Token, map[string]string{"reason": reason})
		if repaired.Code != 0 || !repaired.Data {
			t.Fatalf("repair response = %#v", repaired)
		}
	}
	stored, _, _ := repository.GetUserByID(member.ID)
	if !stored.Credits.Equal(credit(20)) {
		t.Fatalf("member credits after repair = %s", stored.Credits.String())
	}
	detail = doJSON[adminGenerationTaskRefundDetail](t, http.MethodGet, server.URL+"/api/admin/generation-tasks/"+taskID, session.Data.Token, nil)
	if detail.Code != 0 || detail.Data.CanRepairRefund {
		t.Fatalf("repaired detail = %#v", detail)
	}

	db, err := repository.DB()
	if err != nil {
		t.Fatalf("get db: %v", err)
	}
	var logs []model.CreditLog
	if err := db.Where("task_id = ?", taskID).Order("type").Find(&logs).Error; err != nil || len(logs) != 2 {
		t.Fatalf("task credit logs = %#v err=%v", logs, err)
	}
	var refund model.CreditLog
	for _, log := range logs {
		if log.Type == model.CreditLogTypeAIRefund {
			refund = log
		}
	}
	if !refund.Amount.Equal(credit(5)) || !refund.Balance.Equal(credit(20)) || refund.RelatedID != session.Data.User.ID || !strings.Contains(refund.Remark, reason) {
		t.Fatalf("refund log = %#v", refund)
	}

	runningTaskID := "task-" + uuid.NewString()
	if err := repository.CreateGenerationTask(model.GenerationTask{
		ID: runningTaskID, UserID: member.ID, TaskType: model.TaskTypeImage, Model: "running-model", Status: model.TaskStatusRunning, CreatedAt: stamp, UpdatedAt: stamp,
	}, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: stamp}); err != nil {
		t.Fatalf("create running task: %v", err)
	}
	if err := service.ConsumeUserCreditsWithTask(member.ID, "running-model", credit(2), "/api/v1/images/generations", runningTaskID); err != nil {
		t.Fatalf("charge running task: %v", err)
	}
	blocked := doJSON[bool](t, http.MethodPost, server.URL+"/api/admin/generation-tasks/"+runningTaskID+"/refund", session.Data.Token, map[string]string{"reason": reason})
	if blocked.Code != 1 || blocked.Msg != "仅失败或已取消任务可补发退款" {
		t.Fatalf("running task refund = %#v", blocked)
	}
}
