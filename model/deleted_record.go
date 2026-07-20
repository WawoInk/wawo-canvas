package model

import "time"

// DeletedRecord 记录物理删除的实体，供 Sync API 返回已删除的 ID 列表。
// 按 (user_id, table_name, record_id, deleted_at) 索引，支持 cursor 增量查询。
type DeletedRecord struct {
	ID        uint64    `json:"-" gorm:"primaryKey;autoIncrement"`
	TableName string    `json:"tableName" gorm:"column:table_name;not null;index:idx_dr_user_time,priority:2;index:idx_dr_user_revision,priority:2"`
	RecordID  string    `json:"recordId" gorm:"column:record_id;not null;index:idx_dr_user_time,priority:3"`
	UserID    string    `json:"userId" gorm:"column:user_id;not null;index:idx_dr_user_time,priority:1;index:idx_dr_user_revision,priority:1"`
	Revision  uint64    `json:"revision" gorm:"not null;default:0;index:idx_dr_user_revision,priority:3"`
	DeletedAt time.Time `json:"deletedAt" gorm:"column:deleted_at;not null;index:idx_dr_user_time,priority:4"`
}
