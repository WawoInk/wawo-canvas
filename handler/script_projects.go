package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
)

type createScriptProjectRequest struct {
	Title  string `json:"title"`
	Source string `json:"source"`
}

type updateScriptProjectRequest struct {
	Workspace        service.ScriptProjectWorkspaceInput `json:"workspace"`
	ExpectedRevision uint64                              `json:"expectedRevision"`
}

type renameScriptProjectRequest struct {
	Title            string `json:"title"`
	ExpectedRevision uint64 `json:"expectedRevision"`
}

func ListScriptProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	projects, err := service.ListScriptProjects(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func CreateScriptProject(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request createScriptProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	project, err := service.CreateScriptProject(r.Context(), user.ID, request.Title, request.Source)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

func GetScriptProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	project, err := service.GetScriptProject(r.Context(), id, user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

func UpdateScriptProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request updateScriptProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	project, err := service.UpdateScriptProject(r.Context(), id, user.ID, request.Workspace, request.ExpectedRevision)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			Conflict(w, "剧本项目已被其他会话修改", project)
			return
		}
		FailError(w, err)
		return
	}
	OK(w, project)
}

func RenameScriptProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request renameScriptProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	project, err := service.RenameScriptProject(r.Context(), id, user.ID, request.Title, request.ExpectedRevision)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			Conflict(w, "剧本项目已被其他会话修改", project)
			return
		}
		FailError(w, err)
		return
	}
	OK(w, project)
}

func DeleteScriptProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteScriptProject(r.Context(), id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"id": id, "deletedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}
