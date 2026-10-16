package repository

import (
	"encoding/json"
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func GetAdminKey() (model.AdminKeyRecord, error) {
	db, err := DB()
	if err != nil {
		return model.AdminKeyRecord{}, err
	}
	var item model.Setting
	if err := db.Take(&item, "key = ?", model.SettingKeyAdminKey).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.AdminKeyRecord{}, nil
		}
		return model.AdminKeyRecord{}, err
	}
	var record model.AdminKeyRecord
	err = json.Unmarshal(item.Value, &record)
	return record, err
}

func SaveAdminKey(record model.AdminKeyRecord) error {
	db, err := DB()
	if err != nil {
		return err
	}
	value, err := json.Marshal(record)
	if err != nil {
		return err
	}
	item := model.Setting{Key: model.SettingKeyAdminKey, Value: value, CreatedAt: record.CreatedAt, UpdatedAt: record.CreatedAt}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&item).Error
}

func DeleteAdminKey() error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.Setting{}, "key = ?", model.SettingKeyAdminKey).Error
}
