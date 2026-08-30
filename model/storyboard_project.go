package model

import "encoding/json"

// StoryboardProject stores the PostgreSQL-owned storyboard summary and snapshot reference.
type StoryboardProject struct {
	ID               string `json:"id" gorm:"primaryKey"`
	UserID           string `json:"-" gorm:"not null;index:idx_storyboard_user_updated,priority:1"`
	Title            string `json:"title" gorm:"not null"`
	Source           string `json:"source" gorm:"type:text;not null"`
	OptionsJSON      string `json:"-" gorm:"type:jsonb;not null"`
	Model            string `json:"model"`
	SourceHash       string `json:"sourceHash" gorm:"index"`
	Status           string `json:"status" gorm:"not null;default:draft"`
	Revision         uint64 `json:"revision" gorm:"not null;default:1"`
	ValidationStatus string `json:"validationStatus"`
	SceneCount       int    `json:"sceneCount"`
	ShotCount        int    `json:"shotCount"`
	ArtifactFileID   string `json:"-" gorm:"not null;uniqueIndex"`
	ArtifactHash     string `json:"-" gorm:"not null;default:''"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt" gorm:"index:idx_storyboard_user_updated,priority:2"`
}

type StoryboardProjectSummary struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	Source           string          `json:"source"`
	Options          json.RawMessage `json:"options"`
	Model            string          `json:"model"`
	SourceHash       string          `json:"sourceHash"`
	Status           string          `json:"status"`
	Revision         uint64          `json:"revision"`
	ValidationStatus string          `json:"validationStatus"`
	SceneCount       int             `json:"sceneCount"`
	ShotCount        int             `json:"shotCount"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
}

type StoryboardProjectDetail struct {
	StoryboardProjectSummary
	DirectorPlan json.RawMessage `json:"directorPlan"`
	Document     json.RawMessage `json:"document"`
	Validation   json.RawMessage `json:"validation"`
}
