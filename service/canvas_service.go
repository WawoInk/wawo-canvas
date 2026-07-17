package service

import (
	"encoding/json"
	"errors"
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
// frontendID 为前端生成的 ID，若非空则用于数据库记录 ID，保持前后端 ID 一致。
func CreateCanvasProject(userID string, frontendID string, name string, projectJSON string) (model.CanvasProject, error) {
	id := frontendID
	if id == "" {
		id = "canvas-" + uuid.NewString()
	}
	now := time.Now().Format(time.RFC3339)
	project := model.CanvasProject{
		ID:          id,
		UserID:      userID,
		Name:        name,
		ProjectJSON: projectJSON,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := repository.CreateCanvasProject(&project); err != nil {
		return model.CanvasProject{}, err
	}
	return project, nil
}

// UpdateCanvasProject 全量更新画布项目（revision 乐观锁）。
func UpdateCanvasProject(id string, userID string, projectJSON string, expectedRevision uint64) (model.CanvasProject, error) {
	existing, err := repository.GetCanvasProjectByIDAndUser(id, userID)
	if err != nil {
		return model.CanvasProject{}, err
	}
	now := time.Now().Format(time.RFC3339)
	if err := repository.UpdateCanvasProjectWithLock(id, userID, projectJSON, expectedRevision, now); err != nil {
		if errors.Is(err, repository.ErrConflict) {
			current, readErr := repository.GetCanvasProjectByIDAndUser(id, userID)
			if readErr == nil {
				return current, err
			}
		}
		return existing, err
	}
	return repository.GetCanvasProjectByIDAndUser(id, userID)
}

// DeleteCanvasProject 删除画布项目并在同一事务中记录 tombstone。
func DeleteCanvasProject(id string, userID string) error {
	return repository.DeleteCanvasProject(id, userID, time.Now())
}

// GetCanvasProject 根据 ID 和用户 ID 查询画布项目（含 projectJson，所有权校验）。
func GetCanvasProject(id, userID string) (model.CanvasProject, error) {
	return repository.GetCanvasProjectByIDAndUser(id, userID)
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
