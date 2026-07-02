package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

// ListGenerationTasks GET /api/v1/generation-tasks
func ListGenerationTasks(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	taskType := model.TaskType(strings.TrimSpace(q.Get("task_type")))
	status := model.TaskStatus(strings.TrimSpace(q.Get("status")))

	query := model.GenerationTaskQuery{
		TaskType:  taskType,
		Status:    status,
		StartTime: q.Get("start_time"),
		EndTime:   q.Get("end_time"),
		Page:      page,
		PageSize:  pageSize,
	}

	result, err := service.ListUserTasks(user, query)
	if err != nil {
		FailError(w, err)
		return
	}

	// Convert to DTO based on task_type
	if taskType == model.TaskTypeVideo {
		items := make([]service.VideoHistoryDTO, 0, len(result.Items))
		for _, t := range result.Items {
			payload, _ := service.GetTaskPayload(t.ID)
			items = append(items, service.ToVideoHistoryDTO(t, payload))
		}
		OK(w, map[string]any{"items": items, "total": result.Total})
		return
	}
	if taskType == model.TaskTypeImage {
		items := make([]service.ImageHistoryDTO, 0, len(result.Items))
		for _, t := range result.Items {
			payload, _ := service.GetTaskPayload(t.ID)
			items = append(items, service.ToImageHistoryDTO(t, payload))
		}
		OK(w, map[string]any{"items": items, "total": result.Total})
		return
	}

	OK(w, result)
}

// GetGenerationTaskDetail GET /api/v1/generation-tasks/:id
func GetGenerationTaskDetail(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	includePayload := r.URL.Query().Get("include_payload") == "true"
	task, payload, err := service.GetUserTaskDetail(id, user.ID, includePayload)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"task": task, "payload": payload})
}

// DeleteGenerationTask DELETE /api/v1/generation-tasks/:id — 用户删除自己的任务记录。
func DeleteGenerationTask(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteUserTask(id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// RecordGenerationTask POST /api/v1/generation-tasks — 前端同步生成任务记录到后端（用于图片等同步生成的场景）。
func RecordGenerationTask(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var payload struct {
		TaskType       string `json:"taskType"`
		Provider       string `json:"provider"`
		Model          string `json:"model"`
		Status         string `json:"status"`
		Credits        int    `json:"credits"`
		LatencyMs      int64  `json:"latencyMs"`
		UpstreamTaskID string `json:"upstreamTaskId"`
		RequestBody    string `json:"requestBody"`
		ResponseBody   string `json:"responseBody"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	task, err := service.RecordUserTask(user, model.TaskType(payload.TaskType), payload.Provider, payload.Model,
		model.TaskStatus(payload.Status), payload.Credits, payload.LatencyMs, payload.UpstreamTaskID, payload.RequestBody, payload.ResponseBody)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, task)
}

// UpdateGenerationTaskMetadata POST /api/v1/generation-tasks/:id/metadata — 业务层补充元数据。
func UpdateGenerationTaskMetadata(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Metadata string `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "参数格式错误")
		return
	}
	// 校验 metadata 是合法 JSON
	if body.Metadata != "" {
		var js json.RawMessage
		if err := json.Unmarshal([]byte(body.Metadata), &js); err != nil {
			Fail(w, "metadata 必须是合法的 JSON 字符串")
			return
		}
	}
	if err := service.UpdateTaskMetadata(id, user.ID, body.Metadata); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminGetGenerationTaskDetail GET /api/admin/generation-tasks/:id — 管理员查看任意任务详情（含 Payload）。
func AdminGetGenerationTaskDetail(w http.ResponseWriter, r *http.Request, id string) {
	includePayload := r.URL.Query().Get("include_payload") == "true"
	task, payload, err := service.AdminGetTaskDetail(id, includePayload)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"task": task, "payload": payload})
}

// AdminDeleteGenerationTask DELETE /api/admin/generation-tasks/:id — 管理员删除单条任务。
func AdminDeleteGenerationTask(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.AdminDeleteTask(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminBatchDeleteGenerationTasks POST /api/admin/generation-tasks/batch-delete — 管理员批量删除。
func AdminBatchDeleteGenerationTasks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Fail(w, "参数格式错误")
		return
	}
	if len(req.IDs) == 0 {
		Fail(w, "请选择要删除的记录")
		return
	}
	deleted, err := service.AdminBatchDeleteTasks(req.IDs)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"deleted": deleted})
}

// AdminListGenerationTasks GET /api/admin/generation-tasks — 管理员查看所有用户的任务列表。
func AdminListGenerationTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	query := model.GenerationTaskQuery{
		UserID:    strings.TrimSpace(q.Get("user_id")),
		TaskType:  model.TaskType(strings.TrimSpace(q.Get("task_type"))),
		Status:    model.TaskStatus(strings.TrimSpace(q.Get("status"))),
		StartTime: q.Get("start_time"),
		EndTime:   q.Get("end_time"),
		Page:      page,
		PageSize:  pageSize,
	}
	result, err := service.AdminListTasksWithUsername(query)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
