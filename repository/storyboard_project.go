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

func DeleteStoryboardProject(id, userID string) (model.StoryboardProject, model.UserFile, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardProject{}, model.UserFile{}, err
	}
	var project model.StoryboardProject
	var file model.UserFile
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&project).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", project.ArtifactFileID, userID).First(&file).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.StoryboardProject{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ? AND enterprise_id IS NULL", file.ID, userID).Delete(&model.UserFile{}).Error
	})
	return project, file, err
}
