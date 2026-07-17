package service

import (
	"context"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const generationWorkerLease = time.Minute

func StartGenerationWorker() {
	owner := repository.NewWorkerID()
	go func() {
		for {
			task, ok, err := repository.ClaimGenerationTask(owner, time.Now().UTC(), generationWorkerLease)
			if err != nil {
				log.Printf("generation worker scan failed: %v", err)
			} else if ok {
				go processClaimedGenerationTask(context.Background(), task, owner)
				continue
			}
			time.Sleep(time.Second)
		}
	}()
}

func processGenerationTask(ctx context.Context, taskID, owner string) bool {
	task, ok, err := repository.ClaimGenerationTaskByID(taskID, owner, time.Now().UTC(), generationWorkerLease)
	if err != nil {
		log.Printf("generation worker claim failed: task=%s err=%v", taskID, err)
		return false
	}
	if !ok {
		return false
	}
	processClaimedGenerationTask(ctx, task, owner)
	return true
}

func processClaimedGenerationTask(ctx context.Context, task model.GenerationTask, owner string) {
	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		ticker := time.NewTicker(generationWorkerLease / 2)
		defer ticker.Stop()
		for {
			select {
			case <-leaseCtx.Done():
				return
			case now := <-ticker.C:
				ok, err := repository.RenewGenerationTaskLease(task.ID, owner, now.UTC(), generationWorkerLease)
				if err != nil || !ok {
					cancel()
					return
				}
			}
		}
	}()
	profile, ok := generationProfileForTask(task)
	if !ok {
		_ = arbitrateGenerationTerminalFrom(task, task.UpstreamModel, ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "MODEL_CONFIGURATION_INVALID", Message: "generation profile is unavailable", Retryable: false}}, "worker", "", task.CommandVersion > 0, []model.TaskStatus{model.TaskStatusRunning})
		return
	}
	channel, err := generationRouteChannel(task.ChannelID, profile.UpstreamModel)
	if err != nil {
		_ = arbitrateGenerationTerminalFrom(task, profile.UpstreamModel, ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "MODEL_CONFIGURATION_INVALID", Message: err.Error(), Retryable: false}}, "worker", "", task.CommandVersion > 0, []model.TaskStatus{model.TaskStatusRunning})
		return
	}
	if isAcceptedCompatibilityTask(task) {
		observeCompatibilityTask(leaseCtx, task, profile, channel)
		return
	}
	executeGeneration(leaseCtx, task, profile, channel)
}
