package router_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type storyboardSummaryView struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	Source           string          `json:"source"`
	Options          json.RawMessage `json:"options"`
	Model            string          `json:"model"`
	SourceHash       string          `json:"sourceHash"`
	ValidationStatus string          `json:"validationStatus"`
	SceneCount       int             `json:"sceneCount"`
	ShotCount        int             `json:"shotCount"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
}

type storyboardDetailView struct {
	storyboardSummaryView
	DirectorPlan json.RawMessage `json:"directorPlan"`
	Document     json.RawMessage `json:"document"`
	Validation   json.RawMessage `json:"validation"`
}

type scriptMessageView struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type scriptConversationView struct {
	ID        string              `json:"id"`
	Title     string              `json:"title"`
	Messages  []scriptMessageView `json:"messages"`
	CreatedAt string              `json:"createdAt"`
	UpdatedAt string              `json:"updatedAt"`
}

type scriptSummaryView struct {
	ID           string `json:"id"`
	ProjectID    string `json:"projectId"`
	Title        string `json:"title"`
	Source       string `json:"source"`
	CurrentStage string `json:"currentStage"`
	Version      int    `json:"version"`
	Revision     uint64 `json:"revision"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

type scriptDetailView struct {
	scriptSummaryView
	ProjectConfig        json.RawMessage          `json:"projectConfig"`
	ConfigDraft          json.RawMessage          `json:"configDraft"`
	StorySkeleton        string                   `json:"storySkeleton"`
	StorySkeletonStatus  string                   `json:"storySkeletonStatus"`
	StorySkeletonReview  json.RawMessage          `json:"storySkeletonReview"`
	AdaptationStrategy   string                   `json:"adaptationStrategy"`
	AdaptationStatus     string                   `json:"adaptationStatus"`
	AdaptationReview     json.RawMessage          `json:"adaptationReview"`
	Scripts              json.RawMessage          `json:"scripts"`
	Messages             []scriptMessageView      `json:"messages"`
	Conversations        []scriptConversationView `json:"conversations"`
	ActiveConversationID string                   `json:"activeConversationId"`
}

type persistenceConflictView[T any] struct {
	Current T `json:"current"`
}

func TestStoryboardPersistenceCreateListDetailOwnershipDeleteAndS3Prefix(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	server, first, second := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	payload := map[string]any{
		"id":         id,
		"title":      "第一集",
		"source":     "场景一：雨夜。",
		"options":    map[string]any{"aspectRatio": "9:16", "targetDurationSec": 60, "style": "电影叙事", "maxSegmentDurationSec": 15, "maxShotDurationSec": 8, "dialogueMustBeExact": true, "allowMusic": false},
		"model":      "test-model",
		"sourceHash": "source-hash-1",
		"directorPlan": map[string]any{
			"schemaVersion": "1.0", "title": "第一集", "sourceType": "script", "scenes": []any{map[string]any{"sceneNo": 1, "summary": "雨夜相遇"}},
		},
		"document": map[string]any{
			"schemaVersion": "1.0", "title": "第一集", "sourceType": "script", "aspectRatio": "9:16", "targetDurationSec": 60,
			"scenes": []any{map[string]any{"sceneNo": 1, "segments": []any{map[string]any{"segmentNo": 1, "shots": []any{map[string]any{"shotNo": 1}, map[string]any{"shotNo": 2}}}}}},
		},
		"validation": map[string]any{"status": "warning", "errors": []any{}, "warnings": []any{map[string]any{"code": "SHORT", "message": "偏短", "path": "scenes[0]"}}},
	}

	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, payload)
	if created.Code != 0 || created.Data.ID != id || created.Data.Title != "第一集" || created.Data.SceneCount != 1 || created.Data.ShotCount != 2 || created.Data.ValidationStatus != "warning" {
		t.Fatalf("create storyboard = %#v", created)
	}
	if bytes.Contains(mustJSON(t, created), []byte("s3Key")) {
		t.Fatalf("create response leaked s3 key: %#v", created)
	}
	keys := objectKeys(objectServer)
	wantPrefix := "/studio-persistence-test/storyboards/" + first.Data.User.ID + "/" + id + "/"
	if len(keys) != 1 || !strings.HasPrefix(keys[0], wantPrefix) || !strings.HasSuffix(keys[0], ".json") {
		t.Fatalf("storyboard s3 keys = %v, want prefix %q", keys, wantPrefix)
	}

	listed := doJSON[[]storyboardSummaryView](t, http.MethodGet, server.URL+"/api/v1/storyboards", first.Data.Token, nil)
	if listed.Code != 0 || len(listed.Data) != 1 || listed.Data[0].ID != id || listed.Data[0].SceneCount != 1 || listed.Data[0].ShotCount != 2 {
		t.Fatalf("list storyboards = %#v", listed)
	}
	detail := doJSON[storyboardDetailView](t, http.MethodGet, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if detail.Code != 0 || !bytes.Contains(detail.Data.DirectorPlan, []byte("雨夜相遇")) || !bytes.Contains(detail.Data.Document, []byte(`"shotNo":2`)) || !bytes.Contains(detail.Data.Validation, []byte(`"status":"warning"`)) {
		t.Fatalf("storyboard detail = %#v", detail)
	}

	otherList := doJSON[[]storyboardSummaryView](t, http.MethodGet, server.URL+"/api/v1/storyboards", second.Data.Token, nil)
	if otherList.Code != 0 || len(otherList.Data) != 0 {
		t.Fatalf("other user storyboard list = %#v", otherList)
	}
	otherDetail := doJSON[storyboardDetailView](t, http.MethodGet, server.URL+"/api/v1/storyboards/"+id, second.Data.Token, nil)
	if otherDetail.Code == 0 {
		t.Fatalf("other user read storyboard = %#v", otherDetail)
	}
	otherDelete := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, second.Data.Token, nil)
	if otherDelete.Code == 0 || objectServer.objectCount() != 1 {
		t.Fatalf("other user delete storyboard = %#v, objects=%d", otherDelete, objectServer.objectCount())
	}

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete storyboard = %#v, objects=%d", deleted, objectServer.objectCount())
	}
	afterDelete := doJSON[[]storyboardSummaryView](t, http.MethodGet, server.URL+"/api/v1/storyboards", first.Data.Token, nil)
	if afterDelete.Code != 0 || len(afterDelete.Data) != 0 {
		t.Fatalf("storyboard list after delete = %#v", afterDelete)
	}
}

func TestScriptPersistenceCreateListDetailUpdateRenameConflictOwnershipDeleteAndS3Prefix(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	server, first, second := studioPersistenceServer(t)
	defer server.Close()

	projectID := "project-" + uuid.NewString()
	conversationOne := "conversation-" + uuid.NewString()
	conversationTwo := "conversation-" + uuid.NewString()
	workspace := scriptPayload(projectID, conversationOne, conversationTwo)
	workspace["title"] = " 长篇改编 "
	workspace["source"] = " 第一章和第二章 "
	created := doJSON[scriptDetailView](t, http.MethodPost, server.URL+"/api/v1/scripts", first.Data.Token, workspace)
	if created.Code != 0 || created.Data.ID != projectID || created.Data.ProjectID != projectID || created.Data.Title != "长篇改编" || created.Data.Source != "第一章和第二章" || created.Data.CurrentStage != "ready_for_script" || created.Data.Version != 1 || created.Data.Revision != 1 || len(created.Data.Conversations) != 2 || len(created.Data.Messages) != 1 {
		t.Fatalf("create script = %#v", created)
	}
	createKeys := objectKeys(objectServer)
	wantPrefix := "/studio-persistence-test/scripts/" + first.Data.User.ID + "/" + projectID + "/"
	if len(createKeys) != 1 || !strings.HasPrefix(createKeys[0], wantPrefix) || !strings.HasSuffix(createKeys[0], ".json") {
		t.Fatalf("script create s3 keys = %v, want prefix %q", createKeys, wantPrefix)
	}
	firstArtifactKey := createKeys[0]

	status, raw := doRawRequest(t, http.MethodGet, server.URL+"/api/v1/scripts", first.Data.Token, "", nil)
	var listed apiResponse[[]map[string]json.RawMessage]
	if err := json.Unmarshal(raw, &listed); err != nil {
		t.Fatalf("decode script list: %v: %s", err, raw)
	}
	if status != http.StatusOK || listed.Code != 0 || len(listed.Data) != 1 {
		t.Fatalf("list scripts status=%d response=%#v", status, listed)
	}
	item := listed.Data[0]
	if _, ok := item["conversationCount"]; ok {
		t.Fatalf("script summary exposed conversationCount: %s", raw)
	}
	if _, ok := item["scriptCount"]; ok {
		t.Fatalf("script summary exposed scriptCount: %s", raw)
	}
	var summary scriptSummaryView
	if err := json.Unmarshal(mustJSON(t, item), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.ID != projectID || summary.ProjectID != projectID || summary.Version != 1 || summary.Revision != 1 {
		t.Fatalf("script summary = %#v", summary)
	}

	detail := doJSON[scriptDetailView](t, http.MethodGet, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, nil)
	if detail.Code != 0 || len(detail.Data.Conversations[0].Messages) != 2 || detail.Data.ActiveConversationID != conversationTwo || len(detail.Data.Messages) != 1 || detail.Data.Messages[0].ID != "message-3" || !bytes.Contains(detail.Data.Scripts, []byte("第1集")) {
		t.Fatalf("script detail = %#v", detail)
	}

	messageOnly := scriptPayload(projectID, conversationOne, conversationTwo)
	messageOnly["version"] = 2
	messageOnly["expectedRevision"] = 1
	conversations := messageOnly["conversations"].([]any)
	active := conversations[1].(map[string]any)
	active["messages"] = append(active["messages"].([]any), map[string]any{"id": "message-4", "role": "assistant", "content": "已完成", "createdAt": "2026-08-30T08:03:00Z"})
	updated := doJSON[scriptDetailView](t, http.MethodPut, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, messageOnly)
	if updated.Code != 0 || updated.Data.Revision != 2 || updated.Data.Version != 2 || len(updated.Data.Messages) != 2 || updated.Data.Messages[1].Content != "已完成" || objectServer.objectCount() != 1 || objectKeys(objectServer)[0] != firstArtifactKey {
		t.Fatalf("message-only update = %#v, keys=%v", updated, objectKeys(objectServer))
	}

	artifactWorkspace := scriptPayload(projectID, conversationOne, conversationTwo)
	artifactWorkspace["version"] = 3
	artifactWorkspace["storySkeleton"] = "新的故事骨架"
	artifactWorkspace["expectedRevision"] = 2
	artifactUpdated := doJSON[scriptDetailView](t, http.MethodPut, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, artifactWorkspace)
	keys := objectKeys(objectServer)
	if artifactUpdated.Code != 0 || artifactUpdated.Data.Revision != 3 || artifactUpdated.Data.Version != 3 || artifactUpdated.Data.StorySkeleton != "新的故事骨架" || len(keys) != 1 || keys[0] == firstArtifactKey {
		t.Fatalf("artifact update = %#v, keys=%v", artifactUpdated, keys)
	}
	currentArtifactKey := keys[0]

	conflicting := scriptPayload(projectID, conversationOne, conversationTwo)
	conflicting["adaptationStrategy"] = "冲突版本"
	conflicting["expectedRevision"] = 2
	status, raw = doRawRequest(t, http.MethodPut, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, "application/json", bytes.NewReader(mustJSON(t, conflicting)))
	var conflict apiResponse[persistenceConflictView[scriptDetailView]]
	if err := json.Unmarshal(raw, &conflict); err != nil {
		t.Fatalf("decode script conflict: %v: %s", err, raw)
	}
	var conflictEnvelope struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &conflictEnvelope); err != nil {
		t.Fatalf("decode script conflict envelope: %v: %s", err, raw)
	}
	if status != http.StatusConflict || conflict.Code != -1 || len(conflictEnvelope.Data) != 1 || conflict.Data.Current.Revision != 3 || conflict.Data.Current.ProjectID != projectID || len(conflict.Data.Current.Conversations) != 2 || conflict.Data.Current.StorySkeleton != "新的故事骨架" || objectServer.objectCount() != 1 || objectKeys(objectServer)[0] != currentArtifactKey {
		t.Fatalf("script conflict status=%d response=%#v keys=%v", status, conflict, objectKeys(objectServer))
	}

	renamed := doJSON[scriptDetailView](t, http.MethodPut, server.URL+"/api/v1/scripts/"+projectID+"/title", first.Data.Token, map[string]any{"title": "新标题", "expectedRevision": 3})
	if renamed.Code != 0 || renamed.Data.Title != "新标题" || renamed.Data.Revision != 4 || renamed.Data.ProjectID != projectID || len(renamed.Data.Conversations) != 2 || renamed.Data.StorySkeleton != "新的故事骨架" || objectKeys(objectServer)[0] != currentArtifactKey {
		t.Fatalf("rename script = %#v, keys=%v", renamed, objectKeys(objectServer))
	}

	status, raw = doRawRequest(t, http.MethodPut, server.URL+"/api/v1/scripts/"+projectID+"/title", first.Data.Token, "application/json", bytes.NewReader(mustJSON(t, map[string]any{"title": "过期标题", "expectedRevision": 3})))
	var renameConflict apiResponse[persistenceConflictView[scriptDetailView]]
	if err := json.Unmarshal(raw, &renameConflict); err != nil {
		t.Fatalf("decode rename conflict: %v: %s", err, raw)
	}
	if status != http.StatusConflict || renameConflict.Code != -1 || renameConflict.Data.Current.Revision != 4 || renameConflict.Data.Current.Title != "新标题" || len(renameConflict.Data.Current.Conversations) != 2 || renameConflict.Data.Current.StorySkeleton != "新的故事骨架" || objectKeys(objectServer)[0] != currentArtifactKey {
		t.Fatalf("rename conflict status=%d response=%#v keys=%v", status, renameConflict, objectKeys(objectServer))
	}

	otherList := doJSON[[]scriptSummaryView](t, http.MethodGet, server.URL+"/api/v1/scripts", second.Data.Token, nil)
	if otherList.Code != 0 || len(otherList.Data) != 0 {
		t.Fatalf("other user script list = %#v", otherList)
	}
	otherDetail := doJSON[scriptDetailView](t, http.MethodGet, server.URL+"/api/v1/scripts/"+projectID, second.Data.Token, nil)
	if otherDetail.Code == 0 {
		t.Fatalf("other user read script = %#v", otherDetail)
	}
	otherDelete := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/scripts/"+projectID, second.Data.Token, nil)
	if otherDelete.Code == 0 || objectServer.objectCount() != 1 {
		t.Fatalf("other user delete script = %#v, objects=%d", otherDelete, objectServer.objectCount())
	}

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete script = %#v, objects=%d", deleted, objectServer.objectCount())
	}
}

func setupStudioPersistence(t *testing.T) *objectStorageStub {
	t.Helper()
	previousJWTSecret := config.Cfg.JWTSecret
	previousRegion := config.Cfg.AmazonRegion
	previousURL := config.Cfg.AmazonS3URL
	previousAccessKey := config.Cfg.AmazonS3AccessKey
	previousSecretKey := config.Cfg.AmazonS3SecretKey
	config.Cfg.JWTSecret = "studio-persistence-test-secret"
	config.Cfg.AmazonRegion = "us-east-1"
	config.Cfg.AmazonS3URL = "https://studio-persistence-test.s3.amazonaws.com"
	config.Cfg.AmazonS3AccessKey = "test-access-key"
	config.Cfg.AmazonS3SecretKey = "test-secret-key"
	t.Cleanup(func() {
		config.Cfg.JWTSecret = previousJWTSecret
		config.Cfg.AmazonRegion = previousRegion
		config.Cfg.AmazonS3URL = previousURL
		config.Cfg.AmazonS3AccessKey = previousAccessKey
		config.Cfg.AmazonS3SecretKey = previousSecretKey
	})
	stub := newObjectStorageStub(t)
	t.Setenv("AWS_ENDPOINT_URL_S3", stub.URL)
	return stub
}

func studioPersistenceServer(t *testing.T) (*httptest.Server, apiResponse[model.AuthSession], apiResponse[model.AuthSession]) {
	t.Helper()
	firstUsername := "studio-first-" + uuid.NewString()
	secondUsername := "studio-second-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: firstUsername}, "password"); err != nil {
		t.Fatalf("create first user: %v", err)
	}
	if _, err := service.SaveUser(model.User{Username: secondUsername}, "password"); err != nil {
		t.Fatalf("create second user: %v", err)
	}
	server := httptest.NewServer(router.New())
	first := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": firstUsername, "password": "password"})
	second := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": secondUsername, "password": "password"})
	return server, first, second
}

func scriptPayload(projectID, conversationOne, conversationTwo string) map[string]any {
	return map[string]any{
		"id":           projectID,
		"projectId":    projectID,
		"title":        "长篇改编",
		"source":       "第一章和第二章",
		"currentStage": "ready_for_script",
		"projectConfig": map[string]any{
			"totalEpisodes": 12, "episodeMinutes": 3, "startChapter": 1, "endChapter": 2, "chapterIndexes": []int{1, 2}, "platform": "短视频", "aspectRatio": "9:16", "style": "悬疑", "paywall": "第6集", "wordsPerEpisode": 450,
		},
		"configDraft":          map[string]any{"totalEpisodes": 12, "episodeMinutes": 3},
		"storySkeleton":        "故事骨架",
		"storySkeletonStatus":  "approved",
		"storySkeletonReview":  map[string]any{"artifactType": "story_skeleton", "artifactVersion": 1, "grade": "A", "summary": "通过"},
		"adaptationStrategy":   "改编策略",
		"adaptationStatus":     "approved",
		"adaptationReview":     map[string]any{"artifactType": "adaptation_strategy", "artifactVersion": 1, "grade": "B", "summary": "可用"},
		"scripts":              []any{map[string]any{"episodeNumber": 1, "name": "第1集", "content": "正文", "sourceChapterIndexes": []int{1}, "version": 1}},
		"activeConversationId": conversationTwo,
		"version":              1,
		"conversations": []any{
			map[string]any{"id": conversationOne, "title": "主线", "createdAt": "2026-08-30T08:00:00Z", "updatedAt": "2026-08-30T08:01:00Z", "messages": []any{
				map[string]any{"id": "message-1", "role": "user", "content": "分析主线", "createdAt": "2026-08-30T08:00:00Z"},
				map[string]any{"id": "message-2", "role": "assistant", "content": "主线已分析", "createdAt": "2026-08-30T08:01:00Z"},
			}},
			map[string]any{"id": conversationTwo, "title": "分集", "createdAt": "2026-08-30T08:02:00Z", "updatedAt": "2026-08-30T08:02:00Z", "messages": []any{
				map[string]any{"id": "message-3", "role": "user", "content": "继续拆解", "createdAt": "2026-08-30T08:02:00Z"},
			}},
		},
	}
}

func objectKeys(stub *objectStorageStub) []string {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	keys := make([]string, 0, len(stub.objects))
	for key := range stub.objects {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
