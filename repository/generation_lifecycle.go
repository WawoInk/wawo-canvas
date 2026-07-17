package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func SaveGenerationTaskEvent(event model.GenerationTaskEvent) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&event).Error
}

func ListGenerationTaskEvents(taskID string) ([]model.GenerationTaskEvent, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var events []model.GenerationTaskEvent
	err = db.Where("task_id = ?", taskID).Order("created_at, id").Find(&events).Error
	return events, err
}

func TransitionGenerationTask(id string, from []model.TaskStatus, updates map[string]any) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	result := db.Model(&model.GenerationTask{}).Where("id = ? AND status IN ?", id, from).Updates(updates)
	return result.RowsAffected == 1, result.Error
}

// TransitionGenerationTaskTerminal atomically persists one terminal decision and its optional credit/event records.
func TransitionGenerationTaskTerminal(id string, from []model.TaskStatus, updates map[string]any, creditLog *model.CreditLog, event model.GenerationTaskEvent) (model.GenerationTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, false, err
	}
	var task model.GenerationTask
	changed := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&task).Error; err != nil {
			return err
		}
		if !generationStatusAllowed(task.Status, from) {
			return nil
		}
		result := tx.Model(&model.GenerationTask{}).Where("id = ? AND status = ?", id, task.Status).Updates(updates)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		if creditLog != nil && creditLog.Amount > 0 {
			result = tx.Model(&model.User{}).Where("id = ?", creditLog.UserID).Updates(map[string]any{
				"credits":    gorm.Expr("credits + ?", creditLog.Amount),
				"updated_at": creditLog.CreatedAt,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("用户不存在")
			}
			var user model.User
			if err := tx.Where("id = ?", creditLog.UserID).First(&user).Error; err != nil {
				return err
			}
			creditLog.Balance = user.Credits
			if err := tx.Create(creditLog).Error; err != nil {
				return err
			}
		}
		if event.ID != "" {
			if err := tx.Create(&event).Error; err != nil {
				return err
			}
		}
		changed = true
		return nil
	})
	if err == nil {
		task, err = GetGenerationTaskByID(id)
	}
	return task, changed, err
}

func generationStatusAllowed(status model.TaskStatus, allowed []model.TaskStatus) bool {
	for _, candidate := range allowed {
		if status == candidate {
			return true
		}
	}
	return false
}
