package service

import (
	"encoding/json"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

// ListCanvasProjects 获取用户的所有画布项目。
func ListCanvasProjects(userID string) ([]model.CanvasProject, error) {
	return repository.ListCanvasProjects(userID)
}

// CreateCanvasProject 创建画布项目。
func CreateCanvasProject(userID string, name string, projectJSON string) (model.CanvasProject, error) {
	now := time.Now().Format(time.RFC3339)
	project := model.CanvasProject{
		ID:          "canvas-" + uuid.NewString(),
		UserID:      userID,
		Name:        name,
		ProjectJSON: projectJSON,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := repository.CreateCanvasProject(project); err != nil {
		return model.CanvasProject{}, err
	}
	return project, nil
}

// UpdateCanvasProject 全量更新画布项目（版本递增）。
func UpdateCanvasProject(id string, userID string, projectJSON string) (model.CanvasProject, error) {
	existing, err := repository.GetCanvasProjectByIDAndUser(id, userID)
	if err != nil {
		return model.CanvasProject{}, err
	}
	version := existing.Version + 1
	if err := repository.UpdateCanvasProject(id, userID, projectJSON, version); err != nil {
		return model.CanvasProject{}, err
	}
	existing.ProjectJSON = projectJSON
	existing.Version = version
	existing.UpdatedAt = time.Now().Format(time.RFC3339)
	return existing, nil
}

// DeleteCanvasProject 删除画布项目（校验所有权）。
func DeleteCanvasProject(id string, userID string) error {
	return repository.DeleteCanvasProject(id, userID)
}

// ParseProjectName 从 projectJSON 中提取 project name（用于 API 展示）。
func ParseProjectName(project model.CanvasProject) string {
	if project.Name != "" {
		return project.Name
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(project.ProjectJSON), &data); err != nil {
		return "Untitled"
	}
	if title, ok := data["title"].(string); ok && title != "" {
		return title
	}
	if name, ok := data["name"].(string); ok && name != "" {
		return name
	}
	return "Untitled"
}
