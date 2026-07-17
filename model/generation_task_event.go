package model

// GenerationTaskEvent is a lightweight append-only lifecycle audit record.
type GenerationTaskEvent struct {
	ID        string `json:"id" gorm:"primaryKey"`
	TaskID    string `json:"taskId" gorm:"index"`
	Type      string `json:"type" gorm:"index"`
	Detail    string `json:"detail,omitempty" gorm:"type:text"`
	CreatedAt string `json:"createdAt" gorm:"index"`
}
