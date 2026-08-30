package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

type ScriptMessageInput struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type ScriptConversationInput struct {
	ID        string               `json:"id"`
	Title     string               `json:"title"`
	Messages  []ScriptMessageInput `json:"messages"`
	CreatedAt string               `json:"createdAt"`
	UpdatedAt string               `json:"updatedAt"`
}

type ScriptProjectWorkspaceInput struct {
	ID                   string                    `json:"id"`
	ProjectID            string                    `json:"projectId"`
	Title                string                    `json:"title"`
	Source               string                    `json:"source"`
	CurrentStage         string                    `json:"currentStage"`
	ProjectConfig        json.RawMessage           `json:"projectConfig"`
	ConfigDraft          json.RawMessage           `json:"configDraft"`
	StorySkeleton        string                    `json:"storySkeleton"`
	StorySkeletonStatus  string                    `json:"storySkeletonStatus"`
	StorySkeletonReview  json.RawMessage           `json:"storySkeletonReview"`
	AdaptationStrategy   string                    `json:"adaptationStrategy"`
	AdaptationStatus     string                    `json:"adaptationStatus"`
	AdaptationReview     json.RawMessage           `json:"adaptationReview"`
	Scripts              json.RawMessage           `json:"scripts"`
	Messages             []ScriptMessageInput      `json:"messages"`
	Conversations        []ScriptConversationInput `json:"conversations"`
	ActiveConversationID string                    `json:"activeConversationId"`
	Version              int                       `json:"version"`
	UpdatedAt            string                    `json:"updatedAt"`
}

type scriptArtifactSnapshot struct {
	StorySkeleton       string          `json:"storySkeleton"`
	StorySkeletonReview json.RawMessage `json:"storySkeletonReview"`
	AdaptationStrategy  string          `json:"adaptationStrategy"`
	AdaptationReview    json.RawMessage `json:"adaptationReview"`
	Scripts             json.RawMessage `json:"scripts"`
}

func ListScriptProjects(userID string) ([]model.ScriptProjectSummary, error) {
	projects, err := repository.ListScriptProjects(userID)
	if err != nil {
		return nil, err
	}
	items := make([]model.ScriptProjectSummary, len(projects))
	for i, project := range projects {
		items[i] = scriptSummary(project)
	}
	return items, nil
}

func CreateScriptProject(ctx context.Context, userID, title, source string) (model.ScriptProjectDetail, error) {
	id := "script-" + uuid.NewString()
	now := studioNow()
	conversationID := "conversation-" + uuid.NewString()
	workspace := ScriptProjectWorkspaceInput{
		ID:                   id,
		ProjectID:            id,
		Title:                title,
		Source:               source,
		CurrentStage:         "collecting_config",
		ProjectConfig:        json.RawMessage("null"),
		ConfigDraft:          json.RawMessage("{}"),
		StorySkeletonStatus:  "empty",
		AdaptationStatus:     "empty",
		Scripts:              json.RawMessage("[]"),
		ActiveConversationID: conversationID,
		Conversations:        []ScriptConversationInput{{ID: conversationID, Title: "新对话", CreatedAt: now, UpdatedAt: now, Messages: []ScriptMessageInput{}}},
	}
	project, conversations, messages, snapshot, body, err := normalizeScriptWorkspace(id, userID, now, workspace, "")
	if err != nil {
		return model.ScriptProjectDetail{}, err
	}
	file, err := uploadStudioJSON(ctx, "scripts", "scripts", userID, id, body)
	if err != nil {
		return model.ScriptProjectDetail{}, err
	}
	project.ArtifactFileID = file.ID
	if err := repository.CreateScriptProject(project, file, conversations, messages); err != nil {
		_ = S3Delete(context.Background(), file.S3Key)
		return model.ScriptProjectDetail{}, err
	}
	return scriptDetail(project, conversations, messages, snapshot), nil
}

func GetScriptProject(ctx context.Context, id, userID string) (model.ScriptProjectDetail, error) {
	project, err := repository.GetScriptProject(id, userID)
	if err != nil {
		return model.ScriptProjectDetail{}, studioProjectError(err)
	}
	conversations, messages, err := repository.GetScriptProjectConversations(id, userID)
	if err != nil {
		return model.ScriptProjectDetail{}, err
	}
	snapshot, err := readScriptSnapshot(ctx, project, userID)
	if err != nil {
		return model.ScriptProjectDetail{}, err
	}
	return scriptDetail(project, conversations, messages, snapshot), nil
}

func UpdateScriptProject(ctx context.Context, id, userID string, workspace ScriptProjectWorkspaceInput, expectedRevision uint64) (model.ScriptProjectDetail, error) {
	existing, err := repository.GetScriptProject(id, userID)
	if err != nil {
		return model.ScriptProjectDetail{}, studioProjectError(err)
	}
	if existing.Revision != expectedRevision {
		current, readErr := GetScriptProject(ctx, id, userID)
		if readErr != nil {
			return model.ScriptProjectDetail{}, readErr
		}
		return current, repository.ErrConflict
	}
	project, conversations, messages, snapshot, body, err := normalizeScriptWorkspace(id, userID, existing.CreatedAt, workspace, existing.Title)
	if err != nil {
		return model.ScriptProjectDetail{}, err
	}
	project.ArtifactFileID = existing.ArtifactFileID
	var newFile *model.UserFile
	var oldFile model.UserFile
	if project.ArtifactHash != existing.ArtifactHash {
		oldFile, err = requireStudioFile(existing.ArtifactFileID, userID)
		if err != nil {
			return model.ScriptProjectDetail{}, err
		}
		uploaded, uploadErr := uploadStudioJSON(ctx, "scripts", "scripts", userID, id, body)
		if uploadErr != nil {
			return model.ScriptProjectDetail{}, uploadErr
		}
		project.ArtifactFileID = uploaded.ID
		newFile = &uploaded
	}
	if err := repository.UpdateScriptProjectWithLock(project, expectedRevision, newFile, existing.ArtifactFileID, conversations, messages); err != nil {
		if newFile != nil {
			_ = S3Delete(context.Background(), newFile.S3Key)
		}
		if errors.Is(err, repository.ErrConflict) {
			current, readErr := GetScriptProject(ctx, id, userID)
			if readErr == nil {
				return current, err
			}
		}
		return model.ScriptProjectDetail{}, err
	}
	if newFile != nil {
		_ = S3Delete(context.Background(), oldFile.S3Key)
	}
	project.Revision = existing.Revision + 1
	return scriptDetail(project, conversations, messages, snapshot), nil
}

func RenameScriptProject(ctx context.Context, id, userID, title string, expectedRevision uint64) (model.ScriptProjectSummary, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return model.ScriptProjectSummary{}, safeMessageError{message: "项目标题不能为空"}
	}
	existing, err := repository.GetScriptProject(id, userID)
	if err != nil {
		return model.ScriptProjectSummary{}, studioProjectError(err)
	}
	if existing.Revision != expectedRevision {
		return scriptSummary(existing), repository.ErrConflict
	}
	if err := repository.RenameScriptProjectWithLock(id, userID, title, expectedRevision, studioNow()); err != nil {
		if errors.Is(err, repository.ErrConflict) {
			current, readErr := repository.GetScriptProject(id, userID)
			if readErr == nil {
				return scriptSummary(current), err
			}
		}
		return model.ScriptProjectSummary{}, err
	}
	current, err := repository.GetScriptProject(id, userID)
	if err != nil {
		return model.ScriptProjectSummary{}, err
	}
	return scriptSummary(current), nil
}

func DeleteScriptProject(ctx context.Context, id, userID string) error {
	_, file, err := repository.DeleteScriptProject(id, userID)
	if err != nil {
		return studioProjectError(err)
	}
	_ = S3Delete(ctx, file.S3Key)
	return nil
}

func normalizeScriptWorkspace(id, userID, createdAt string, workspace ScriptProjectWorkspaceInput, fallbackTitle string) (model.ScriptProject, []model.ScriptConversation, []model.ScriptMessage, scriptArtifactSnapshot, []byte, error) {
	now := studioNow()
	title := strings.TrimSpace(workspace.Title)
	if title == "" {
		title = strings.TrimSpace(fallbackTitle)
	}
	if title == "" {
		title = "未命名剧本"
	}
	stage := strings.TrimSpace(workspace.CurrentStage)
	if stage == "" {
		stage = "collecting_config"
	}
	projectConfig, err := canonicalJSON(workspace.ProjectConfig, []byte("null"))
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "项目配置格式无效"}
	}
	configDraft, err := canonicalJSON(workspace.ConfigDraft, []byte("{}"))
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "项目配置草稿格式无效"}
	}
	storyReview, err := canonicalJSON(workspace.StorySkeletonReview, []byte("null"))
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "故事骨架审核格式无效"}
	}
	adaptationReview, err := canonicalJSON(workspace.AdaptationReview, []byte("null"))
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "改编策略审核格式无效"}
	}
	scripts, err := canonicalJSON(workspace.Scripts, []byte("[]"))
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "剧本列表格式无效"}
	}
	var scriptItems []json.RawMessage
	if err := json.Unmarshal(scripts, &scriptItems); err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "剧本列表格式无效"}
	}
	if len(workspace.Conversations) == 0 {
		conversationID := "conversation-" + uuid.NewString()
		workspace.Conversations = []ScriptConversationInput{{ID: conversationID, Title: "新对话", CreatedAt: now, UpdatedAt: now, Messages: []ScriptMessageInput{}}}
		workspace.ActiveConversationID = conversationID
	}
	conversations := make([]model.ScriptConversation, 0, len(workspace.Conversations))
	messages := make([]model.ScriptMessage, 0)
	activeFound := false
	for conversationPosition, input := range workspace.Conversations {
		conversationID := strings.TrimSpace(input.ID)
		if conversationID == "" {
			conversationID = "conversation-" + uuid.NewString()
		}
		conversationCreatedAt := input.CreatedAt
		if conversationCreatedAt == "" {
			conversationCreatedAt = now
		}
		conversationUpdatedAt := input.UpdatedAt
		if conversationUpdatedAt == "" {
			conversationUpdatedAt = conversationCreatedAt
		}
		conversationTitle := strings.TrimSpace(input.Title)
		if conversationTitle == "" {
			conversationTitle = "新对话"
		}
		conversations = append(conversations, model.ScriptConversation{ID: conversationID, ProjectID: id, UserID: userID, Title: conversationTitle, Position: conversationPosition, CreatedAt: conversationCreatedAt, UpdatedAt: conversationUpdatedAt})
		if conversationID == workspace.ActiveConversationID {
			activeFound = true
		}
		for messagePosition, inputMessage := range input.Messages {
			role := strings.TrimSpace(inputMessage.Role)
			if role != "user" && role != "assistant" {
				return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, safeMessageError{message: "对话消息角色无效"}
			}
			messageID := strings.TrimSpace(inputMessage.ID)
			if messageID == "" {
				messageID = "message-" + uuid.NewString()
			}
			messageCreatedAt := inputMessage.CreatedAt
			if messageCreatedAt == "" {
				messageCreatedAt = now
			}
			messages = append(messages, model.ScriptMessage{ID: messageID, ProjectID: id, ConversationID: conversationID, UserID: userID, Role: role, Content: inputMessage.Content, Position: messagePosition, CreatedAt: messageCreatedAt})
		}
	}
	activeConversationID := workspace.ActiveConversationID
	if !activeFound {
		activeConversationID = conversations[0].ID
	}
	snapshot := scriptArtifactSnapshot{StorySkeleton: workspace.StorySkeleton, StorySkeletonReview: storyReview, AdaptationStrategy: workspace.AdaptationStrategy, AdaptationReview: adaptationReview, Scripts: scripts}
	body, err := json.Marshal(snapshot)
	if err != nil {
		return model.ScriptProject{}, nil, nil, scriptArtifactSnapshot{}, nil, err
	}
	hash := sha256.Sum256(body)
	project := model.ScriptProject{
		ID:                   id,
		UserID:               userID,
		Title:                title,
		Source:               strings.TrimSpace(workspace.Source),
		CurrentStage:         stage,
		ProjectConfigJSON:    string(projectConfig),
		ConfigDraftJSON:      string(configDraft),
		StorySkeletonStatus:  defaultString(workspace.StorySkeletonStatus, "empty"),
		AdaptationStatus:     defaultString(workspace.AdaptationStatus, "empty"),
		ActiveConversationID: activeConversationID,
		Version:              workspace.Version,
		Revision:             1,
		ArtifactHash:         hex.EncodeToString(hash[:]),
		ScriptCount:          len(scriptItems),
		ConversationCount:    len(conversations),
		CreatedAt:            createdAt,
		UpdatedAt:            now,
	}
	return project, conversations, messages, snapshot, body, nil
}

func readScriptSnapshot(ctx context.Context, project model.ScriptProject, userID string) (scriptArtifactSnapshot, error) {
	file, err := requireStudioFile(project.ArtifactFileID, userID)
	if err != nil {
		return scriptArtifactSnapshot{}, err
	}
	body, err := S3Download(ctx, file.S3Key)
	if err != nil {
		return scriptArtifactSnapshot{}, err
	}
	defer body.Close()
	var snapshot scriptArtifactSnapshot
	if err := json.NewDecoder(body).Decode(&snapshot); err != nil {
		return scriptArtifactSnapshot{}, fmt.Errorf("decode script snapshot: %w", err)
	}
	return snapshot, nil
}

func requireStudioFile(id, userID string) (model.UserFile, error) {
	file, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return model.UserFile{}, err
	}
	if !ok {
		return model.UserFile{}, safeMessageError{message: "项目快照不存在"}
	}
	return file, nil
}

func scriptSummary(project model.ScriptProject) model.ScriptProjectSummary {
	return model.ScriptProjectSummary{ID: project.ID, Title: project.Title, Source: project.Source, CurrentStage: project.CurrentStage, ConversationCount: project.ConversationCount, ScriptCount: project.ScriptCount, Revision: project.Revision, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}
}

func scriptDetail(project model.ScriptProject, conversations []model.ScriptConversation, messages []model.ScriptMessage, snapshot scriptArtifactSnapshot) model.ScriptProjectDetail {
	messagesByConversation := make(map[string][]model.ScriptMessage, len(conversations))
	for _, message := range messages {
		messagesByConversation[message.ConversationID] = append(messagesByConversation[message.ConversationID], message)
	}
	views := make([]model.ScriptConversationView, len(conversations))
	activeMessages := []model.ScriptMessage{}
	for i, conversation := range conversations {
		conversationMessages := messagesByConversation[conversation.ID]
		if conversationMessages == nil {
			conversationMessages = []model.ScriptMessage{}
		}
		views[i] = model.ScriptConversationView{ID: conversation.ID, Title: conversation.Title, Messages: conversationMessages, CreatedAt: conversation.CreatedAt, UpdatedAt: conversation.UpdatedAt}
		if conversation.ID == project.ActiveConversationID {
			activeMessages = conversationMessages
		}
	}
	return model.ScriptProjectDetail{
		ScriptProjectSummary: scriptSummary(project),
		ProjectID:            project.ID,
		ProjectConfig:        json.RawMessage(project.ProjectConfigJSON),
		ConfigDraft:          json.RawMessage(project.ConfigDraftJSON),
		StorySkeleton:        snapshot.StorySkeleton,
		StorySkeletonStatus:  project.StorySkeletonStatus,
		StorySkeletonReview:  snapshot.StorySkeletonReview,
		AdaptationStrategy:   snapshot.AdaptationStrategy,
		AdaptationStatus:     project.AdaptationStatus,
		AdaptationReview:     snapshot.AdaptationReview,
		Scripts:              snapshot.Scripts,
		Messages:             activeMessages,
		Conversations:        views,
		ActiveConversationID: project.ActiveConversationID,
		Version:              project.Version,
	}
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
