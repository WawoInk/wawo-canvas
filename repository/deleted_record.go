package repository

import (
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

// RecordDeletion 在物理删除前记录一条删除日志。
func RecordDeletion(tableName, recordID, userID string, deletedAt time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&model.DeletedRecord{
		TableName: tableName,
		RecordID:  recordID,
		UserID:    userID,
		DeletedAt: deletedAt,
	}).Error
}

// ListDeletedRecords 返回指定用户在 cursor 之后被删除的记录（按 deleted_at 升序）。
func ListDeletedRecords(userID, cursor string) ([]model.DeletedRecord, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var records []model.DeletedRecord
	query := db.Where("user_id = ?", userID)
	if cursor != "" {
		query = query.Where("deleted_at > ?", cursor)
	}
	err = query.
		Order("deleted_at asc").
		Find(&records).Error
	return records, err
}

// PruneDeletedRecords 清理创建时间早于 olderThan 的删除日志。
// ponytail: 在清理 cron 或 lazy 调用中执行，保留 30 天。
func PruneDeletedRecords(olderThan time.Time) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	result := db.Where("deleted_at < ?", olderThan).Delete(&model.DeletedRecord{})
	return result.RowsAffected, result.Error
}
