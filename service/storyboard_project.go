package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type StoryboardProjectInput struct {
	ID           string          `json:"id"`
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

func CreateStoryboardProject(ctx context.Context, userID string, input StoryboardProjectInput) (model.StoryboardProjectDetail, error) {
	id := strings.TrimSpace(input.ID)
	if id == "" {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "项目 ID 无效"}
	}
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
	document, err := normalizeStoryboardDocument(input.Document, nil)
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜文档格式无效"}
	}
	validation, err := canonicalJSON(input.Validation, []byte("null"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜校验格式无效"}
	}
	snapshot := storyboardSnapshot{DirectorPlan: directorPlan, Document: document, Validation: validation}
	body, hash, err := storyboardSnapshotBody(snapshot)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	file, err := uploadStudioJSON(ctx, "storyboards", "storyboards", userID, id, body)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	now := studioNow()
	validationStatus, sceneCount, shotCount := storyboardSummaryFields(document, validation)
	project := model.StoryboardProject{
		ID: id, UserID: userID, Title: title, Source: input.Source, OptionsJSON: string(options), Model: strings.TrimSpace(input.Model), SourceHash: strings.TrimSpace(input.SourceHash),
		Status: storyboardStatus(document), Revision: 1, ValidationStatus: validationStatus, SceneCount: sceneCount, ShotCount: shotCount,
		ArtifactFileID: file.ID, ArtifactHash: hash, CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateStoryboardProject(project, file); err != nil {
		_ = S3Delete(context.Background(), file.S3Key)
		return model.StoryboardProjectDetail{}, err
	}
	return storyboardDetail(project, snapshot), nil
}

func GetStoryboardProject(ctx context.Context, id, userID string) (model.StoryboardProjectDetail, error) {
	var lastErr error
	for range 3 {
		project, err := repository.GetStoryboardProject(id, userID)
		if err != nil {
			return model.StoryboardProjectDetail{}, studioProjectError(err)
		}
		snapshot, err := readStoryboardSnapshot(ctx, project, userID)
		if err == nil {
			return storyboardDetail(project, snapshot), nil
		}
		lastErr = err
		latest, latestErr := repository.GetStoryboardProject(id, userID)
		if latestErr != nil {
			return model.StoryboardProjectDetail{}, studioProjectError(latestErr)
		}
		if latest.Revision == project.Revision && latest.ArtifactFileID == project.ArtifactFileID {
			return model.StoryboardProjectDetail{}, err
		}
	}
	return model.StoryboardProjectDetail{}, lastErr
}

func UpdateStoryboardProject(ctx context.Context, id, userID string, input StoryboardProjectInput, expectedRevision uint64) (model.StoryboardProjectDetail, error) {
	if strings.TrimSpace(input.ID) != id {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "项目 ID 无效"}
	}
	existing, err := repository.GetStoryboardProject(id, userID)
	if err != nil {
		return model.StoryboardProjectDetail{}, studioProjectError(err)
	}
	if existing.Revision != expectedRevision {
		current, readErr := GetStoryboardProject(ctx, id, userID)
		if readErr != nil {
			return model.StoryboardProjectDetail{}, readErr
		}
		return current, repository.ErrConflict
	}
	existingSnapshot, err := readStoryboardSnapshot(ctx, existing, userID)
	if err != nil {
		return storyboardUpdateReadError(ctx, id, userID, expectedRevision, err)
	}
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
	document, err := normalizeStoryboardDocument(input.Document, existingSnapshot.Document)
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜文档格式无效"}
	}
	validation, err := canonicalJSON(input.Validation, []byte("null"))
	if err != nil {
		return model.StoryboardProjectDetail{}, safeMessageError{message: "分镜校验格式无效"}
	}
	snapshot := storyboardSnapshot{DirectorPlan: directorPlan, Document: document, Validation: validation}
	body, hash, err := storyboardSnapshotBody(snapshot)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	validationStatus, sceneCount, shotCount := storyboardSummaryFields(document, validation)
	project := model.StoryboardProject{
		ID: id, UserID: userID, Title: title, Source: input.Source, OptionsJSON: string(options), Model: strings.TrimSpace(input.Model), SourceHash: strings.TrimSpace(input.SourceHash),
		Status: storyboardStatus(document), Revision: existing.Revision + 1, ValidationStatus: validationStatus, SceneCount: sceneCount, ShotCount: shotCount,
		ArtifactFileID: existing.ArtifactFileID, ArtifactHash: hash, CreatedAt: existing.CreatedAt, UpdatedAt: studioNow(),
	}
	var newFile *model.UserFile
	var oldFile model.UserFile
	if hash != existing.ArtifactHash {
		oldFile, err = requireStudioFile(existing.ArtifactFileID, userID)
		if err != nil {
			return storyboardUpdateReadError(ctx, id, userID, expectedRevision, err)
		}
		uploaded, uploadErr := uploadStudioJSON(ctx, "storyboards", "storyboards", userID, id, body)
		if uploadErr != nil {
			return model.StoryboardProjectDetail{}, uploadErr
		}
		project.ArtifactFileID = uploaded.ID
		newFile = &uploaded
	}
	if err := repository.UpdateStoryboardProjectCAS(project, expectedRevision, newFile, existing.ArtifactFileID); err != nil {
		if newFile != nil {
			referenced, referenceErr := repository.StoryboardProjectReferencesFile(newFile.ID)
			if referenceErr == nil && referenced {
				return GetStoryboardProject(ctx, id, userID)
			}
			if referenceErr == nil {
				_ = S3Delete(context.Background(), newFile.S3Key)
			}
		}
		if errors.Is(err, repository.ErrConflict) {
			current, readErr := GetStoryboardProject(ctx, id, userID)
			if readErr != nil {
				return model.StoryboardProjectDetail{}, readErr
			}
			return current, err
		}
		return model.StoryboardProjectDetail{}, err
	}
	if newFile != nil {
		_ = S3Delete(context.Background(), oldFile.S3Key)
	}
	return storyboardDetail(project, snapshot), nil
}

func storyboardUpdateReadError(ctx context.Context, id, userID string, expectedRevision uint64, cause error) (model.StoryboardProjectDetail, error) {
	current, err := GetStoryboardProject(ctx, id, userID)
	if err != nil {
		return model.StoryboardProjectDetail{}, err
	}
	if current.Revision != expectedRevision {
		return current, repository.ErrConflict
	}
	return model.StoryboardProjectDetail{}, cause
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
	return model.StoryboardProjectSummary{
		ID: project.ID, Title: project.Title, Source: project.Source, Options: json.RawMessage(project.OptionsJSON), Model: project.Model, SourceHash: project.SourceHash,
		Status: project.Status, Revision: project.Revision, ValidationStatus: project.ValidationStatus, SceneCount: project.SceneCount, ShotCount: project.ShotCount,
		CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt,
	}
}

func storyboardDetail(project model.StoryboardProject, snapshot storyboardSnapshot) model.StoryboardProjectDetail {
	return model.StoryboardProjectDetail{StoryboardProjectSummary: storyboardSummary(project), DirectorPlan: snapshot.DirectorPlan, Document: snapshot.Document, Validation: snapshot.Validation}
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

func storyboardSnapshotBody(snapshot storyboardSnapshot) ([]byte, string, error) {
	body, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", err
	}
	hash := sha256.Sum256(body)
	return body, hex.EncodeToString(hash[:]), nil
}

func storyboardStatus(document json.RawMessage) string {
	if bytes.Equal(document, []byte("null")) {
		return "draft"
	}
	return "ready"
}

func normalizeStoryboardDocument(raw, existing json.RawMessage) (json.RawMessage, error) {
	canonical, err := canonicalJSON(raw, []byte("null"))
	if err != nil || bytes.Equal(canonical, []byte("null")) {
		return canonical, err
	}
	var value any
	if err := json.Unmarshal(canonical, &value); err != nil {
		return nil, err
	}
	document, ok := value.(map[string]any)
	if !ok {
		return canonical, nil
	}
	var previous map[string]any
	if len(existing) > 0 && !bytes.Equal(existing, []byte("null")) {
		var previousValue any
		if json.Unmarshal(existing, &previousValue) == nil {
			previous, _ = previousValue.(map[string]any)
		}
	}
	used := map[string]bool{}
	sceneValues := storyboardEntities(document, "scenes")
	previousScenesByID := storyboardEntitiesByID(previous, "scenes")
	previousScenesByNumber := storyboardEntitiesByNumber(previous, "scenes", "sceneNo")
	reservedScenes := storyboardReservedEntityIDs(sceneValues, previousScenesByID)
	for _, sceneValue := range sceneValues {
		scene, ok := sceneValue.(map[string]any)
		if !ok {
			continue
		}
		previousScene := storyboardPreviousEntity(scene, previousScenesByID, previousScenesByNumber, "sceneNo", reservedScenes, used)
		scene["id"] = storyboardEntityID(previousScene, used)

		segmentValues := storyboardEntities(scene, "segments")
		previousSegmentsByID := storyboardEntitiesByID(previousScene, "segments")
		previousSegmentsByNumber := storyboardEntitiesByNumber(previousScene, "segments", "segmentNo")
		reservedSegments := storyboardReservedEntityIDs(segmentValues, previousSegmentsByID)
		for _, segmentValue := range segmentValues {
			segment, ok := segmentValue.(map[string]any)
			if !ok {
				continue
			}
			previousSegment := storyboardPreviousEntity(segment, previousSegmentsByID, previousSegmentsByNumber, "segmentNo", reservedSegments, used)
			segment["id"] = storyboardEntityID(previousSegment, used)

			shotValues := storyboardEntities(segment, "shots")
			previousShotsByID := storyboardEntitiesByID(previousSegment, "shots")
			previousShotsByNumber := storyboardEntitiesByNumber(previousSegment, "shots", "shotNo")
			reservedShots := storyboardReservedEntityIDs(shotValues, previousShotsByID)
			for _, shotValue := range shotValues {
				shot, ok := shotValue.(map[string]any)
				if !ok {
					continue
				}
				previousShot := storyboardPreviousEntity(shot, previousShotsByID, previousShotsByNumber, "shotNo", reservedShots, used)
				shot["id"] = storyboardEntityID(previousShot, used)
			}
		}
	}
	return json.Marshal(document)
}

func storyboardEntities(parent map[string]any, field string) []any {
	if parent == nil {
		return nil
	}
	items, _ := parent[field].([]any)
	return items
}

func storyboardEntitiesByID(parent map[string]any, field string) map[string]map[string]any {
	items := map[string]map[string]any{}
	for _, value := range storyboardEntities(parent, field) {
		entity, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if id := storyboardEntityStringID(entity); id != "" {
			items[id] = entity
		}
	}
	return items
}

func storyboardEntitiesByNumber(parent map[string]any, field, numberField string) map[string]map[string]any {
	items := map[string]map[string]any{}
	for _, value := range storyboardEntities(parent, field) {
		entity, ok := value.(map[string]any)
		if !ok {
			continue
		}
		key := storyboardEntityNumber(entity, numberField)
		if key != "" {
			items[key] = entity
		}
	}
	return items
}

func storyboardReservedEntityIDs(values []any, previousByID map[string]map[string]any) map[string]bool {
	reserved := map[string]bool{}
	for _, value := range values {
		entity, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if id := storyboardEntityStringID(entity); previousByID[id] != nil {
			reserved[id] = true
		}
	}
	return reserved
}

func storyboardPreviousEntity(entity map[string]any, previousByID, previousByNumber map[string]map[string]any, numberField string, reserved, used map[string]bool) map[string]any {
	if id := storyboardEntityStringID(entity); id != "" {
		if previous := previousByID[id]; previous != nil && !used[id] {
			return previous
		}
	}
	previous := previousByNumber[storyboardEntityNumber(entity, numberField)]
	previousID := storyboardEntityStringID(previous)
	if previous == nil || reserved[previousID] || used[previousID] {
		return nil
	}
	return previous
}

func storyboardEntityNumber(entity map[string]any, field string) string {
	number, ok := entity[field].(float64)
	if !ok {
		return ""
	}
	return strconv.FormatFloat(number, 'f', -1, 64)
}

func storyboardEntityStringID(entity map[string]any) string {
	if entity == nil {
		return ""
	}
	id, _ := entity["id"].(string)
	return strings.TrimSpace(id)
}

func storyboardEntityID(previous map[string]any, used map[string]bool) string {
	if id := storyboardEntityStringID(previous); id != "" && !used[id] {
		used[id] = true
		return id
	}
	for {
		id := uuid.NewString()
		if !used[id] {
			used[id] = true
			return id
		}
	}
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

type studioProjectNotFoundError struct{}

func (*studioProjectNotFoundError) Error() string       { return "studio project not found" }
func (*studioProjectNotFoundError) SafeMessage() string { return "项目不存在或无权操作" }

func IsStudioProjectNotFound(err error) bool {
	var target *studioProjectNotFoundError
	return errors.As(err, &target)
}

func IsStudioProjectConflict(err error) bool {
	return errors.Is(err, repository.ErrConflict)
}

func studioProjectError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &studioProjectNotFoundError{}
	}
	return err
}
