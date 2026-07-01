package handler

import (
	"net/http"
	"strings"

	"github.com/basketikun/infinite-canvas/service"
)

// CreateVideoTask POST /api/v1/contents/generations/tasks
func CreateVideoTask(w http.ResponseWriter, r *http.Request) {
	service.ProxyVideoTaskCreate(w, r)
}

// GetVideoTask GET /api/v1/contents/generations/tasks/:id
func GetVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	// 校验所有权
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if _, err := service.GetVideoTaskByTaskIDAndUser(strings.TrimSpace(id), user.ID); err != nil {
		Fail(w, "任务不存在或无权操作")
		return
	}
	service.ProxyAIGetRequest(w, r, "/contents/generations/tasks/"+id)
}

// CancelVideoTask DELETE /api/v1/contents/generations/tasks/:id
func CancelVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyVideoTaskDelete(w, r, "/contents/generations/tasks/"+id)
}

// RemixVideoTask POST /api/v1/contents/generations/tasks/:id/remix
func RemixVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	// 校验所有权
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if _, err := service.GetVideoTaskByTaskIDAndUser(strings.TrimSpace(id), user.ID); err != nil {
		Fail(w, "任务不存在或无权操作")
		return
	}
	service.ProxyVideoTaskRemix(w, r, "/contents/generations/tasks/"+id+"/remix")
}
