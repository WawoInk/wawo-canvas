package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func CreateGenerationTaskWithCharge(task model.GenerationTask, payload model.GenerationPayload, userID, modelName, path string, credits int) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		payload.TaskID = task.ID
		if err := tx.Create(&payload).Error; err != nil {
			return err
		}
		if credits <= 0 {
			return nil
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		result := tx.Model(&model.User{}).Where("id = ? AND credits >= ?", userID, credits).Updates(map[string]any{"credits": gorm.Expr("credits - ?", credits), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("算力点不足")
		}
		var user model.User
		if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLog{ID: "credit-" + uuid.NewString(), UserID: userID, TaskID: task.ID, Type: model.CreditLogTypeAIConsume, Amount: -credits, Balance: user.Credits, Remark: "调用模型 " + modelName, Extra: fmt.Sprintf(`{"path":%q}`, path), CreatedAt: now}).Error
	})
}
