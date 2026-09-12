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

func TestGenerationTaskLeaseBlocksSecondOwnerUntilExpiry(t *testing.T) {
	now := time.Now().UTC()
	lease := time.Minute
	task := model.GenerationTask{ID: "gentask-lease-" + uuid.NewString(), UserID: "user-lease", TaskType: model.TaskTypeVideo, Status: model.TaskStatusQueued, QueueAvailableAt: now.Add(-time.Minute).Format(time.RFC3339), CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339)}
	if err := CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: task.CreatedAt}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, ok, err := ClaimGenerationTaskByID(task.ID, "worker-a", now, lease); err != nil || !ok {
		t.Fatalf("first claim ok=%v err=%v", ok, err)
	}
	if _, ok, err := ClaimGenerationTaskByID(task.ID, "worker-b", now.Add(lease-time.Second), lease); err != nil || ok {
		t.Fatalf("claim before expiry ok=%v err=%v", ok, err)
	}
	claimed, ok, err := ClaimGenerationTaskByID(task.ID, "worker-b", now.Add(lease+time.Second), lease)
	if err != nil || !ok || claimed.WorkerLeaseOwner != "worker-b" {
		t.Fatalf("claim after expiry=%#v ok=%v err=%v", claimed, ok, err)
	}
}

func TestQueueAcceptedCompatibilityTaskRollsBackWhenOwnershipCannotBeSaved(t *testing.T) {
	now := time.Now().UTC()
	upstreamTaskID := "accepted-conflict-" + uuid.NewString()
	if err := SaveVideoTask("existing-owner", upstreamTaskID, "existing-model"); err != nil {
		t.Fatalf("save existing ownership: %v", err)
	}
	task := model.GenerationTask{
		ID: "accepted-task-" + uuid.NewString(), UserID: "new-owner", TaskType: model.TaskTypeVideo,
		Model: "seedance-1-5-pro", Status: model.TaskStatusRunning,
		CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano),
	}
	payload := model.GenerationPayload{ID: "accepted-payload-" + uuid.NewString(), CreatedAt: task.CreatedAt}
	if err := CreateGenerationTask(task, payload); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if err := QueueAcceptedCompatibilityTask(task.ID, upstreamTaskID, "channel", "seedance-contents-v1", "seedance-1-5-pro", 1, "seedance-1-5-pro", `{"id":"`+upstreamTaskID+`"}`, "headers", 12, now); err == nil {
		t.Fatal("accepted transition unexpectedly succeeded with conflicting ownership")
	}

	stored, err := GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusRunning || stored.UpstreamTaskID != "" {
		t.Fatalf("stored task = %#v, err = %v", stored, err)
	}
	storedPayload, err := GetGenerationPayloadByTaskID(task.ID)
	if err != nil || storedPayload.ResponseBody != "" || storedPayload.ResponseHeaders != "" {
		t.Fatalf("payload = %#v, err = %v", storedPayload, err)
	}
	events, err := ListGenerationTaskEvents(task.ID)
	if err != nil || len(events) != 0 {
		t.Fatalf("events = %#v, err = %v", events, err)
	}
}
