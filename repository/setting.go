package repository

import (
	"encoding/json"
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GetSettings 返回 public 和 private 两行配置。
func GetSettings() (model.Settings, error) {
	db, err := DB()
	if err != nil {
		return model.Settings{}, err
	}
	var items []model.Setting
	if err := db.Find(&items).Error; err != nil {
		return model.Settings{}, err
	}
	result := model.Settings{}
	for _, item := range items {
		if item.Key == model.SettingKeyPrivate {
			_ = json.Unmarshal(item.Value, &result.Private)
		} else if item.Key == model.SettingKeyPublic {
			_ = json.Unmarshal(item.Value, &result.Public)
		}
	}
	return result, nil
}

// SaveSettings 保存 public 和 private 两行配置。
func SaveSettings(settings model.Settings, now string) (model.Settings, error) {
	db, err := DB()
	if err != nil {
		return settings, err
	}
	publicValue, _ := json.Marshal(settings.Public)
	privateValue, _ := json.Marshal(settings.Private)
	items := []model.Setting{
		{Key: model.SettingKeyPublic, Value: publicValue, CreatedAt: now, UpdatedAt: now},
		{Key: model.SettingKeyPrivate, Value: privateValue, CreatedAt: now, UpdatedAt: now},
	}
	err = db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&items).Error
	return settings, err
}

// GetVolcengineAssetConfig returns the independent Volcengine asset gateway config.
func GetVolcengineAssetConfig() (model.VolcengineAssetConfig, error) {
	db, err := DB()
	if err != nil {
		return model.VolcengineAssetConfig{}, err
	}
	var item model.Setting
	if err := db.First(&item, "key = ?", model.SettingKeyVolcAssetConfig).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.VolcengineAssetConfig{}, nil
		}
		return model.VolcengineAssetConfig{}, err
	}
	if len(item.Value) == 0 {
		return model.VolcengineAssetConfig{}, nil
	}
	var config model.VolcengineAssetConfig
	if err := json.Unmarshal(item.Value, &config); err != nil {
		return model.VolcengineAssetConfig{}, err
	}
	return config, nil
}

// SaveVolcengineAssetConfig saves the independent Volcengine asset gateway config.
func SaveVolcengineAssetConfig(config model.VolcengineAssetConfig, now string) (model.VolcengineAssetConfig, error) {
	db, err := DB()
	if err != nil {
		return config, err
	}
	value, err := json.Marshal(config)
	if err != nil {
		return config, err
	}
	item := model.Setting{Key: model.SettingKeyVolcAssetConfig, Value: value, CreatedAt: now, UpdatedAt: now}
	err = db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&item).Error
	return config, err
}
