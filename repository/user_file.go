package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

func CreateUserFile(item model.UserFile) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&item).Error
}

func ListUserFiles(userID, fileType string, page, pageSize int) ([]model.UserFile, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	tx := db.Model(&model.UserFile{}).Where("user_id = ?", userID)
	if fileType != "" {
		tx = tx.Where("file_type = ?", fileType)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.UserFile
	err = tx.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error
	return items, total, err
}

func GetUserFileByID(id, userID string) (model.UserFile, bool, error) {
	db, err := DB()
	if err != nil {
		return model.UserFile{}, false, err
	}
	var item model.UserFile
	err = db.Where("id = ? AND user_id = ?", id, userID).First(&item).Error
	if err != nil {
		return model.UserFile{}, false, nil
	}
	return item, true, nil
}

func DeleteUserFile(id, userID string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	result := db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.UserFile{})
	return result.RowsAffected > 0, result.Error
}
