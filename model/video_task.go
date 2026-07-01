package model

// VideoTask 视频任务所有权映射（上游 provider task ID → 用户）。
type VideoTask struct {
	ID        string `json:"id" gorm:"primaryKey"`
	UserID    string `json:"userId" gorm:"index"`
	TaskID    string `json:"taskId" gorm:"uniqueIndex"` // 上游 provider 返回的任务 ID
	Model     string `json:"model"`
	CreatedAt string `json:"createdAt"`
}
