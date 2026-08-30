package repository

import (
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListScriptProjects(userID string) ([]model.ScriptProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var projects []model.ScriptProject
	err = db.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Find(&projects).Error
	return projects, err
}

func GetScriptProject(id, userID string) (model.ScriptProject, error) {
	db, err := DB()
	if err != nil {
		return model.ScriptProject{}, err
	}
	var project model.ScriptProject
	err = db.Where("id = ? AND user_id = ?", id, userID).First(&project).Error
	return project, err
}

func GetScriptProjectConversations(projectID, userID string) ([]model.ScriptConversation, []model.ScriptMessage, error) {
	db, err := DB()
	if err != nil {
		return nil, nil, err
	}
	var conversations []model.ScriptConversation
	if err := db.Where("project_id = ? AND user_id = ?", projectID, userID).Order("position ASC").Find(&conversations).Error; err != nil {
		return nil, nil, err
	}
	var messages []model.ScriptMessage
	if err := db.Where("project_id = ? AND user_id = ?", projectID, userID).Order("conversation_id ASC, position ASC").Find(&messages).Error; err != nil {
		return nil, nil, err
	}
	return conversations, messages, nil
}

func CreateScriptProject(project model.ScriptProject, file model.UserFile, conversations []model.ScriptConversation, messages []model.ScriptMessage) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&file).Error; err != nil {
			return err
		}
		if err := tx.Create(&project).Error; err != nil {
			return err
		}
		if len(conversations) > 0 {
			if err := tx.Create(&conversations).Error; err != nil {
				return err
			}
		}
		if len(messages) > 0 {
			return tx.Create(&messages).Error
		}
		return nil
	})
}

func UpdateScriptProjectWithLock(project model.ScriptProject, expectedRevision uint64, newFile *model.UserFile, oldFileID string, conversations []model.ScriptConversation, messages []model.ScriptMessage) error {
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
		result := tx.Model(&model.ScriptProject{}).
			Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expectedRevision).
			Updates(map[string]any{
				"title":                  project.Title,
				"source":                 project.Source,
				"current_stage":          project.CurrentStage,
				"project_config_json":    project.ProjectConfigJSON,
				"config_draft_json":      project.ConfigDraftJSON,
				"story_skeleton_status":  project.StorySkeletonStatus,
				"adaptation_status":      project.AdaptationStatus,
				"active_conversation_id": project.ActiveConversationID,
				"version":                project.Version,
				"artifact_file_id":       project.ArtifactFileID,
				"artifact_hash":          project.ArtifactHash,
				"revision":               gorm.Expr("revision + 1"),
				"updated_at":             project.UpdatedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrConflict
		}
		if err := tx.Where("project_id = ? AND user_id = ?", project.ID, project.UserID).Delete(&model.ScriptMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", project.ID, project.UserID).Delete(&model.ScriptConversation{}).Error; err != nil {
			return err
		}
		if len(conversations) > 0 {
			if err := tx.Create(&conversations).Error; err != nil {
				return err
			}
		}
		if len(messages) > 0 {
			if err := tx.Create(&messages).Error; err != nil {
				return err
			}
		}
		if newFile != nil && oldFileID != "" && oldFileID != newFile.ID {
			return tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", oldFileID, project.UserID).Delete(&model.UserFile{}).Error
		}
		return nil
	})
}

func RenameScriptProjectWithLock(id, userID, title string, expectedRevision uint64, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	result := db.Model(&model.ScriptProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", id, userID, expectedRevision).
		Updates(map[string]any{"title": title, "revision": gorm.Expr("revision + 1"), "updated_at": updatedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

func DeleteScriptProject(id, userID string) (model.ScriptProject, model.UserFile, error) {
	db, err := DB()
	if err != nil {
		return model.ScriptProject{}, model.UserFile{}, err
	}
	var project model.ScriptProject
	var file model.UserFile
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&project).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", project.ArtifactFileID, userID).First(&file).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", id, userID).Delete(&model.ScriptMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND user_id = ?", id, userID).Delete(&model.ScriptConversation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.ScriptProject{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", file.ID, userID).Delete(&model.UserFile{}).Error
	})
	return project, file, err
}
