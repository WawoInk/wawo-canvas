package repository

import (
	"sort"

	"github.com/basketikun/infinite-canvas/model"
)

const syncLimit = 200

type CanvasSyncFact struct {
	Revision uint64
	Project  *model.CanvasProject
	DeleteID string
}

// ListCanvasSyncFacts returns one revision-ordered, combined update/delete page.
func ListCanvasSyncFacts(userID string, cursor uint64) ([]CanvasSyncFact, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var projects []model.CanvasProject
	if err := db.Where("user_id = ? AND revision > ?", userID, cursor).Order("revision asc").Limit(syncLimit).Find(&projects).Error; err != nil {
		return nil, err
	}
	var deletes []model.DeletedRecord
	if err := db.Where("user_id = ? AND table_name = ? AND revision > ?", userID, "canvas_projects", cursor).Order("revision asc").Limit(syncLimit).Find(&deletes).Error; err != nil {
		return nil, err
	}
	return mergeCanvasSyncFacts(projects, deletes), nil
}

func mergeCanvasSyncFacts(projects []model.CanvasProject, deletes []model.DeletedRecord) []CanvasSyncFact {
	facts := make([]CanvasSyncFact, 0, len(projects)+len(deletes))
	for i := range projects {
		facts = append(facts, CanvasSyncFact{Revision: projects[i].Revision, Project: &projects[i]})
	}
	for _, deleted := range deletes {
		facts = append(facts, CanvasSyncFact{Revision: deleted.Revision, DeleteID: deleted.RecordID})
	}
	sort.Slice(facts, func(i, j int) bool { return facts[i].Revision < facts[j].Revision })
	if len(facts) > syncLimit {
		facts = facts[:syncLimit]
	}
	return facts
}

// ListUpdatedAssets returns assets updated after the cursor for the given user.
func ListUpdatedAssets(userID, cursor string) ([]model.Asset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.Asset
	err = db.Where("user_id = ? AND enterprise_id IS NULL AND updated_at > ?", userID, cursor).
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
