package repository

import (
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
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
func CreateCanvasProject(project *model.CanvasProject) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(project).Error
}

// UpdateCanvasProjectWithLock 使用 revision 乐观锁更新画布项目。
func UpdateCanvasProjectWithLock(id, userID, projectJSON string, expectedRevision uint64, newUpdatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	result := db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", id, userID, expectedRevision).
		Updates(map[string]any{
			"project_json": projectJSON,
			"version":      gorm.Expr("version + 1"),
			"revision":     gorm.Expr("nextval('canvas_revision_seq')"),
			"updated_at":   newUpdatedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

// DeleteCanvasProject deletes a canvas and records its tombstone atomically.
func DeleteCanvasProject(id, userID string, deletedAt time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var revision uint64
		if err := tx.Raw("SELECT nextval('canvas_revision_seq')").Scan(&revision).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.CanvasProject{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Create(&model.DeletedRecord{TableName: "canvas_projects", RecordID: id, UserID: userID, Revision: revision, DeletedAt: deletedAt}).Error
	})
}
