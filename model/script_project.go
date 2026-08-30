package model

import "encoding/json"

// ScriptProject stores script workspace metadata and the generated-artifact snapshot reference.
type ScriptProject struct {
	ID                   string `json:"id" gorm:"primaryKey"`
	UserID               string `json:"-" gorm:"not null;index:idx_script_user_updated,priority:1"`
	Title                string `json:"title" gorm:"not null"`
	Source               string `json:"source" gorm:"type:text;not null"`
	CurrentStage         string `json:"currentStage"`
	ProjectConfigJSON    string `json:"-" gorm:"type:jsonb;not null"`
	ConfigDraftJSON      string `json:"-" gorm:"type:jsonb;not null"`
	StorySkeletonStatus  string `json:"storySkeletonStatus"`
	AdaptationStatus     string `json:"adaptationStatus"`
	ActiveConversationID string `json:"activeConversationId"`
	Version              int    `json:"version"`
	Revision             uint64 `json:"revision" gorm:"not null;default:1"`
	ArtifactFileID       string `json:"-" gorm:"not null;uniqueIndex"`
	ArtifactHash         string `json:"-" gorm:"not null"`
	ScriptCount          int    `json:"scriptCount"`
	ConversationCount    int    `json:"conversationCount"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt" gorm:"index:idx_script_user_updated,priority:2"`
}

type ScriptConversation struct {
	ID        string `json:"id" gorm:"primaryKey"`
	ProjectID string `json:"-" gorm:"not null;index:idx_script_conversation_project_position,priority:1"`
	UserID    string `json:"-" gorm:"not null;index"`
	Title     string `json:"title"`
	Position  int    `json:"-" gorm:"not null;index:idx_script_conversation_project_position,priority:2"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type ScriptMessage struct {
	ID             string `json:"id" gorm:"primaryKey"`
	ProjectID      string `json:"-" gorm:"not null;index"`
	ConversationID string `json:"-" gorm:"not null;index:idx_script_message_conversation_position,priority:1"`
	UserID         string `json:"-" gorm:"not null;index"`
	Role           string `json:"role"`
	Content        string `json:"content" gorm:"type:text"`
	Position       int    `json:"-" gorm:"not null;index:idx_script_message_conversation_position,priority:2"`
	CreatedAt      string `json:"createdAt"`
}

type ScriptConversationView struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Messages  []ScriptMessage `json:"messages"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type ScriptProjectSummary struct {
	ID                string `json:"id"`
	Title             string `json:"title"`
	Source            string `json:"source"`
	CurrentStage      string `json:"currentStage"`
	ConversationCount int    `json:"conversationCount"`
	ScriptCount       int    `json:"scriptCount"`
	Revision          uint64 `json:"revision"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

type ScriptProjectDetail struct {
	ScriptProjectSummary
	ProjectID            string                   `json:"projectId"`
	ProjectConfig        json.RawMessage          `json:"projectConfig"`
	ConfigDraft          json.RawMessage          `json:"configDraft,omitempty"`
	StorySkeleton        string                   `json:"storySkeleton"`
	StorySkeletonStatus  string                   `json:"storySkeletonStatus"`
	StorySkeletonReview  json.RawMessage          `json:"storySkeletonReview,omitempty"`
	AdaptationStrategy   string                   `json:"adaptationStrategy"`
	AdaptationStatus     string                   `json:"adaptationStatus"`
	AdaptationReview     json.RawMessage          `json:"adaptationReview,omitempty"`
	Scripts              json.RawMessage          `json:"scripts"`
	Messages             []ScriptMessage          `json:"messages"`
	Conversations        []ScriptConversationView `json:"conversations"`
	ActiveConversationID string                   `json:"activeConversationId"`
	Version              int                      `json:"version"`
}
