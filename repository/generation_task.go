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

// GetGenerationTaskByCallbackToken 根据回调令牌查找任务。
func GetGenerationTaskByCallbackToken(token string) (string, error) {
	db, err := DB()
	if err != nil {
		return "", err
	}
	var task model.GenerationTask
	result := db.Where("callback_token = ?", token).Select("id").First(&task)
	if result.Error != nil {
		return "", result.Error
	}
	return task.ID, nil
}

// GetGenerationTaskByUpstreamTaskID 根据上游任务 ID 查找生成任务 ID。
func GetGenerationTaskByUpstreamTaskID(upstreamTaskID string) (string, error) {
	db, err := DB()
	if err != nil {
		return "", err
	}
	var task model.GenerationTask
	result := db.Where("upstream_task_id = ?", upstreamTaskID).Select("id").First(&task)
	if result.Error != nil {
		return "", result.Error
	}
	return task.ID, nil
}

// ListGenerationTasks 按查询条件分页查询任务。
func ListGenerationTasks(q model.GenerationTaskQuery) ([]model.GenerationTask, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.GenerationTask{})

	if q.Source != "" {
		tx = tx.Where("source = ?", q.Source)
	}
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

// UpdateGenerationPayload 更新任务的响应负载。
func UpdateGenerationPayload(taskID string, respBody string, respHeaders string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.GenerationPayload{}).Where("task_id = ?", taskID).
		Updates(map[string]any{
			"response_body":    respBody,
			"response_headers": respHeaders,
		}).Error
}

// UpdateGenerationPayloadRawError 更新任务负载的原始错误信息。
func UpdateGenerationPayloadRawError(taskID string, rawError string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.GenerationPayload{}).Where("task_id = ?", taskID).
		Update("raw_error", rawError).Error
}

// UpdateGenerationPayloadResponseBody 更新任务负载的响应正文。
func UpdateGenerationPayloadResponseBody(taskID string, respBody string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.GenerationPayload{}).Where("task_id = ?", taskID).
		Update("response_body", respBody).Error
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

// AdminGenerationTaskWithUser 管理端列表 DTO，JOIN users 表获取 username。
type AdminGenerationTaskWithUser struct {
	model.GenerationTask
	Username string `json:"username"`
}

// ListGenerationTasksWithUsername 管理员列表查询，LEFT JOIN users 获取 username。
func ListGenerationTasksWithUsername(q model.GenerationTaskQuery) ([]AdminGenerationTaskWithUser, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("generation_tasks gt").
		Select("gt.*, u.username").
		Joins("LEFT JOIN users u ON gt.user_id = u.id")

	if q.Source != "" {
		tx = tx.Where("source = ?", q.Source)
	}
	if q.UserID != "" {
		tx = tx.Where("gt.user_id = ?", q.UserID)
	}
	if q.TaskType != "" {
		tx = tx.Where("gt.task_type = ?", q.TaskType)
	}
	if q.Status != "" {
		tx = tx.Where("gt.status = ?", q.Status)
	}
	if q.StartTime != "" {
		tx = tx.Where("gt.created_at >= ?", q.StartTime)
	}
	if q.EndTime != "" {
		tx = tx.Where("gt.created_at <= ?", q.EndTime)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var tasks []AdminGenerationTaskWithUser
	err = tx.Order("gt.created_at desc").Offset(q.Offset()).Limit(q.PageSize).Scan(&tasks).Error
	return tasks, total, err
}

// AdminDeleteGenerationTasks 管理员批量删除任务及负载（无所有权校验）。
func AdminDeleteGenerationTasks(ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var deleted int64
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("task_id IN ?", ids).Delete(&model.GenerationPayload{}).Error; err != nil {
			return err
		}
		result := tx.Where("id IN ?", ids).Delete(&model.GenerationTask{})
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
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
