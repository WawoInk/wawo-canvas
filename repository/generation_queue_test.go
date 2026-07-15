package repository

import (
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

func TestClaimGenerationTaskByIDClaimsQueuedTask(t *testing.T) {
	now := time.Now().UTC()
	task := model.GenerationTask{ID: "gentask-by-id-" + uuid.NewString(), UserID: "user-by-id", TaskType: model.TaskTypeVideo, Status: model.TaskStatusQueued, QueueAvailableAt: now.Add(-time.Minute).Format(time.RFC3339), CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339)}
	if err := CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: task.CreatedAt}); err != nil {
		t.Fatalf("create: %v", err)
	}
	claimed, ok, err := ClaimGenerationTaskByID(task.ID, "worker-by-id", now, time.Minute)
	if err != nil || !ok || claimed.ID != task.ID {
		t.Fatalf("claimed=%#v ok=%v err=%v", claimed, ok, err)
	}
}
