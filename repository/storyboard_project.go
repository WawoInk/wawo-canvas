package repository

import (
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListStoryboardProjects(userID string) ([]model.StoryboardProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var projects []model.StoryboardProject
	err = db.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Find(&projects).Error
	return projects, err
}

func GetStoryboardProject(id, userID string) (model.StoryboardProject, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardProject{}, err
	}
	var project model.StoryboardProject
	err = db.Where("id = ? AND user_id = ?", id, userID).First(&project).Error
	return project, err
}

func CreateStoryboardProject(project model.StoryboardProject, file model.UserFile) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&file).Error; err != nil {
			return err
		}
		return tx.Create(&project).Error
	})
}

func UpdateStoryboardProjectCAS(project model.StoryboardProject, expectedRevision uint64, newFile *model.UserFile, oldFileID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if newFile != nil {
			if err := tx.Create(newFile).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&model.StoryboardProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(map[string]any{
				"title": project.Title, "source": project.Source, "options_json": project.OptionsJSON, "model": project.Model, "source_hash": project.SourceHash,
				"status": project.Status, "validation_status": project.ValidationStatus, "scene_count": project.SceneCount, "shot_count": project.ShotCount,
				"artifact_file_id": project.ArtifactFileID, "artifact_hash": project.ArtifactHash, "revision": gorm.Expr("revision + 1"), "updated_at": project.UpdatedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrConflict
		}
		if newFile != nil && oldFileID != "" && oldFileID != newFile.ID {
			return tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", oldFileID, project.UserID).Delete(&model.UserFile{}).Error
		}
		return nil
	})
}

func StoryboardProjectReferencesFile(fileID string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var count int64
	err = db.Model(&model.StoryboardProject{}).Where("artifact_file_id = ?", fileID).Count(&count).Error
	return count > 0, err
}

func DeleteStoryboardProject(id, userID string) (model.StoryboardProject, model.UserFile, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardProject{}, model.UserFile{}, err
	}
	var project model.StoryboardProject
	var file model.UserFile
	err = db.Transaction(func(tx *gorm.DB) error {
		var err error
		project, err = lockStoryboardProject(tx, id, userID)
		if err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", project.ArtifactFileID, userID).First(&file).Error; err != nil {
			return err
		}
		if err := lockStoryboardBrainstormConversations(tx, id, userID); err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", id, userID).Delete(&model.StoryboardBrainstormMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", id, userID).Delete(&model.StoryboardBrainstormConversation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", id, userID).Delete(&model.StoryboardMemory{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.StoryboardProject{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", file.ID, userID).Delete(&model.UserFile{}).Error
	})
	return project, file, err
}
