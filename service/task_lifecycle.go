package service

import (
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

// ── Task lifecycle logging ─────────────────────────────────────────
// Called from ai_proxy.go (the proxy), not from the REST handler.
// All persistence goes through the repository seam — no raw GORM.

// StartCompatibilityTask atomically creates and charges an asynchronous compatibility task.
func StartCompatibilityTask(user model.AuthUser, taskType model.TaskType, provider, modelName string, reqBody []byte, reqHeaders, source string, credits int, path string) (string, error) {
	id := "gentask-" + uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	task := model.GenerationTask{
		ID: id, UserID: user.ID, TaskType: taskType, Provider: provider, Model: modelName,
		Status: model.TaskStatusRunning, Source: source, Credits: credits, CreatedAt: now, UpdatedAt: now,
	}
	payload := model.GenerationPayload{ID: "genpayload-" + uuid.NewString(), RequestHeaders: reqHeaders, RequestBody: string(reqBody), CreatedAt: now}
	if err := repository.CreateGenerationTaskWithCharge(task, payload, user.ID, modelName, path, credits); err != nil {
		return id, err
	}
	return id, nil
}

// LogTaskStart 创建任务记录（status=running）并保存 Payload，返回 taskID。
func LogTaskStart(user model.AuthUser, taskType model.TaskType, provider string,
	modelName string, reqBody []byte, reqHeaders string,
	source string, metadata string) (string, error) {
	id := "gentask-" + uuid.NewString()
	now := time.Now().Format(time.RFC3339)

	task := model.GenerationTask{
		ID:        id,
		UserID:    user.ID,
		TaskType:  taskType,
		Provider:  provider,
		Model:     modelName,
		Status:    model.TaskStatusRunning,
		Source:    source,
		Metadata:  metadata,
		CreatedAt: now,
		UpdatedAt: now,
	}

	payload := model.GenerationPayload{
		ID:             "genpayload-" + uuid.NewString(),
		RequestHeaders: reqHeaders,
		RequestBody:    string(reqBody),
		CreatedAt:      now,
	}

	if err := repository.CreateGenerationTask(task, payload); err != nil {
		log.Printf("generation task: create failed: user=%s type=%s model=%s err=%v", user.ID, taskType, modelName, err)
		return id, err
	}
	return id, nil
}

// LogTaskCreated 更新任务的上游 task ID（异步任务创建成功后，状态仍为 running）。
func LogTaskCreated(taskID string, upstreamTaskID string, latencyMs int64, credits int) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"upstream_task_id": upstreamTaskID,
		"credits":          credits,
		"latency_ms":       latencyMs,
		"updated_at":       now,
	}
	if err := repository.UpdateGenerationTask(taskID, updates); err != nil {
		log.Printf("generation task: update created failed: task=%s err=%v", taskID, err)
	}
}

// LogTaskSuccess 更新任务为成功状态，同时保存响应数据到 Payload。
func LogTaskSuccess(taskID string, respBody []byte, respHeaders string, latencyMs int64, credits int, upstreamTaskID string) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"status":     string(model.TaskStatusSuccess),
		"credits":    credits,
		"latency_ms": latencyMs,
		"updated_at": now,
	}
	if upstreamTaskID != "" {
		updates["upstream_task_id"] = upstreamTaskID
	}
	if err := repository.UpdateGenerationTask(taskID, updates); err != nil {
		log.Printf("generation task: update success failed: task=%s err=%v", taskID, err)
	}

	if respBody != nil {
		if err := repository.UpdateGenerationPayloadResponseBody(taskID, string(respBody)); err != nil {
			log.Printf("generation task: update payload response body failed: task=%s err=%v", taskID, err)
		}
	}
}

// LogTaskFailure 更新任务为失败状态。
func LogTaskFailure(taskID string, errCode string, errMsg string, rawError string, latencyMs int64, credits int) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"status":        string(model.TaskStatusFailed),
		"credits":       credits,
		"latency_ms":    latencyMs,
		"error_code":    errCode,
		"error_message": errMsg,
		"updated_at":    now,
	}
	if err := repository.UpdateGenerationTask(taskID, updates); err != nil {
		log.Printf("generation task: update failure failed: task=%s err=%v", taskID, err)
	}

	if rawError != "" {
		if err := repository.UpdateGenerationPayloadRawError(taskID, rawError); err != nil {
			log.Printf("generation task: update payload raw error failed: task=%s err=%v", taskID, err)
		}
	}
}

// LogTaskCancelled 更新任务为已取消状态。
func LogTaskCancelled(taskID string) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"status":     string(model.TaskStatusCancelled),
		"updated_at": now,
	}
	if err := repository.UpdateGenerationTask(taskID, updates); err != nil {
		log.Printf("generation task: update cancelled failed: task=%s err=%v", taskID, err)
	}
}
