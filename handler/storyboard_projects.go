package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

func ListStoryboardProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	projects, err := service.ListStoryboardProjects(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func CreateStoryboardProject(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var input service.CreateStoryboardProjectInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	project, err := service.CreateStoryboardProject(r.Context(), user.ID, input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

func GetStoryboardProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	project, err := service.GetStoryboardProject(r.Context(), id, user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

func DeleteStoryboardProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteStoryboardProject(r.Context(), id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"id": id, "deletedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}
