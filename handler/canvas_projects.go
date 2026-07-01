package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

type createCanvasProjectRequest struct {
	Name    string `json:"name"`
	Project any    `json:"project"`
}

type updateCanvasProjectRequest struct {
	Project any `json:"project"`
}

// ListCanvasProjects GET /api/v1/canvas/projects
func ListCanvasProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	projects, err := service.ListCanvasProjects(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	// 返回简化列表
	type item struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Version   int    `json:"version"`
		UpdatedAt string `json:"updatedAt"`
		CreatedAt string `json:"createdAt"`
	}
	items := make([]item, len(projects))
	for i, p := range projects {
		items[i] = item{
			ID:        p.ID,
			Name:      service.ParseProjectName(p),
			Version:   p.Version,
			UpdatedAt: p.UpdatedAt,
			CreatedAt: p.CreatedAt,
		}
	}
	OK(w, items)
}

// CreateCanvasProject POST /api/v1/canvas/projects
func CreateCanvasProject(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req createCanvasProjectRequest
	_ = json.Unmarshal(body, &req)

	projectJSON := string(body)
	// 如果 body 是完整的 project JSON（不是包装形式），直接用
	if req.Project != nil {
		pj, _ := json.Marshal(req.Project)
		projectJSON = string(pj)
	}

	name := req.Name
	if name == "" {
		name = "Untitled"
	}

	project, err := service.CreateCanvasProject(user.ID, name, projectJSON)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

// UpdateCanvasProject PUT /api/v1/canvas/projects/:id
func UpdateCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req updateCanvasProjectRequest
	_ = json.Unmarshal(body, &req)

	projectJSON := string(body)
	if req.Project != nil {
		pj, _ := json.Marshal(req.Project)
		projectJSON = string(pj)
	}

	project, err := service.UpdateCanvasProject(id, user.ID, projectJSON)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, project)
}

// DeleteCanvasProject DELETE /api/v1/canvas/projects/:id
func DeleteCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteCanvasProject(id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
