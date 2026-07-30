package repository

import (
	"errors"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func QueueAcceptedCompatibilityTask(id, upstreamTaskID, channelName, adapterKey, profileID string, profileVersion int, upstreamModel, responseBody, responseHeaders string, latencyMs int64, now time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	return db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.GenerationTask{}).Where("id = ? AND status = ? AND command_version = 0", id, model.TaskStatusRunning).Updates(map[string]any{
			"upstream_task_id": upstreamTaskID, "channel_id": channelName, "adapter_key": adapterKey, "model_profile_id": profileID,
			"profile_version": profileVersion, "upstream_model": upstreamModel, "latency_ms": latencyMs,
			"status": string(model.TaskStatusQueued), "queue_available_at": stamp, "updated_at": stamp,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("compatibility task is not claimable")
		}
		if err := tx.Model(&model.GenerationPayload{}).Where("task_id = ?", id).Updates(map[string]any{"response_body": responseBody, "response_headers": responseHeaders}).Error; err != nil {
			return err
		}
		return tx.Create(&model.GenerationTaskEvent{ID: "genevent-" + id + "-accepted", TaskID: id, Type: "accepted", Detail: upstreamTaskID, CreatedAt: stamp}).Error
	})
}

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
		updates["worker_lease_owner"] = ""
		updates["worker_lease_expires_at"] = ""
		result := tx.Model(&model.GenerationTask{}).Where("id = ? AND status = ?", id, task.Status).Updates(updates)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		if creditLog != nil && creditLog.Amount.IsPositive() {
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
