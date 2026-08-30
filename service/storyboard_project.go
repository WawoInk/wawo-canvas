package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type CreateStoryboardProjectInput struct {
	Title        string          `json:"title"`
	Source       string          `json:"source"`
	Options      json.RawMessage `json:"options"`
	Model        string          `json:"model"`
	SourceHash   string          `json:"sourceHash"`
	DirectorPlan json.RawMessage `json:"directorPlan"`
	Document     json.RawMessage `json:"document"`
	Validation   json.RawMessage `json:"validation"`
}

type storyboardSnapshot struct {
	DirectorPlan json.RawMessage `json:"directorPlan"`
	Document     json.RawMessage `json:"document"`
	Validation   json.RawMessage `json:"validation"`
}

func ListStoryboardProjects(userID string) ([]model.StoryboardProjectSummary, error) {
	projects, err := repository.ListStoryboardProjects(userID)
	if err != nil {
		return nil, err
	}
	items := make([]model.StoryboardProjectSummary, len(projects))
	for i, project := range projects {
		items[i] = storyboardSummary(project)
	}
	return items, nil
}

func CreateStoryboardProject(ctx context.Context, userID string, input CreateStoryboardProjectInput) (model.StoryboardProjectDetail, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = "未命名分镜"
	}
	options, err := canonicalJSON(input.Options, []byte("{}"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜选项格式无效"}
	}
	directorPlan, err := canonicalJSON(input.DirectorPlan, []byte("null"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "导演规划格式无效"}
	}
	document, err := canonicalJSON(input.Document, []byte("null"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜文档格式无效"}
	}
	validation, err := canonicalJSON(input.Validation, []byte("null"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜校验格式无效"}
	}
	snapshot := storyboardSnapshot{DirectorPlan: directorPlan, Document: document, Validation: validation}
	body, err := json.Marshal(snapshot)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	id := "storyboard-" + uuid.NewString()
	file, err := uploadStudioJSON(ctx, "storyboards", "storyboards", userID, id, body)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	now := studioNow()
	validationStatus, sceneCount, shotCount := storyboardSummaryFields(document, validation)
	project := model.StoryboardProject{
		ID:               id,
		UserID:           userID,
		Title:            title,
		Source:           input.Source,
		OptionsJSON:      string(options),
		Model:            strings.TrimSpace(input.Model),
		SourceHash:       strings.TrimSpace(input.SourceHash),
		ValidationStatus: validationStatus,
		SceneCount:       sceneCount,
		ShotCount:        shotCount,
		ArtifactFileID:   file.ID,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := repository.CreateStoryboardProject(project, file); err != nil {
		_ = S3Delete(context.Background(), file.S3Key)
		return model.StoryboardProjectDetail{}, err
	}
	return storyboardDetail(project, snapshot), nil
}

func GetStoryboardProject(ctx context.Context, id, userID string) (model.StoryboardProjectDetail, error) {
	project, err := repository.GetStoryboardProject(id, userID)
	if err != nil {
		return model.StoryboardProjectDetail{}, studioProjectError(err)
	}
	snapshot, err := readStoryboardSnapshot(ctx, project, userID)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	return storyboardDetail(project, snapshot), nil
}

func DeleteStoryboardProject(ctx context.Context, id, userID string) error {
	_, file, err := repository.DeleteStoryboardProject(id, userID)
	if err != nil {
		return studioProjectError(err)
	}
	_ = S3Delete(ctx, file.S3Key)
	return nil
}

func readStoryboardSnapshot(ctx context.Context, project model.StoryboardProject, userID string) (storyboardSnapshot, error) {
	file, ok, err := repository.GetUserFileByID(project.ArtifactFileID, userID)
	if err != nil {
		return storyboardSnapshot{}, err
	}
	if !ok {
		return storyboardSnapshot{}, safeMessageError{message: "分镜快照不存在"}
	}
	body, err := S3Download(ctx, file.S3Key)
	if err != nil {
		return storyboardSnapshot{}, err
	}
	defer body.Close()
	var snapshot storyboardSnapshot
	if err := json.NewDecoder(body).Decode(&snapshot); err != nil {
		return storyboardSnapshot{}, fmt.Errorf("decode storyboard snapshot: %w", err)
	}
	return snapshot, nil
}

func storyboardSummary(project model.StoryboardProject) model.StoryboardProjectSummary {
	return model.StoryboardProjectSummary{ID: project.ID, Title: project.Title, Model: project.Model, SourceHash: project.SourceHash, SceneCount: project.SceneCount, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}
}

func storyboardDetail(project model.StoryboardProject, snapshot storyboardSnapshot) model.StoryboardProjectDetail {
	return model.StoryboardProjectDetail{
		StoryboardProjectSummary: storyboardSummary(project),
		Source:                   project.Source,
		Options:                  json.RawMessage(project.OptionsJSON),
		ValidationStatus:         project.ValidationStatus,
		ShotCount:                project.ShotCount,
		DirectorPlan:             snapshot.DirectorPlan,
		Document:                 snapshot.Document,
		Validation:               snapshot.Validation,
	}
}

func storyboardSummaryFields(document, validation json.RawMessage) (string, int, int) {
	var documentView struct {
		Scenes []struct {
			Segments []struct {
				Shots []json.RawMessage `json:"shots"`
			} `json:"segments"`
		} `json:"scenes"`
	}
	_ = json.Unmarshal(document, &documentView)
	shotCount := 0
	for _, scene := range documentView.Scenes {
		for _, segment := range scene.Segments {
			shotCount += len(segment.Shots)
		}
	}
	var validationView struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(validation, &validationView)
	return validationView.Status, len(documentView.Scenes), shotCount
}

func uploadStudioJSON(ctx context.Context, prefix, fileType, userID, entityID string, body []byte) (model.UserFile, error) {
	fileID := uuid.NewString()
	key := fmt.Sprintf("%s/%s/%s/%s.json", prefix, userID, entityID, fileID)
	if _, err := S3Upload(ctx, key, bytes.NewReader(body), "application/json"); err != nil {
		return model.UserFile{}, err
	}
	return model.UserFile{ID: fileID, UserID: userID, FileType: fileType, S3Key: key, OriginalName: entityID + ".json", MimeType: "application/json", Bytes: int64(len(body)), CreatedAt: studioNow()}, nil
}

func canonicalJSON(raw json.RawMessage, fallback []byte) (json.RawMessage, error) {
	if len(raw) == 0 {
		raw = fallback
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

func studioNow() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func studioProjectError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return safeMessageError{message: "项目不存在或无权操作"}
	}
	return err
}
