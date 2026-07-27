package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
)

// HandleTaskCallback POST /api/v1/generation-tasks/callback — 厂商异步任务完成回调。
func HandleTaskCallback(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		Fail(w, "缺少回调令牌")
		return
	}

	// 查找匹配 callback_token 的任务
	// 注意：需要 repository 层提供按 callback_token 查询的能力
	genTaskID, err := repository.GetGenerationTaskByCallbackToken(token)
	if err != nil || genTaskID == "" {
		log.Printf("task_callback: invalid token: %s err=%v", token, err)
		Fail(w, "无效的回调令牌")
		return
	}

	var body struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Credits *int   `json:"credits"`
		Error   *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Content map[string]any `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "请求格式错误")
		return
	}

	status := model.TaskStatusRunning
	switch body.Status {
	case "succeeded":
		status = model.TaskStatusSuccess
	case "failed":
		status = model.TaskStatusFailed
	case "cancelled":
		status = model.TaskStatusCancelled
	default:
		status = model.TaskStatusRunning
	}

	respBody, _ := json.Marshal(body)
	result := service.TaskResult{
		Credits:      body.Credits,
		ResponseBody: string(respBody),
	}
	if body.Error != nil {
		result.ErrorCode = body.Error.Code
		result.ErrorMessage = body.Error.Message
	}

	service.OnTaskCompleted(genTaskID, status, result)
	service.CancelTaskSync(genTaskID)

	OK(w, true)
}
