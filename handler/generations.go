package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

var (
	createGeneration = func(ctx context.Context, user model.AuthUser, command model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
		return service.CreateGeneration(ctx, user, command)
	}
	listGenerationProfiles   = service.AvailableGenerationProfiles
	cancelGeneration         = service.CancelGeneration
	handleGenerationCallback = service.HandleGenerationCallback
)

func CreateGeneration(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var command model.GenerationCommand
	if err := json.NewDecoder(r.Body).Decode(&command); err != nil {
		Fail(w, "请求格式不正确")
		return
	}
	task, err := createGeneration(r.Context(), user, command)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, task)
}

func GetGeneration(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	task, err := service.GetGeneration(user.ID, id)
	if err != nil {
		Fail(w, "任务不存在或无权操作")
		return
	}
	OK(w, task)
}

func GetGenerationByClientRequestID(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	task, err := service.GetGenerationByClientRequestID(user.ID, id)
	if err != nil {
		Fail(w, "查询任务失败")
		return
	}
	OK(w, task)
}

func CancelGeneration(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	task, err := cancelGeneration(r.Context(), user.ID, id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, task)
}

func GenerationCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		Fail(w, "请求格式错误")
		return
	}
	if err := handleGenerationCallback(r.Context(), r.URL.Query().Get("token"), body); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func ModelProfiles(w http.ResponseWriter, r *http.Request) {
	if _, ok := service.UserFromContext(r.Context()); !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	profiles, err := listGenerationProfiles()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, profiles)
}
