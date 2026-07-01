package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

// ListCanvasProjects 查询用户的所有画布项目。
func ListCanvasProjects(userID string) ([]model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var projects []model.CanvasProject
	err = db.Where("user_id = ?", userID).Order("updated_at desc").Find(&projects).Error
	return projects, err
}

// GetCanvasProjectByID 根据 ID 查询画布项目。
func GetCanvasProjectByID(id string) (model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return model.CanvasProject{}, err
	}
	var project model.CanvasProject
	result := db.Where("id = ?", id).First(&project)
	return project, result.Error
}

// GetCanvasProjectByIDAndUser 根据 ID 和用户 ID 查询画布项目（所有权校验）。
func GetCanvasProjectByIDAndUser(id, userID string) (model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return model.CanvasProject{}, err
	}
	var project model.CanvasProject
	result := db.Where("id = ? AND user_id = ?", id, userID).First(&project)
	return project, result.Error
}

// CreateCanvasProject 创建画布项目。
func CreateCanvasProject(project model.CanvasProject) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&project).Error
}

// UpdateCanvasProject 更新画布项目（版本递增）。
func UpdateCanvasProject(id, userID string, projectJSON string, version int) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{
			"project_json": projectJSON,
			"version":      version,
		}).Error
}

// DeleteCanvasProject 删除画布项目（需校验所有权）。
func DeleteCanvasProject(id, userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.CanvasProject{}).Error
}
