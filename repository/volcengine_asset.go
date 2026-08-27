package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func GetVolcengineAssetGroupBinding(scopeType, enterpriseID, userID, outboundID string) (model.VolcengineAssetGroupBinding, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VolcengineAssetGroupBinding{}, false, err
	}
	var binding model.VolcengineAssetGroupBinding
	err = db.Where("scope_type = ? AND enterprise_id = ? AND user_id = ? AND outbound_id = ?", scopeType, enterpriseID, userID, outboundID).First(&binding).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.VolcengineAssetGroupBinding{}, false, nil
	}
	return binding, err == nil, err
}

func SaveVolcengineAssetGroupBinding(binding model.VolcengineAssetGroupBinding) (model.VolcengineAssetGroupBinding, error) {
	db, err := DB()
	if err != nil {
		return binding, err
	}
	err = db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "scope_type"}, {Name: "enterprise_id"}, {Name: "user_id"}, {Name: "outbound_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"format", "project_name", "group_id", "group_type", "updated_at"}),
	}).Create(&binding).Error
	if err != nil {
		return binding, err
	}
	return binding, nil
}
