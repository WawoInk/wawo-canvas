package service

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func compatibilityProfileForModel(modelName string) (model.GenerationProfile, bool) {
	for _, profile := range generationProfiles() {
		if profile.UpstreamModel == modelName {
			return profile, true
		}
	}
	return model.GenerationProfile{}, false
}

func isAcceptedCompatibilityTask(task model.GenerationTask) bool {
	return task.CommandVersion == 0 && task.UpstreamTaskID != "" && task.AdapterKey != ""
}

func observeCompatibilityTask(ctx context.Context, task model.GenerationTask, profile model.GenerationProfile, channel model.ModelChannel) {
	adapter, ok := generationAdapterFor(task.AdapterKey)
	if !ok {
		_ = arbitrateGenerationTerminalFrom(task, profile.UpstreamModel, ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "MODEL_CONFIGURATION_INVALID", Message: "generation adapter is unavailable", Retryable: false}}, "worker", "", false, []model.TaskStatus{model.TaskStatusRunning})
		return
	}
	deadline := time.Now().Add(generationTaskTimeout)
	if createdAt, err := time.Parse(time.RFC3339Nano, task.CreatedAt); err == nil {
		deadline = createdAt.Add(generationTaskTimeout)
	} else if createdAt, err = time.Parse(time.RFC3339, task.CreatedAt); err == nil {
		deadline = createdAt.Add(generationTaskTimeout)
	}
	attempt := 0
	for {
		stored, err := repository.GetGenerationTaskByID(task.ID)
		if err == nil && isTerminalGenerationStatus(stored.Status) {
			return
		}
		if !time.Now().Before(deadline) {
			_ = arbitrateGenerationTerminalFrom(task, profile.UpstreamModel, ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "TASK_SYNC_TIMEOUT", Message: "任务状态同步超时", Retryable: false}}, "timeout", "", false, []model.TaskStatus{model.TaskStatusRunning})
			return
		}
		ref, err := adapter.Poll(ctx, channel, task.UpstreamTaskID)
		persistGenerationAudit(task.ID, ref.Audit)
		if err != nil {
			log.Printf("compatibility generation poll failed: task=%s err=%v", task.ID, err)
			_ = appendGenerationTaskEvent(task.ID, "retry", sanitizeGenerationAuditJSON(fmt.Sprintf("%q", err.Error())))
		} else if isTerminalGenerationStatus(ref.Status) {
			_ = arbitrateGenerationTerminalFrom(task, profile.UpstreamModel, ref, "poll", "", false, []model.TaskStatus{model.TaskStatusRunning})
			return
		} else {
			_ = updateGenerationProgress(task.ID, ref.Status, "poll")
		}
		attempt++
		_ = appendGenerationTaskEvent(task.ID, "poll", fmt.Sprint(attempt))
		select {
		case <-ctx.Done():
			return
		case <-time.After(generationPollInterval):
		}
	}
}
