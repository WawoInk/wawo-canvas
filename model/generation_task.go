package model

// TaskType 生成任务类型。
type TaskType string

const (
	TaskTypeImage TaskType = "image"
	TaskTypeVideo TaskType = "video"
	TaskTypeAudio TaskType = "audio"
	TaskTypeChat  TaskType = "chat"
)

// TaskStatus 任务生命周期状态。
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusSuccess   TaskStatus = "success"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"
)

// GenerationTask 统一 AI 生成任务元数据。
type GenerationTask struct {
	ID             string     `json:"id" gorm:"primaryKey"`
	UserID         string     `json:"userId" gorm:"index"`
	TaskType       TaskType   `json:"taskType" gorm:"index"`
	Provider       string     `json:"provider"`
	Model          string     `json:"model"`
	Status         TaskStatus `json:"status"`
	Credits        int        `json:"credits"`
	LatencyMs      int64      `json:"latencyMs"`
	UpstreamTaskID string     `json:"upstreamTaskId"`
	CallbackToken  string     `json:"callbackToken,omitempty"`
	TraceID        string     `json:"traceId"`
	ErrorCode      string     `json:"errorCode,omitempty"`
	ErrorMessage   string     `json:"errorMessage,omitempty"`
	CreatedAt      string     `json:"createdAt"`
	UpdatedAt      string     `json:"updatedAt"`
}

// GenerationPayload 任务请求/响应详情（按需查询，TTL 清理）。
type GenerationPayload struct {
	ID              string `json:"id" gorm:"primaryKey"`
	TaskID          string `json:"taskId" gorm:"uniqueIndex"`
	RequestHeaders  string `json:"requestHeaders" gorm:"type:text"`
	RequestBody     string `json:"requestBody" gorm:"type:text"`
	ResponseHeaders string `json:"responseHeaders" gorm:"type:text"`
	ResponseBody    string `json:"responseBody" gorm:"type:text"`
	RawError        string `json:"rawError,omitempty" gorm:"type:text"`
	CreatedAt       string `json:"createdAt"`
}

// GenerationTaskList 任务分页结果。
type GenerationTaskList struct {
	Items []GenerationTask `json:"items"`
	Total int64            `json:"total"`
}

// GenerationTaskQuery 任务列表查询参数。
type GenerationTaskQuery struct {
	UserID    string
	TaskType  TaskType
	Status    TaskStatus
	StartTime string
	EndTime   string
	Page      int
	PageSize  int
}

// Normalize 设置默认分页参数。
func (q *GenerationTaskQuery) Normalize() {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > MaxPageSize {
		q.PageSize = MaxPageSize
	}
}

// Offset 计算分页偏移。
func (q *GenerationTaskQuery) Offset() int {
	return (q.Page - 1) * q.PageSize
}
