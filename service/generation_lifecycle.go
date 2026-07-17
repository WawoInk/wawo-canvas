package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

type GenerationOperationError struct {
	Code    string
	Message string
}

func (err GenerationOperationError) Error() string       { return err.Message }
func (err GenerationOperationError) SafeMessage() string { return err.Message }
func (err GenerationOperationError) FailureData() any    { return map[string]any{"code": err.Code} }

var generationAdapterFor = func(key string) (GenerationAdapter, bool) {
	switch key {
	case "seedance-contents-v1":
		return NewSeedanceContentsV1Adapter(generationHTTPClient), true
	case "vidu-short-drama-v1":
		return NewViduShortDramaV1Adapter(generationHTTPClient), true
	default:
		return nil, false
	}
}

func profileCompletion(profile model.GenerationProfile, capability string) bool {
	for _, item := range profile.Capabilities.Completion {
		if item == capability {
			return true
		}
	}
	return false
}

func isTerminalGenerationStatus(status model.TaskStatus) bool {
	return status == model.TaskStatusSucceeded || status == model.TaskStatusSuccess || status == model.TaskStatusFailed || status == model.TaskStatusCancelled
}

func HandleGenerationCallback(ctx context.Context, token string, body []byte) error {
	if strings.TrimSpace(token) == "" {
		return GenerationOperationError{Code: "CALLBACK_UNAUTHORIZED", Message: "无效的回调令牌"}
	}
	taskID, err := repository.GetGenerationTaskByCallbackToken(token)
	if err != nil {
		return GenerationOperationError{Code: "CALLBACK_UNAUTHORIZED", Message: "无效的回调令牌"}
	}
	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil || subtle.ConstantTimeCompare([]byte(task.CallbackToken), []byte(token)) != 1 {
		return GenerationOperationError{Code: "CALLBACK_UNAUTHORIZED", Message: "无效的回调令牌"}
	}
	profile, ok := generationProfileForTask(task)
	if !ok || !profileCompletion(profile, "callback") {
		return GenerationOperationError{Code: "CALLBACK_UNSUPPORTED", Message: "该任务不支持回调"}
	}
	adapter, ok := generationAdapterFor(task.AdapterKey)
	if !ok {
		return GenerationOperationError{Code: "MODEL_CONFIGURATION_INVALID", Message: "生成模型配置不可用"}
	}
	ref, err := adapter.ParseCallback(ctx, body)
	if err != nil || ref.ID == "" || ref.ID != task.UpstreamTaskID {
		return GenerationOperationError{Code: "CALLBACK_INVALID", Message: "回调内容无效"}
	}
	persistGenerationAudit(task.ID, ref.Audit)
	_ = appendGenerationTaskEvent(task.ID, "callback", string(ref.Status))
	if isTerminalGenerationStatus(ref.Status) {
		return resolveGenerationTask(ctx, task, profile, ref, "callback")
	}
	return updateGenerationProgress(task.ID, ref.Status, "callback")
}

func CancelGeneration(ctx context.Context, userID, taskID string) (model.FirstPartyGenerationTask, error) {
	task, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	if isTerminalGenerationStatus(task.Status) {
		return firstPartyTask(task), nil
	}
	profile, ok := generationProfileForTask(task)
	if !ok {
		return model.FirstPartyGenerationTask{}, GenerationOperationError{Code: "MODEL_CONFIGURATION_INVALID", Message: "生成模型配置不可用"}
	}
	if !profile.Capabilities.Cancellation {
		_ = appendGenerationTaskEvent(task.ID, "cancel_request", "unsupported")
		return model.FirstPartyGenerationTask{}, GenerationOperationError{Code: "CANCEL_UNSUPPORTED", Message: "该模型不支持取消生成任务"}
	}
	adapter, ok := generationAdapterFor(task.AdapterKey)
	if !ok || task.UpstreamTaskID == "" {
		return model.FirstPartyGenerationTask{}, GenerationOperationError{Code: "CANCEL_UNAVAILABLE", Message: "任务暂时无法取消"}
	}
	channel, err := generationRouteChannel(task.ChannelID, profile.UpstreamModel)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	_ = appendGenerationTaskEvent(task.ID, "cancel_request", "requested")
	ref, err := adapter.Cancel(ctx, channel, task.UpstreamTaskID)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	if ref.ID == "" {
		ref.ID = task.UpstreamTaskID
	}
	if !isTerminalGenerationStatus(ref.Status) {
		return model.FirstPartyGenerationTask{}, GenerationOperationError{Code: "CANCEL_PENDING", Message: "上游尚未确认取消"}
	}
	if err := resolveGenerationTask(ctx, task, profile, ref, "cancel"); err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	return firstPartyTask(stored), err
}

func generationEvent(taskID, eventType, detail, createdAt string) model.GenerationTaskEvent {
	return model.GenerationTaskEvent{ID: "genevent-" + uuid.NewString(), TaskID: taskID, Type: eventType, Detail: detail, CreatedAt: createdAt}
}

func appendGenerationTaskEvent(taskID, eventType, detail string) error {
	return repository.SaveGenerationTaskEvent(generationEvent(taskID, eventType, detail, time.Now().UTC().Format(time.RFC3339Nano)))
}

func updateGenerationProgress(taskID string, status model.TaskStatus, source string) error {
	if status == "" || isTerminalGenerationStatus(status) {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	changed, err := repository.TransitionGenerationTask(taskID, []model.TaskStatus{model.TaskStatusRunning}, map[string]any{"status": string(model.TaskStatusRunning), "updated_at": now})
	if err != nil || !changed {
		return err
	}
	return repository.SaveGenerationTaskEvent(generationEvent(taskID, source, string(model.TaskStatusRunning), now))
}

func resolveGenerationTask(ctx context.Context, task model.GenerationTask, profile model.GenerationProfile, ref ProviderTaskRef, source string) error {
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || isTerminalGenerationStatus(stored.Status) {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if ref.Status == model.TaskStatusSucceeded && strings.TrimSpace(ref.VideoURL) == "" {
		ref.Status = model.TaskStatusFailed
		ref.Error = &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游未返回视频结果", Retryable: false}
	}
	updates := map[string]any{"status": string(ref.Status), "updated_at": now}
	from := []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}
	var creditLog *model.CreditLog
	if ref.Status == model.TaskStatusFailed {
		normalized := ref.Error
		if normalized == nil {
			normalized = &model.GenerationError{Code: "UPSTREAM_REJECTED", Message: "上游拒绝了生成请求", Retryable: false}
		}
		updates["error_code"], updates["error_message"], updates["error_retryable"] = normalized.Code, normalized.Message, normalized.Retryable
		creditLog = generationRefundLog(task, profile.UpstreamModel, now)
	} else if ref.Status == model.TaskStatusCancelled {
		creditLog = generationRefundLog(task, profile.UpstreamModel, now)
	} else if ref.Status == model.TaskStatusSucceeded {
		claimed, claimErr := repository.TransitionGenerationTask(task.ID, from, map[string]any{"status": string(model.TaskStatusPending), "updated_at": now})
		if claimErr != nil || !claimed {
			return claimErr
		}
		file, persistErr := generationPersistVideo(ctx, task.UserID, strings.TrimSpace(ref.VideoURL))
		if persistErr != nil {
			_ = repository.UpdateGenerationPayloadRawError(task.ID, sanitizeGenerationAuditJSON(fmt.Sprintf("%q", persistErr.Error())))
			_, releaseErr := repository.TransitionGenerationTask(task.ID, []model.TaskStatus{model.TaskStatusPending}, map[string]any{
				"status": string(model.TaskStatusRunning), "error_code": "RESULT_PERSIST_FAILED", "error_message": "生成结果暂时无法保存，请稍后重试", "error_retryable": true, "updated_at": now,
			})
			return releaseErr
		}
		result := model.FirstPartyGenerationResult{Kind: "video", File: model.GeneratedFile{FileID: file.ID, MimeType: file.MimeType, Bytes: file.Bytes}}
		if model.GenerationIntentKind(task.IntentKind) == model.IntentVideoShortDrama {
			result.Kind = "short-drama"
			for _, shot := range ref.Shots {
				result.Shots = append(result.Shots, model.GenerationShot{Index: shot.Index, DurationSeconds: shot.DurationSeconds, Status: shot.Status})
			}
		}
		body, _ := json.Marshal(result)
		updates["result_json"], updates["error_code"], updates["error_message"], updates["error_retryable"] = string(body), "", "", false
		from = []model.TaskStatus{model.TaskStatusPending}
	}
	event := generationEvent(task.ID, "terminal", source+":"+string(ref.Status), now)
	_, _, err = repository.TransitionGenerationTaskTerminal(task.ID, from, updates, creditLog, event)
	return err
}

func generationRefundLog(task model.GenerationTask, modelName, now string) *model.CreditLog {
	if task.Credits <= 0 {
		return nil
	}
	return &model.CreditLog{
		ID: "credit-" + uuid.NewString(), UserID: task.UserID, TaskID: task.ID, Type: model.CreditLogTypeAIRefund,
		Amount: task.Credits, Remark: "模型调用失败返还 " + modelName, Extra: `{"path":"/api/v1/generations"}`, CreatedAt: now,
	}
}

func timeoutGenerationTask(task model.GenerationTask, profile model.GenerationProfile) error {
	ref := ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "GENERATION_TIMEOUT", Message: "视频生成超时", Retryable: false}}
	_ = appendGenerationTaskEvent(task.ID, "timeout", "deadline exceeded")
	return resolveGenerationTask(context.Background(), task, profile, ref, "timeout")
}

func generationOperationCode(err error) string {
	var operationErr GenerationOperationError
	if errors.As(err, &operationErr) {
		return operationErr.Code
	}
	return ""
}
