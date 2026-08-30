package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

type updateStoryboardProjectRequest struct {
	service.CreateStoryboardProjectInput
	ExpectedRevision *uint64 `json:"expectedRevision"`
}

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

func UpdateStoryboardProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var request updateStoryboardProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	if request.ExpectedRevision == nil {
		Fail(w, "expectedRevision 不能为空")
		return
	}
	project, err := service.UpdateStoryboardProject(r.Context(), id, user.ID, request.CreateStoryboardProjectInput, *request.ExpectedRevision)
	if err != nil {
		if service.IsStudioProjectConflict(err) {
			Conflict(w, "分镜项目已被其他会话修改", project)
			return
		}
		if service.IsStudioProjectNotFound(err) {
			NotFound(w, "项目不存在或无权操作")
			return
		}
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
		if service.IsStudioProjectNotFound(err) {
			NotFound(w, "项目不存在或无权操作")
			return
		}
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
		if service.IsStudioProjectNotFound(err) {
			NotFound(w, "项目不存在或无权操作")
			return
		}
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"id": id, "deletedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}
