package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func RefundGenerationTaskOnce(task model.GenerationTask, modelName, path string) error {
	if task.Credits <= 0 {
		return nil
	}
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.CreditLog{}).Where("task_id = ? AND type = ?", task.ID, model.CreditLogTypeAIRefund).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		result := tx.Model(&model.User{}).Where("id = ?", task.UserID).Updates(map[string]any{"credits": gorm.Expr("credits + ?", task.Credits), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("用户不存在")
		}
		var user model.User
		if err := tx.Where("id = ?", task.UserID).First(&user).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLog{ID: "credit-" + uuid.NewString(), UserID: task.UserID, TaskID: task.ID, Type: model.CreditLogTypeAIRefund, Amount: task.Credits, Balance: user.Credits, Remark: "模型调用失败返还 " + modelName, Extra: fmt.Sprintf(`{"path":%q}`, path), CreatedAt: now}).Error
	})
}
