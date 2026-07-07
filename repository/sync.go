package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

const syncLimit = 200

// ListUpdatedAssets returns assets updated after the cursor for the given user.
func ListUpdatedAssets(userID, cursor string) ([]model.Asset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.Asset
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}

// ListUpdatedCanvasProjects returns canvas projects updated after the cursor for the given user.
func ListUpdatedCanvasProjects(userID, cursor string) ([]model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.CanvasProject
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}

// ListUpdatedGenerationTasks returns generation tasks updated after the cursor for the given user.
func ListUpdatedGenerationTasks(userID, cursor string) ([]model.GenerationTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.GenerationTask
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}
