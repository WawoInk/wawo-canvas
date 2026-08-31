package model

import "encoding/json"

const (
	BrainstormRoleUser      = "user"
	BrainstormRoleAssistant = "assistant"

	BrainstormStatusPending          = "pending"
	BrainstormStatusStreaming        = "streaming"
	BrainstormStatusAwaitingApproval = "awaiting_approval"
	BrainstormStatusCompleted        = "completed"
	BrainstormStatusFailed           = "failed"
	BrainstormStatusCancelled        = "cancelled"
	BrainstormStatusInterrupted      = "interrupted"

	StoryboardMemoryScopeProject = "project"
	StoryboardMemoryScopeScene   = "scene"
	StoryboardMemoryScopeShot    = "shot"
)

type StoryboardBrainstormConversation struct {
	ID               string `json:"id" gorm:"primaryKey"`
	ProjectID        string `json:"projectId" gorm:"not null;index:idx_brainstorm_conversation_scope,priority:2"`
	UserID           string `json:"-" gorm:"not null;index:idx_brainstorm_conversation_scope,priority:1"`
	Title            string `json:"title" gorm:"not null"`
	CurrentMessageID string `json:"currentMessageId" gorm:"not null;default:''"`
	CreatedAt        string `json:"createdAt" gorm:"not null"`
	UpdatedAt        string `json:"updatedAt" gorm:"not null;index:idx_brainstorm_conversation_scope,priority:3"`
}

func (StoryboardBrainstormConversation) TableName() string {
	return "storyboard_brainstorm_conversations"
}

type StoryboardBrainstormMessage struct {
	ID              string          `json:"id" gorm:"primaryKey"`
	ProjectID       string          `json:"projectId" gorm:"not null;index:idx_brainstorm_message_scope,priority:2"`
	ConversationID  string          `json:"conversationId" gorm:"not null;index:idx_brainstorm_message_scope,priority:3"`
	UserID          string          `json:"-" gorm:"not null;index:idx_brainstorm_message_scope,priority:1"`
	ParentID        string          `json:"parentId" gorm:"not null;default:''"`
	Role            string          `json:"role" gorm:"not null"`
	Content         string          `json:"content,omitempty" gorm:"type:text;not null;default:''"`
	Output          json.RawMessage `json:"output,omitempty" gorm:"type:jsonb;serializer:json;not null"`
	Status          string          `json:"status,omitempty" gorm:"not null;default:''"`
	ClientRequestID string          `json:"clientRequestId,omitempty" gorm:"not null;default:''"`
	RequestHash     string          `json:"-" gorm:"not null;default:''"`
	Revision        uint64          `json:"revision" gorm:"not null;default:1"`
	CreatedAt       string          `json:"createdAt" gorm:"not null;index:idx_brainstorm_message_scope,priority:4"`
	UpdatedAt       string          `json:"updatedAt" gorm:"not null"`
}

func (StoryboardBrainstormMessage) TableName() string {
	return "storyboard_brainstorm_messages"
}

type StoryboardMemory struct {
	ID              string   `json:"id" gorm:"primaryKey"`
	ProjectID       string   `json:"projectId" gorm:"not null;index:idx_storyboard_memory_scope,priority:2"`
	UserID          string   `json:"-" gorm:"not null;index:idx_storyboard_memory_scope,priority:1"`
	Kind            string   `json:"kind" gorm:"not null"`
	Scope           string   `json:"scope" gorm:"not null"`
	Path            string   `json:"path" gorm:"not null;default:''"`
	Content         string   `json:"content" gorm:"type:text;not null"`
	Tags            []string `json:"tags" gorm:"type:jsonb;serializer:json;not null"`
	SourceMessageID string   `json:"sourceMessageId" gorm:"not null;default:''"`
	OperationID     string   `json:"operationId" gorm:"not null"`
	CreatedAt       string   `json:"createdAt" gorm:"not null"`
	UpdatedAt       string   `json:"updatedAt" gorm:"not null;index:idx_storyboard_memory_scope,priority:3"`
}

func (StoryboardMemory) TableName() string {
	return "storyboard_memories"
}

type StoryboardBrainstormMessagePage struct {
	Conversation StoryboardBrainstormConversation `json:"conversation"`
	Items        []StoryboardBrainstormMessage    `json:"items"`
	Total        int64                            `json:"total"`
}

type StoryboardBrainstormTurn struct {
	Conversation     StoryboardBrainstormConversation `json:"conversation"`
	UserMessage      *StoryboardBrainstormMessage     `json:"userMessage,omitempty"`
	AssistantMessage StoryboardBrainstormMessage      `json:"assistantMessage"`
}

func IsBrainstormActiveStatus(status string) bool {
	return status == BrainstormStatusPending || status == BrainstormStatusStreaming || status == BrainstormStatusAwaitingApproval
}

func IsBrainstormTerminalStatus(status string) bool {
	return status == BrainstormStatusCompleted || status == BrainstormStatusFailed || status == BrainstormStatusCancelled || status == BrainstormStatusInterrupted
}
