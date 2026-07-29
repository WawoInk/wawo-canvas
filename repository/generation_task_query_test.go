package repository

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

func TestListGenerationTasksWithUsernameTreatsSuccessStatusesAsEquivalent(t *testing.T) {
	db, err := DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	userID := "generation-query-user-" + uuid.NewString()
	tasks := []model.GenerationTask{
		{ID: "generation-query-success-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusSuccess, CreatedAt: "2026-07-28T10:00:00Z", UpdatedAt: "2026-07-28T10:00:00Z"},
		{ID: "generation-query-succeeded-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusSucceeded, CreatedAt: "2026-07-28T11:00:00Z", UpdatedAt: "2026-07-28T11:00:00Z"},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatalf("create tasks: %v", err)
	}
	t.Cleanup(func() {
		db.Delete(&tasks)
	})

	got, total, err := ListGenerationTasksWithUsername(model.GenerationTaskQuery{
		UserID: userID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusSuccess, PageSize: 10,
	})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if total != 2 || len(got) != 2 {
		t.Fatalf("success filter returned %d/%d tasks, want 2/2", len(got), total)
	}
}
