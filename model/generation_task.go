package model

// TaskType 生成任务类型。
type TaskType string

const (
	TaskTypeImage TaskType = "image"
	TaskTypeVideo TaskType = "video"
	TaskTypeAudio TaskType = "audio"
	TaskTypeChat  TaskType = "chat"
)

// Source 生成任务来源场景。
type Source string

const (
	SourceCanvas         Source = "canvas"
	SourceImageWorkbench Source = "image_workbench"
	SourceVideoWorkbench Source = "video_workbench"
)

// TaskStatus 任务生命周期状态。
type TaskStatus string

const (
	TaskStatusQueued    TaskStatus = "queued"
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusSucceeded TaskStatus = "succeeded"
	TaskStatusSuccess   TaskStatus = "success"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"
)

// EquivalentTaskStatuses returns persisted statuses with the same meaning.
func EquivalentTaskStatuses(status TaskStatus) []TaskStatus {
	if status == TaskStatusSuccess || status == TaskStatusSucceeded {
		return []TaskStatus{TaskStatusSuccess, TaskStatusSucceeded}
	}
	return []TaskStatus{status}
}

// GenerationTask 统一 AI 生成任务元数据。
type GenerationTask struct {
	ID                   string     `json:"id" gorm:"primaryKey"`
	UserID               string     `json:"userId" gorm:"index"`
	TaskType             TaskType   `json:"taskType" gorm:"index"`
	Source               string     `json:"source" gorm:"index"`
	Provider             string     `json:"provider"`
	Model                string     `json:"model"`
	Status               TaskStatus `json:"status"`
	Credits              int        `json:"credits"`
	LatencyMs            int64      `json:"latencyMs"`
	UpstreamTaskID       string     `json:"upstreamTaskId" gorm:"index"`
	CallbackToken        string     `json:"-" gorm:"index"`
	TraceID              string     `json:"traceId"`
	ErrorCode            string     `json:"errorCode,omitempty"`
	ErrorMessage         string     `json:"errorMessage,omitempty"`
	ErrorRetryable       bool       `json:"errorRetryable,omitempty"`
	Metadata             string     `json:"metadata" gorm:"type:text"`
	ClientRequestID      string     `json:"clientRequestId,omitempty" gorm:"index"`
	CommandHash          string     `json:"commandHash,omitempty"`
	CommandVersion       int        `json:"commandVersion,omitempty"`
	IntentKind           string     `json:"intentKind,omitempty" gorm:"index"`
	ModelProfileID       string     `json:"modelProfileId,omitempty" gorm:"index"`
	ProfileVersion       int        `json:"modelProfileVersion,omitempty"`
	AdapterKey           string     `json:"adapterKey,omitempty"`
	ChannelID            string     `json:"channelId,omitempty"`
	UpstreamModel        string     `json:"upstreamModel,omitempty"`
	ResultJSON           string     `json:"-" gorm:"type:text"`
	QueueAvailableAt     string     `json:"-"`
	WorkerLeaseOwner     string     `json:"-"`
	WorkerLeaseExpiresAt string     `json:"-"`
	CreatedAt            string     `json:"createdAt"`
	UpdatedAt            string     `json:"updatedAt"`
}

// GenerationPayload 任务请求/响应详情（按需查询，TTL 清理）。
type GenerationPayload struct {
	ID              string `json:"id" gorm:"primaryKey"`
	TaskID          string `json:"taskId" gorm:"uniqueIndex"`
	CommandBody     string `json:"-" gorm:"type:text"`
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
	Source    string `json:"source"`
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
