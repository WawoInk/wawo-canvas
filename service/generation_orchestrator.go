package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

var (
	generationProfiles     = GenerationProfiles
	generationChannel      = SelectModelChannel
	generationRouteChannel = SelectModelChannelByName
	generationCost         = ModelCost
	generationHTTPClient   = http.DefaultClient
	generationPollInterval = 5 * time.Second
	generationDispatch     = func(ctx context.Context, taskID string) {
		go processGenerationTask(ctx, taskID, repository.NewWorkerID())
	}
)

var (
	ErrInvalidGenerationCommand  = errors.New("生成命令无效")
	ErrGenerationCommandConflict = errors.New("请求 ID 已用于不同的生成命令")
)

func CreateGeneration(ctx context.Context, user model.AuthUser, command model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
	profile, ok := findGenerationProfile(generationProfiles(), command.ModelProfileID)
	if !ok || command.CommandVersion != 1 || strings.TrimSpace(command.ClientRequestID) == "" || command.Source == "" || command.Intent.Kind != model.IntentVideoGenerate || strings.TrimSpace(command.Intent.Prompt) == "" {
		return model.FirstPartyGenerationTask{}, ErrInvalidGenerationCommand
	}
	body, err := json.Marshal(command)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	hash := sha256.Sum256(body)
	commandHash := hex.EncodeToString(hash[:])
	if existing, found, err := repository.GetGenerationTaskByClientRequestID(user.ID, command.ClientRequestID); err != nil {
		return model.FirstPartyGenerationTask{}, err
	} else if found {
		if existing.CommandHash != commandHash {
			return model.FirstPartyGenerationTask{}, ErrGenerationCommandConflict
		}
		return firstPartyTask(existing), nil
	}
	channel, err := generationChannel(profile.UpstreamModel)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	credits, err := generationCost(profile.UpstreamModel)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	taskID := "gentask-" + uuid.NewString()
	task := model.GenerationTask{
		ID:               taskID,
		UserID:           user.ID,
		TaskType:         model.TaskTypeVideo,
		Source:           command.Source,
		Provider:         DetermineProvider(channel),
		Model:            profile.UpstreamModel,
		Status:           model.TaskStatusQueued,
		Credits:          credits,
		Metadata:         string(body),
		ClientRequestID:  command.ClientRequestID,
		CommandHash:      commandHash,
		CommandVersion:   command.CommandVersion,
		IntentKind:       string(command.Intent.Kind),
		ModelProfileID:   profile.ID,
		ProfileVersion:   profile.Version,
		AdapterKey:       profile.AdapterKey,
		ChannelID:        channel.Name,
		UpstreamModel:    profile.UpstreamModel,
		QueueAvailableAt: now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	payload := model.GenerationPayload{ID: "genpayload-" + uuid.NewString(), RequestBody: string(body), CreatedAt: now}
	if err := repository.CreateGenerationTaskWithCharge(task, payload, user.ID, profile.UpstreamModel, "/api/v1/generations", credits); err != nil {
		if existing, found, lookupErr := repository.GetGenerationTaskByClientRequestID(user.ID, command.ClientRequestID); lookupErr == nil && found {
			if existing.CommandHash == commandHash {
				return firstPartyTask(existing), nil
			}
			return model.FirstPartyGenerationTask{}, ErrGenerationCommandConflict
		}
		return model.FirstPartyGenerationTask{}, err
	}
	result := firstPartyTask(task)
	generationDispatch(context.WithoutCancel(ctx), task.ID)
	return result, nil
}

func GetGeneration(userID, taskID string) (model.FirstPartyGenerationTask, error) {
	task, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	return firstPartyTask(task), nil
}

func findGenerationProfile(profiles []model.GenerationProfile, id string) (model.GenerationProfile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return model.GenerationProfile{}, false
}

func firstPartyTask(task model.GenerationTask) model.FirstPartyGenerationTask {
	result := (*model.FirstPartyGenerationResult)(nil)
	if task.ResultJSON != "" {
		var value model.FirstPartyGenerationResult
		if json.Unmarshal([]byte(task.ResultJSON), &value) == nil {
			result = &value
		}
	}
	return model.FirstPartyGenerationTask{
		ID:             task.ID,
		Status:         publicTaskStatus(task.Status),
		ModelProfileID: task.ModelProfileID,
		IntentKind:     model.GenerationIntentKind(task.IntentKind),
		Result:         result,
		ErrorCode:      task.ErrorCode,
		ErrorMessage:   task.ErrorMessage,
		CreatedAt:      task.CreatedAt,
	}
}

func publicTaskStatus(status model.TaskStatus) model.TaskStatus {
	if status == model.TaskStatusSuccess {
		return model.TaskStatusSucceeded
	}
	return status
}

func executeGeneration(ctx context.Context, task model.GenerationTask, profile model.GenerationProfile, channel model.ModelChannel) {
	adapter := NewSeedanceContentsV1Adapter(generationHTTPClient)
	ref, err := adapter.Create(ctx, AdapterCreateRequest{Profile: profile, Channel: channel, Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: promptFromTask(task)}})
	if err != nil {
		_ = repository.RefundGenerationTaskOnce(task, profile.UpstreamModel, "/api/v1/generations")
		_ = repository.UpdateGenerationTask(task.ID, map[string]any{"status": string(model.TaskStatusFailed), "error_code": "UPSTREAM_REJECTED", "error_message": err.Error(), "updated_at": time.Now().UTC().Format(time.RFC3339)})
		return
	}
	_ = repository.UpdateGenerationTask(task.ID, map[string]any{"status": string(ref.Status), "upstream_task_id": ref.ID, "result_json": resultJSON(ref), "updated_at": time.Now().UTC().Format(time.RFC3339)})
	for ref.Status != model.TaskStatusSucceeded && ref.Status != model.TaskStatusFailed && ref.Status != model.TaskStatusCancelled {
		select {
		case <-ctx.Done():
			return
		case <-time.After(generationPollInterval):
		}
		ref, err = adapter.Poll(ctx, channel, ref.ID)
		if err != nil {
			log.Printf("first-party generation poll failed: task=%s err=%v", task.ID, err)
			continue
		}
		_ = repository.UpdateGenerationTask(task.ID, map[string]any{"status": string(ref.Status), "result_json": resultJSON(ref), "updated_at": time.Now().UTC().Format(time.RFC3339)})
	}
}

func promptFromTask(task model.GenerationTask) string {
	var command model.GenerationCommand
	if err := json.Unmarshal([]byte(task.Metadata), &command); err != nil {
		return ""
	}
	return command.Intent.Prompt
}

func resultJSON(ref ProviderTaskRef) string {
	if ref.VideoURL == "" {
		return ""
	}
	body, _ := json.Marshal(map[string]string{"videoUrl": ref.VideoURL})
	return string(body)
}
