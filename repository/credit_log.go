package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func GetCreditLogByTaskAndType(taskID string, kind model.CreditLogType) (model.CreditLog, bool, error) {
	db, err := DB()
	if err != nil {
		return model.CreditLog{}, false, err
	}
	var log model.CreditLog
	result := db.Where("task_id = ? AND type = ?", taskID, kind).First(&log)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return model.CreditLog{}, false, nil
	}
	return log, result.Error == nil, result.Error
}
