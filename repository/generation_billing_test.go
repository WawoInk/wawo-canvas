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
	if err := CreateGenerationTaskWithCharge(task, model.GenerationPayload{ID: "billing-payload-" + uuid.NewString(), CreatedAt: now}, userID, "seedance", "/api/v1/generations", 2); err != nil {
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
