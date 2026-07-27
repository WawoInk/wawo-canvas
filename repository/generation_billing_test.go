package repository

import (
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

func TestCreateGenerationTaskWithChargeIsAtomic(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	userID := "billing-user-" + uuid.NewString()
	user := model.User{ID: userID, Username: "billing-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: 10, CreatedAt: now, UpdatedAt: now}
	if _, err := SaveUser(user); err != nil {
		t.Fatalf("save user: %v", err)
	}
	task := model.GenerationTask{ID: "billing-task-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusQueued, CreatedAt: now, UpdatedAt: now}
	if err := CreateGenerationTaskWithCharge(&task, model.GenerationPayload{ID: "billing-payload-" + uuid.NewString(), CreatedAt: now}, userID, "seedance", "/api/v1/generations", 2); err != nil {
		t.Fatalf("create charged task: %v", err)
	}
	updated, ok, err := GetUserByID(userID)
	if err != nil || !ok || updated.Credits != 8 {
		t.Fatalf("user = %#v ok=%v err=%v", updated, ok, err)
	}
	logs, _, err := ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].TaskID != task.ID {
		t.Fatalf("logs = %#v err=%v", logs, err)
	}
}

func TestCreateGenerationTaskWithChargeAppliesEnterpriseDiscount(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	enterpriseID := "billing-enterprise-" + uuid.NewString()
	ownerID := "billing-owner-" + uuid.NewString()
	ownerRole := model.EnterpriseRoleOwner
	if err := CreateEnterpriseWithOwner(
		&model.Enterprise{ID: enterpriseID, Name: "折扣计费企业", Status: model.EnterpriseStatusActive, OwnerID: ownerID, DiscountRate: 0.5, CreatedAt: now, UpdatedAt: now},
		&model.User{ID: ownerID, Username: "billing-owner-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, EnterpriseID: &enterpriseID, EnterpriseRole: &ownerRole, CreatedAt: now, UpdatedAt: now},
	); err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	memberRole := model.EnterpriseRoleMember
	userID := "billing-member-" + uuid.NewString()
	if _, err := SaveUser(model.User{ID: userID, Username: "billing-member-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: 10, EnterpriseID: &enterpriseID, EnterpriseRole: &memberRole, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save member: %v", err)
	}
	task := model.GenerationTask{ID: "billing-discount-task-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusQueued, Credits: 5, CreatedAt: now, UpdatedAt: now}
	if err := CreateGenerationTaskWithCharge(&task, model.GenerationPayload{ID: "billing-discount-payload-" + uuid.NewString(), CreatedAt: now}, userID, "seedance", "/api/v1/generations", 5); err != nil {
		t.Fatalf("create charged task: %v", err)
	}

	user, ok, err := GetUserByID(userID)
	storedTask, taskErr := GetGenerationTaskByID(task.ID)
	logs, _, logErr := ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || !ok || user.Credits != 7 || task.Credits != 3 || taskErr != nil || storedTask.Credits != 3 || logErr != nil || len(logs) != 1 || logs[0].Amount != -3 || logs[0].Balance != 7 {
		t.Fatalf("discounted billing = user %#v ok=%v err=%v task %#v taskErr=%v logs %#v logErr=%v", user, ok, err, storedTask, taskErr, logs, logErr)
	}
}

func TestChargeGenerationTaskAppliesEnterpriseDiscount(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	enterpriseID := "settlement-enterprise-" + uuid.NewString()
	ownerID := "settlement-owner-" + uuid.NewString()
	ownerRole := model.EnterpriseRoleOwner
	if err := CreateEnterpriseWithOwner(
		&model.Enterprise{ID: enterpriseID, Name: "折扣结算企业", Status: model.EnterpriseStatusActive, OwnerID: ownerID, DiscountRate: 0.5, CreatedAt: now, UpdatedAt: now},
		&model.User{ID: ownerID, Username: "settlement-owner-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, EnterpriseID: &enterpriseID, EnterpriseRole: &ownerRole, CreatedAt: now, UpdatedAt: now},
	); err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	memberRole := model.EnterpriseRoleMember
	userID := "settlement-member-" + uuid.NewString()
	if _, err := SaveUser(model.User{ID: userID, Username: "settlement-member-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: 10, EnterpriseID: &enterpriseID, EnterpriseRole: &memberRole, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("save member: %v", err)
	}
	task := model.GenerationTask{ID: "settlement-task-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Model: "vidu", Status: model.TaskStatusRunning, BillingMode: model.BillingModePerCredit, BillingRate: 1, CreatedAt: now, UpdatedAt: now}
	if err := CreateGenerationTask(task, model.GenerationPayload{ID: "settlement-payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	upstreamCredits := 5
	charged, err := ChargeGenerationTask(task.ID, 5, &upstreamCredits, "/api/v1/generations")
	if err != nil {
		t.Fatalf("charge task: %v", err)
	}

	user, ok, userErr := GetUserByID(userID)
	logs, _, logErr := ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if charged.Credits != 3 || charged.UpstreamCredits == nil || *charged.UpstreamCredits != 5 || userErr != nil || !ok || user.Credits != 7 || logErr != nil || len(logs) != 1 || logs[0].Amount != -3 || logs[0].Balance != 7 {
		t.Fatalf("discounted settlement = task %#v err=%v user %#v ok=%v userErr=%v logs %#v logErr=%v", charged, err, user, ok, userErr, logs, logErr)
	}
}
