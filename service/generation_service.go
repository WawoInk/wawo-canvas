package service

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

// DetermineTaskType 根据 API 路径推断任务类型。
func DetermineTaskType(path string) model.TaskType {
	switch {
	case strings.HasPrefix(path, "/images/"), strings.HasPrefix(path, "/async/images/"):
		return model.TaskTypeImage
	case strings.HasPrefix(path, "/videos/"), strings.HasPrefix(path, "/contents/generations/tasks"):
		return model.TaskTypeVideo
	case strings.HasPrefix(path, "/audio/"):
		return model.TaskTypeAudio
	case strings.HasPrefix(path, "/chat/"):
		return model.TaskTypeChat
	default:
		return model.TaskTypeChat
	}
}

// DetermineProvider 根据渠道协议推断 Provider。
func DetermineProvider(channel model.ModelChannel) string {
	proto := strings.ToLower(strings.TrimSpace(channel.Protocol))
	switch proto {
	case "gemini":
		return "gemini"
	case "openai":
		return "openai"
	default:
		return proto
	}
}

// DetermineSource 根据请求头推断生成来源（优先 X-Source，fallback Referer/路径）。
func DetermineSource(r *http.Request) string {
	if src := r.Header.Get("X-Source"); src != "" {
		return src
	}
	referer := r.Referer()
	if strings.Contains(referer, "/canvas") {
		return string(model.SourceCanvas)
	}
	return DetermineSourceFromPath(r.URL.Path)
}

// DetermineSourceFromPath 根据 API 路径推断来源。
func DetermineSourceFromPath(path string) string {
	if strings.Contains(path, "/contents/generations/tasks") {
		return string(model.SourceVideoWorkbench)
	}
	if strings.Contains(path, "/images/") {
		return string(model.SourceImageWorkbench)
	}
	return ""
}

// ── Task lifecycle functions moved to task_lifecycle.go ─────────────
// LogTaskStart, LogTaskCreated, LogTaskSuccess, LogTaskFailure, LogTaskCancelled
// now live in task_lifecycle.go — same package, cleaner file boundaries.
// Callers in ai_proxy.go and task_sync.go are unaffected.

// UpdateTaskMetadata 业务层补充任务元数据（所有权校验，仅允许更新 metadata 字段）。
func UpdateTaskMetadata(taskID string, userID string, metadata string) error {
	_, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return err
	}
	if len(metadata) > 4096 {
		return fmt.Errorf("metadata too large: %d bytes (max 4096)", len(metadata))
	}
	return repository.UpdateGenerationTask(taskID, map[string]any{
		"metadata":   metadata,
		"updated_at": time.Now().Format(time.RFC3339),
	})
}

// ListUserTasks 获取用户的任务列表。
func ListUserTasks(ctx model.AuthUser, q model.GenerationTaskQuery) (model.GenerationTaskList, error) {
	q.UserID = ctx.ID
	tasks, total, err := repository.ListGenerationTasks(q)
	if err != nil {
		return model.GenerationTaskList{}, err
	}
	setGenerationTaskDisplayNames(tasks)
	return model.GenerationTaskList{Items: tasks, Total: total}, nil
}

// AdminGenerationTaskListWithUser 管理端任务列表（含用户名）。
type AdminGenerationTaskListWithUser struct {
	Items []repository.AdminGenerationTaskWithUser `json:"items"`
	Total int64                                    `json:"total"`
}

// AdminListTasksWithUsername 管理员查看所有用户的任务列表（含用户名）。
func AdminListTasksWithUsername(q model.GenerationTaskQuery) (*AdminGenerationTaskListWithUser, error) {
	tasks, total, err := repository.ListGenerationTasksWithUsername(q)
	if err != nil {
		return nil, err
	}
	public, _ := PublicSettings()
	for i := range tasks {
		tasks[i].ModelDisplayName = ResolveModelDisplayName(public, tasks[i].ModelProfileID, tasks[i].Model)
	}
	return &AdminGenerationTaskListWithUser{Items: tasks, Total: total}, nil
}

// AdminDeleteTask 管理员删除单条任务（无所有权校验），并记录删除日志。
func AdminDeleteTask(taskID string) error {
	if _, err := repository.AdminDeleteGenerationTasks([]string{taskID}); err != nil {
		return err
	}
	// admin 删除不记 userID（记空）
	_ = repository.RecordDeletion("generation_tasks", taskID, "", time.Now())
	return nil
}

// AdminBatchDeleteTasks 管理员批量删除任务，并记录删除日志。
func AdminBatchDeleteTasks(ids []string) (int64, error) {
	count, err := repository.AdminDeleteGenerationTasks(ids)
	if err != nil {
		return count, err
	}
	now := time.Now()
	for _, id := range ids {
		_ = repository.RecordDeletion("generation_tasks", id, "", now)
	}
	return count, nil
}

// AdminListTasks 管理员查看所有用户的任务列表（无用户过滤）。
func AdminListTasks(q model.GenerationTaskQuery) (model.GenerationTaskList, error) {
	tasks, total, err := repository.ListGenerationTasks(q)
	if err != nil {
		return model.GenerationTaskList{}, err
	}
	setGenerationTaskDisplayNames(tasks)
	return model.GenerationTaskList{Items: tasks, Total: total}, nil
}

// RecordUserTask 记录一个同步生成任务（如图片生成）。创建任务并立即设为成功状态，保存请求和响应。
func RecordUserTask(user model.AuthUser, taskType model.TaskType, source string, provider string, modelName string,
	status model.TaskStatus, credits int, latencyMs int64, upstreamTaskID string, reqBody string, respBody string, errorMessage string) (*model.GenerationTask, error) {

	now := time.Now().Format(time.RFC3339)

	// Upsert by (userID, upstreamTaskID): if a task with the same upstream id already
	// exists for this user, update its status/result instead of inserting a duplicate.
	// This is what stops a single video generation (pending → poll success/failure) from
	// creating one row per saveLog call. When upstreamTaskID is empty (synchronous image
	// generation), fall back to insert — the image page threads the returned id back as
	// the dedupe key on its final saveLog.
	if upstreamTaskID != "" {
		if existing, err := repository.GetGenerationTaskByUpstreamTaskIDAndUser(upstreamTaskID, user.ID); err == nil {
			updates := map[string]any{
				"status":     status,
				"latency_ms": latencyMs,
				"updated_at": now,
			}
			if errorMessage != "" {
				updates["error_message"] = errorMessage
			}
			if err := repository.UpdateGenerationTask(existing.ID, updates); err != nil {
				return nil, err
			}
			if respBody != "" {
				_ = repository.UpdateGenerationPayload(existing.ID, respBody, "")
			}
			existing.Status = status
			existing.LatencyMs = latencyMs
			existing.ErrorMessage = errorMessage
			existing.UpdatedAt = now
			existing.ModelDisplayName = DisplayModelName(existing.ModelProfileID, existing.Model)
			return &existing, nil
		}
	}

	id := "gentask-" + uuid.NewString()
	task := model.GenerationTask{
		ID:               id,
		UserID:           user.ID,
		TaskType:         taskType,
		Source:           source,
		Provider:         provider,
		Model:            modelName,
		ModelDisplayName: DisplayModelName(modelName),
		Status:           status,
		Credits:          credits,
		LatencyMs:        latencyMs,
		UpstreamTaskID:   upstreamTaskID,
		ErrorMessage:     errorMessage,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	payload := model.GenerationPayload{
		ID:             "genpayload-" + uuid.NewString(),
		RequestBody:    reqBody,
		ResponseBody:   respBody,
		RequestHeaders: "{}",
		CreatedAt:      now,
	}

	if err := repository.CreateGenerationTask(task, payload); err != nil {
		log.Printf("generation task: record failed: user=%s type=%s model=%s err=%v", user.ID, taskType, modelName, err)
		return nil, err
	}
	return &task, nil
}

// DeleteUserTask 删除用户的任务（含 Payload 级联），并记录删除日志。
func DeleteUserTask(taskID string, userID string) error {
	if err := repository.DeleteGenerationTask(taskID, userID); err != nil {
		return err
	}
	_ = repository.RecordDeletion("generation_tasks", taskID, userID, time.Now())
	return nil
}

// GetTaskPayload 根据 taskID 获取 Payload（nil-safe）。
func GetTaskPayload(taskID string) (*model.GenerationPayload, error) {
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if err != nil {
		return nil, nil
	}
	return &payload, nil
}

// GetTaskDetail 获取任务详情（可选包含 Payload）。
func GetTaskDetail(taskID string, includePayload bool) (model.GenerationTask, *model.GenerationPayload, error) {
	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil {
		return model.GenerationTask{}, nil, err
	}
	setGenerationTaskDisplayName(&task)
	if !includePayload {
		return task, nil, nil
	}
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if err != nil {
		return task, nil, nil // Payload 不存在不报错
	}
	return task, &payload, nil
}

// GetUserTaskDetail 获取用户的任务详情（含所有权校验）。
func GetUserTaskDetail(taskID string, userID string, includePayload bool) (model.GenerationTask, *model.GenerationPayload, error) {
	task, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return model.GenerationTask{}, nil, err
	}
	setGenerationTaskDisplayName(&task)
	if !includePayload {
		return task, nil, nil
	}
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if err != nil {
		return task, nil, nil
	}
	return task, &payload, nil
}

// AdminGetTaskDetail 管理员查看任务详情（无用户过滤，可含 Payload）。
func AdminGetTaskDetail(taskID string, includePayload bool) (model.GenerationTask, *model.GenerationPayload, error) {
	task, err := repository.GetGenerationTaskByID(taskID)
	if err != nil {
		return model.GenerationTask{}, nil, err
	}
	setGenerationTaskDisplayName(&task)
	if !includePayload {
		return task, nil, nil
	}
	payload, err := repository.GetGenerationPayloadByTaskID(taskID)
	if err != nil {
		return task, nil, nil
	}
	return task, &payload, nil
}

func setGenerationTaskDisplayNames(tasks []model.GenerationTask) {
	public, _ := PublicSettings()
	for i := range tasks {
		tasks[i].ModelDisplayName = ResolveModelDisplayName(public, tasks[i].ModelProfileID, tasks[i].Model)
	}
}

func setGenerationTaskDisplayName(task *model.GenerationTask) {
	public, _ := PublicSettings()
	task.ModelDisplayName = ResolveModelDisplayName(public, task.ModelProfileID, task.Model)
}

// SerializeHeaders 将 http.Header 序列化为 JSON 字符串（用于 Payload 存储）。
func SerializeHeaders(headers map[string][]string) string {
	data, err := json.Marshal(headers)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// ExtractUpstreamTaskID 从响应 body 中尝试提取上游任务 ID。
// 后端 wrapper 返回 {code:0, data:{id:"..."}}；直接上游返回 {id:"..."}。
func ExtractUpstreamTaskID(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	// 优先尝试 {code:0, data:{id:"..."}} 格式（后端 wrapper）
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Code == 0 && envelope.Data.ID != "" {
		return envelope.Data.ID
	}
	// 尝试 {id:"..."} 格式（直接上游响应）
	var direct struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &direct); err == nil && direct.ID != "" {
		return direct.ID
	}
	// 尝试 {data:{id:"..."}} 格式
	var nested struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &nested); err == nil && nested.Data.ID != "" {
		return nested.Data.ID
	}
	return ""
}
