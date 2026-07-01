package repository

import (
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// CreateGenerationTask 在事务中创建任务及其负载。
func CreateGenerationTask(task model.GenerationTask, payload model.GenerationPayload) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		payload.TaskID = task.ID
		return tx.Create(&payload).Error
	})
}

// UpdateGenerationTask 更新任务字段（状态、上游 ID、耗时、错误等）。
func UpdateGenerationTask(id string, updates map[string]any) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.GenerationTask{}).Where("id = ?", id).Updates(updates).Error
}

// GetGenerationTaskByID 根据 ID 查询任务。
func GetGenerationTaskByID(id string) (model.GenerationTask, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, err
	}
	var task model.GenerationTask
	result := db.Where("id = ?", id).First(&task)
	return task, result.Error
}

// GetGenerationTaskByIDAndUser 根据 ID 和用户 ID 查询任务（所有权校验）。
func GetGenerationTaskByIDAndUser(id, userID string) (model.GenerationTask, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, err
	}
	var task model.GenerationTask
	result := db.Where("id = ? AND user_id = ?", id, userID).First(&task)
	return task, result.Error
}

// ListGenerationTasks 按查询条件分页查询任务。
func ListGenerationTasks(q model.GenerationTaskQuery) ([]model.GenerationTask, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.GenerationTask{})

	if q.UserID != "" {
		tx = tx.Where("user_id = ?", q.UserID)
	}
	if q.TaskType != "" {
		tx = tx.Where("task_type = ?", q.TaskType)
	}
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	if q.StartTime != "" {
		tx = tx.Where("created_at >= ?", q.StartTime)
	}
	if q.EndTime != "" {
		tx = tx.Where("created_at <= ?", q.EndTime)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var tasks []model.GenerationTask
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&tasks).Error
	return tasks, total, err
}

// GetGenerationPayloadByTaskID 根据任务 ID 获取负载。
func GetGenerationPayloadByTaskID(taskID string) (model.GenerationPayload, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationPayload{}, err
	}
	var payload model.GenerationPayload
	result := db.Where("task_id = ?", taskID).First(&payload)
	return payload, result.Error
}

// DeleteGenerationTask 删除任务及其负载（需校验所有权）。
func DeleteGenerationTask(id, userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("task_id = ?", id).Delete(&model.GenerationPayload{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.GenerationTask{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

// DeleteExpiredPayloads 删除超过 TTL 的负载记录。
func DeleteExpiredPayloads(beforeTimestamp string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	result := db.Where("created_at < ?", beforeTimestamp).Delete(&model.GenerationPayload{})
	return result.RowsAffected, result.Error
}
