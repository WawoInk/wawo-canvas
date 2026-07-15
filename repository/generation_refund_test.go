package repository

import (
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

func TestRefundGenerationTaskOnce(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	userID := "refund-user-" + uuid.NewString()
	user := model.User{ID: userID, Username: "refund-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: 8, CreatedAt: now, UpdatedAt: now}
	if _, err := SaveUser(user); err != nil {
		t.Fatalf("save user: %v", err)
	}
	task := model.GenerationTask{ID: "refund-task-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusFailed, Credits: 2, CreatedAt: now, UpdatedAt: now}
	if err := CreateGenerationTask(task, model.GenerationPayload{ID: "refund-payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := RefundGenerationTaskOnce(task, "seedance", "/api/v1/generations"); err != nil {
		t.Fatalf("first refund: %v", err)
	}
	if err := RefundGenerationTaskOnce(task, "seedance", "/api/v1/generations"); err != nil {
		t.Fatalf("second refund: %v", err)
	}
	updated, ok, err := GetUserByID(userID)
	if err != nil || !ok || updated.Credits != 10 {
		t.Fatalf("user = %#v ok=%v err=%v", updated, ok, err)
	}
	logs, _, err := ListCreditLogsByUserID(userID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].Type != model.CreditLogTypeAIRefund {
		t.Fatalf("logs = %#v err=%v", logs, err)
	}
}
