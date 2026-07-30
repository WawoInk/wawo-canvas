package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func CreateGenerationTaskWithCharge(task *model.GenerationTask, payload model.GenerationPayload, userID, modelName, path string, credits model.Decimal, displayName string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if credits.IsPositive() {
			var user model.User
			if err := tx.Select("enterprise_id").Where("id = ?", userID).Take(&user).Error; err != nil {
				return err
			}
			credits, err = discountedUserCredits(tx, user, credits)
			if err != nil {
				return err
			}
			task.Credits = credits
		}
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		payload.TaskID = task.ID
		if err := tx.Create(&payload).Error; err != nil {
			return err
		}
		if !credits.IsPositive() {
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
		if displayName == "" {
			displayName = modelName
		}
		return tx.Create(&model.CreditLog{ID: "credit-" + uuid.NewString(), UserID: userID, TaskID: task.ID, Type: model.CreditLogTypeAIConsume, Amount: credits.Neg(), Balance: user.Credits, Remark: "调用模型 " + displayName, Extra: fmt.Sprintf(`{"path":%q}`, path), CreatedAt: now}).Error
	})
}

func ChargeGenerationTask(taskID string, credits model.Decimal, upstreamCredits *model.Decimal, path, displayName string) (model.GenerationTask, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, err
	}
	var task model.GenerationTask
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", taskID).First(&task).Error; err != nil {
			return err
		}
		if task.Credits.IsPositive() || !credits.IsPositive() {
			return nil
		}
		var userIdentity model.User
		if err := tx.Select("enterprise_id").Where("id = ?", task.UserID).Take(&userIdentity).Error; err != nil {
			return err
		}
		discounted, err := discountedUserCredits(tx, userIdentity, credits)
		if err != nil {
			return err
		}
		credits = discounted
		now := time.Now().UTC().Format(time.RFC3339Nano)
		result := tx.Model(&model.User{}).Where("id = ? AND credits >= ?", task.UserID, credits).Updates(map[string]any{
			"credits":    gorm.Expr("credits - ?", credits),
			"updated_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInsufficientCredits
		}
		upstreamValue := any(nil)
		if upstreamCredits != nil {
			upstreamValue = *upstreamCredits
		}
		if err := tx.Model(&model.GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{
			"credits": credits, "upstream_credits": upstreamValue, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		var user model.User
		if err := tx.Where("id = ?", task.UserID).First(&user).Error; err != nil {
			return err
		}
		extra, _ := json.Marshal(map[string]any{"path": path, "credits": upstreamCredits})
		if displayName == "" {
			displayName = task.Model
		}
		if err := tx.Create(&model.CreditLog{
			ID: "credit-" + uuid.NewString(), UserID: task.UserID, TaskID: task.ID, Type: model.CreditLogTypeAIConsume,
			Amount: credits.Neg(), Balance: user.Credits, Remark: "调用模型 " + displayName, Extra: string(extra), CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		task.Credits = credits
		task.UpstreamCredits = upstreamCredits
		task.UpdatedAt = now
		return nil
	})
	return task, err
}
