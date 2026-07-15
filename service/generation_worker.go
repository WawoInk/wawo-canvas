package service

import (
	"context"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const generationWorkerLease = time.Minute

func processGenerationTask(ctx context.Context, taskID, owner string) bool {
	task, ok, err := repository.ClaimGenerationTaskByID(taskID, owner, time.Now().UTC(), generationWorkerLease)
	if err != nil {
		log.Printf("generation worker claim failed: task=%s err=%v", taskID, err)
		return false
	}
	if !ok {
		return false
	}
	profile, ok := findGenerationProfile(generationProfiles(), task.ModelProfileID)
	if !ok {
		_ = repository.UpdateGenerationTask(task.ID, map[string]any{"status": string(model.TaskStatusFailed), "error_code": "MODEL_CONFIGURATION_INVALID", "error_message": "generation profile is unavailable", "updated_at": time.Now().UTC().Format(time.RFC3339Nano)})
		return true
	}
	channel, err := generationRouteChannel(task.ChannelID, task.UpstreamModel)
	if err != nil {
		_ = repository.UpdateGenerationTask(task.ID, map[string]any{"status": string(model.TaskStatusFailed), "error_code": "MODEL_CONFIGURATION_INVALID", "error_message": err.Error(), "updated_at": time.Now().UTC().Format(time.RFC3339Nano)})
		return true
	}
	executeGeneration(ctx, task, profile, channel)
	return true
}
