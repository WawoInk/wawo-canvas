package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
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
	Status           string          `json:"status"`
	Revision         uint64          `json:"revision"`
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

func TestStoryboardPersistenceDraftCreateListDetailOwnershipDeleteAndS3Prefix(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	server, first, second := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	payload := map[string]any{
		"id": id, "title": "第一集", "source": "场景一：雨夜。", "options": map[string]any{"aspectRatio": "9:16"}, "model": "test-model", "sourceHash": "source-hash-1",
	}
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, payload)
	if created.Code != 0 || created.Data.ID != id || created.Data.Status != "draft" || created.Data.Revision != 1 || created.Data.SceneCount != 0 || created.Data.ShotCount != 0 {
		t.Fatalf("create draft storyboard = %#v", created)
	}
	if string(created.Data.DirectorPlan) != "null" || string(created.Data.Document) != "null" || string(created.Data.Validation) != "null" {
		t.Fatalf("draft storyboard artifacts = plan:%s document:%s validation:%s", created.Data.DirectorPlan, created.Data.Document, created.Data.Validation)
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
	if listed.Code != 0 || len(listed.Data) != 1 || listed.Data[0].ID != id || listed.Data[0].Status != "draft" || listed.Data[0].Revision != 1 {
		t.Fatalf("list draft storyboards = %#v", listed)
	}
	detail := doJSON[storyboardDetailView](t, http.MethodGet, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if detail.Code != 0 || detail.Data.Status != "draft" || string(detail.Data.Document) != "null" {
		t.Fatalf("draft storyboard detail = %#v", detail)
	}

	otherList := doJSON[[]storyboardSummaryView](t, http.MethodGet, server.URL+"/api/v1/storyboards", second.Data.Token, nil)
	if otherList.Code != 0 || len(otherList.Data) != 0 {
		t.Fatalf("other user storyboard list = %#v", otherList)
	}
	status, raw := doRawRequest(t, http.MethodGet, server.URL+"/api/v1/storyboards/"+id, second.Data.Token, "", nil)
	if status != http.StatusNotFound {
		t.Fatalf("other user read storyboard status=%d body=%s", status, raw)
	}
	status, raw = doRawRequest(t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, second.Data.Token, "", nil)
	if status != http.StatusNotFound || objectServer.objectCount() != 1 {
		t.Fatalf("other user delete storyboard status=%d body=%s objects=%d", status, raw, objectServer.objectCount())
	}

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete storyboard = %#v, objects=%d", deleted, objectServer.objectCount())
	}
	listed = doJSON[[]storyboardSummaryView](t, http.MethodGet, server.URL+"/api/v1/storyboards", first.Data.Token, nil)
	if listed.Code != 0 || len(listed.Data) != 0 {
		t.Fatalf("storyboard list after delete = %#v", listed)
	}
}

func TestStoryboardPersistenceUpdateConflictStableIDsOwnershipAndArtifactSafety(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	server, first, second := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	payload := storyboardPayload(id)
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, payload)
	if created.Code != 0 || created.Data.Status != "ready" || created.Data.Revision != 1 || created.Data.SceneCount != 1 || created.Data.ShotCount != 2 {
		t.Fatalf("create ready storyboard = %#v", created)
	}
	createdDocument := decodeStoryboardDocument(t, created.Data.Document)
	assertGeneratedStoryboardIDs(t, createdDocument, "model-id")
	createdAt := created.Data.CreatedAt
	originalKey := objectKeys(objectServer)[0]

	missingRevision := storyboardPayload(id)
	missingRevision["title"] = "不应更新"
	status, raw := doRawRequest(t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, "application/json", bytes.NewReader(mustJSON(t, missingRevision)))
	var invalid apiResponse[storyboardDetailView]
	if err := json.Unmarshal(raw, &invalid); err != nil {
		t.Fatalf("decode missing revision response: %v: %s", err, raw)
	}
	if status != http.StatusOK || invalid.Code == 0 || objectKeys(objectServer)[0] != originalKey {
		t.Fatalf("missing revision status=%d response=%#v keys=%v", status, invalid, objectKeys(objectServer))
	}

	metadataUpdate := storyboardPayload(id)
	metadataUpdate["title"] = "第一集（修订）"
	metadataUpdate["expectedRevision"] = 1
	updated := doJSON[storyboardDetailView](t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, metadataUpdate)
	if updated.Code != 0 || updated.Data.Title != "第一集（修订）" || updated.Data.Revision != 2 || updated.Data.CreatedAt != createdAt || objectKeys(objectServer)[0] != originalKey {
		t.Fatalf("metadata-only storyboard update = %#v keys=%v", updated, objectKeys(objectServer))
	}
	updatedDocument := decodeStoryboardDocument(t, updated.Data.Document)
	assertSameStoryboardIDs(t, createdDocument, updatedDocument)

	regenerated := storyboardPayload(id)
	regenerated["title"] = "第一集（再生成）"
	regenerated["expectedRevision"] = 2
	document := regenerated["document"].(map[string]any)
	scene := document["scenes"].([]any)[0].(map[string]any)
	segment := scene["segments"].([]any)[0].(map[string]any)
	segment["shots"] = append(segment["shots"].([]any), map[string]any{"id": "model-id", "shotNo": 3, "visual": "新镜头"})
	regeneratedResult := doJSON[storyboardDetailView](t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, regenerated)
	if regeneratedResult.Code != 0 || regeneratedResult.Data.Revision != 3 || regeneratedResult.Data.ShotCount != 3 || objectServer.objectCount() != 1 {
		t.Fatalf("regenerated storyboard = %#v objects=%d", regeneratedResult, objectServer.objectCount())
	}
	regeneratedDocument := decodeStoryboardDocument(t, regeneratedResult.Data.Document)
	assertSameStoryboardIDs(t, updatedDocument, regeneratedDocument)
	newShotID := regeneratedDocument.Scenes[0].Segments[0].Shots[2].ID
	if newShotID == "" || newShotID == "model-id" {
		t.Fatalf("new shot id = %q", newShotID)
	}
	if _, err := uuid.Parse(newShotID); err != nil {
		t.Fatalf("new shot id is not uuid: %q: %v", newShotID, err)
	}
	regeneratedKey := objectKeys(objectServer)[0]
	if regeneratedKey == originalKey {
		t.Fatalf("changed artifact kept old key %q", regeneratedKey)
	}

	stale := storyboardPayload(id)
	stale["title"] = "过期修改"
	stale["expectedRevision"] = 2
	status, raw = doRawRequest(t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, "application/json", bytes.NewReader(mustJSON(t, stale)))
	var conflict apiResponse[persistenceConflictView[storyboardDetailView]]
	if err := json.Unmarshal(raw, &conflict); err != nil {
		t.Fatalf("decode storyboard conflict: %v: %s", err, raw)
	}
	if status != http.StatusConflict || conflict.Code != -1 || conflict.Data.Current.Revision != 3 || conflict.Data.Current.Title != "第一集（再生成）" || objectKeys(objectServer)[0] != regeneratedKey {
		t.Fatalf("storyboard conflict status=%d response=%#v keys=%v", status, conflict, objectKeys(objectServer))
	}
	assertSameStoryboardIDs(t, regeneratedDocument, decodeStoryboardDocument(t, conflict.Data.Current.Document))

	owned := storyboardPayload(id)
	owned["expectedRevision"] = 3
	status, raw = doRawRequest(t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, second.Data.Token, "application/json", bytes.NewReader(mustJSON(t, owned)))
	if status != http.StatusNotFound || objectKeys(objectServer)[0] != regeneratedKey {
		t.Fatalf("other user update storyboard status=%d body=%s keys=%v", status, raw, objectKeys(objectServer))
	}

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete updated storyboard = %#v objects=%d", deleted, objectServer.objectCount())
	}
}

func TestStoryboardPersistenceConcurrentContentUpdateReturnsCompleteConflict(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	gate := newStoryboardObjectGate(t, objectServer.URL)
	t.Setenv("AWS_ENDPOINT_URL_S3", gate.URL)
	server, first, _ := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, storyboardPayload(id))
	if created.Code != 0 || created.Data.Revision != 1 {
		t.Fatalf("create storyboard = %#v", created)
	}

	entered, release := gate.blockNext(http.MethodGet)
	stale := storyboardPayload(id)
	stale["title"] = "过期并发更新"
	stale["expectedRevision"] = 1
	staleResult := asyncJSONRequest(http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, stale)
	waitForSignal(t, entered, "stale update artifact read")

	winner := storyboardPayload(id)
	winner["title"] = "并发胜出版本"
	winner["expectedRevision"] = 1
	winnerDocument := winner["document"].(map[string]any)
	winnerScene := winnerDocument["scenes"].([]any)[0].(map[string]any)
	winnerSegment := winnerScene["segments"].([]any)[0].(map[string]any)
	winnerSegment["shots"] = append(winnerSegment["shots"].([]any), map[string]any{"shotNo": 3, "visual": "胜出镜头"})
	won := doJSON[storyboardDetailView](t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, winner)
	if won.Code != 0 || won.Data.Revision != 2 || won.Data.ShotCount != 3 {
		t.Fatalf("winning storyboard update = %#v", won)
	}

	close(release)
	result := waitForAsyncRequest(t, staleResult)
	var conflict apiResponse[persistenceConflictView[storyboardDetailView]]
	if err := json.Unmarshal(result.body, &conflict); err != nil {
		t.Fatalf("decode concurrent storyboard conflict: %v: %s", err, result.body)
	}
	if result.status != http.StatusConflict || conflict.Code != -1 || conflict.Data.Current.ID != id || conflict.Data.Current.Title != "并发胜出版本" || conflict.Data.Current.Revision != 2 || conflict.Data.Current.ShotCount != 3 {
		t.Fatalf("concurrent storyboard conflict status=%d response=%#v", result.status, conflict)
	}
	assertSameStoryboardIDs(t, decodeStoryboardDocument(t, won.Data.Document), decodeStoryboardDocument(t, conflict.Data.Current.Document))
	if objectServer.objectCount() != 1 {
		t.Fatalf("concurrent storyboard objects=%d keys=%v", objectServer.objectCount(), objectKeys(objectServer))
	}
}

func TestStoryboardPersistenceConcurrentDeleteReturnsNotFoundAndCleansRolledBackUpload(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	gate := newStoryboardObjectGate(t, objectServer.URL)
	t.Setenv("AWS_ENDPOINT_URL_S3", gate.URL)
	server, first, _ := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, storyboardPayload(id))
	if created.Code != 0 || created.Data.Revision != 1 {
		t.Fatalf("create storyboard = %#v", created)
	}

	entered, release := gate.blockNext(http.MethodPut)
	update := storyboardPayload(id)
	update["expectedRevision"] = 1
	document := update["document"].(map[string]any)
	scene := document["scenes"].([]any)[0].(map[string]any)
	segment := scene["segments"].([]any)[0].(map[string]any)
	segment["shots"] = append(segment["shots"].([]any), map[string]any{"shotNo": 3, "visual": "删除竞态镜头"})
	updateResult := asyncJSONRequest(http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, update)
	waitForSignal(t, entered, "concurrent update artifact upload")

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("concurrent delete = %#v objects=%d", deleted, objectServer.objectCount())
	}

	close(release)
	result := waitForAsyncRequest(t, updateResult)
	var response apiResponse[storyboardDetailView]
	if err := json.Unmarshal(result.body, &response); err != nil {
		t.Fatalf("decode concurrent delete response: %v: %s", err, result.body)
	}
	if result.status != http.StatusNotFound || response.Code == 0 {
		t.Fatalf("concurrent delete update status=%d response=%#v", result.status, response)
	}
	if objectServer.objectCount() != 0 {
		t.Fatalf("rolled-back upload was not cleaned: keys=%v", objectKeys(objectServer))
	}
}

func TestStoryboardPersistenceFailedReplacementKeepsCurrentArtifact(t *testing.T) {
	objectServer := setupStudioPersistence(t)
	server, first, _ := studioPersistenceServer(t)
	defer server.Close()

	id := "storyboard-" + uuid.NewString()
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", first.Data.Token, storyboardPayload(id))
	createdDocument := decodeStoryboardDocument(t, created.Data.Document)
	originalKey := objectKeys(objectServer)[0]
	cleanup := rejectStoryboardProjectUpdates(t)
	defer cleanup()

	update := storyboardPayload(id)
	update["expectedRevision"] = 1
	document := update["document"].(map[string]any)
	scene := document["scenes"].([]any)[0].(map[string]any)
	segment := scene["segments"].([]any)[0].(map[string]any)
	segment["shots"] = append(segment["shots"].([]any), map[string]any{"shotNo": 3, "visual": "事务失败的新镜头"})
	status, raw := doRawRequest(t, http.MethodPut, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, "application/json", bytes.NewReader(mustJSON(t, update)))
	var failed apiResponse[storyboardDetailView]
	if err := json.Unmarshal(raw, &failed); err != nil {
		t.Fatalf("decode failed replacement response: %v: %s", err, raw)
	}
	if status != http.StatusOK || failed.Code == 0 || objectServer.objectCount() != 1 || objectKeys(objectServer)[0] != originalKey {
		t.Fatalf("failed replacement status=%d response=%#v keys=%v", status, failed, objectKeys(objectServer))
	}

	current := doJSON[storyboardDetailView](t, http.MethodGet, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if current.Code != 0 || current.Data.Revision != 1 || current.Data.ShotCount != 2 {
		t.Fatalf("current storyboard after failed replacement = %#v", current)
	}
	assertSameStoryboardIDs(t, createdDocument, decodeStoryboardDocument(t, current.Data.Document))
	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+id, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete storyboard after failed replacement = %#v objects=%d", deleted, objectServer.objectCount())
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
	if detail.Code != 0 || len(detail.Data.Conversations[0].Messages) != 2 || detail.Data.ActiveConversationID != conversationTwo || len(detail.Data.Messages) != 1 || detail.Data.Messages[0].ID != "message-3-"+projectID || !bytes.Contains(detail.Data.Scripts, []byte("第1集")) {
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
	status, raw = doRawRequest(t, http.MethodGet, server.URL+"/api/v1/scripts/"+projectID, second.Data.Token, "", nil)
	var otherDetail apiResponse[scriptDetailView]
	if err := json.Unmarshal(raw, &otherDetail); err != nil {
		t.Fatalf("decode other script detail: %v: %s", err, raw)
	}
	if status != http.StatusNotFound || otherDetail.Code == 0 {
		t.Fatalf("other user read script status=%d response=%#v", status, otherDetail)
	}
	status, raw = doRawRequest(t, http.MethodDelete, server.URL+"/api/v1/scripts/"+projectID, second.Data.Token, "", nil)
	var otherDelete apiResponse[map[string]any]
	if err := json.Unmarshal(raw, &otherDelete); err != nil {
		t.Fatalf("decode other script delete: %v: %s", err, raw)
	}
	if status != http.StatusNotFound || otherDelete.Code == 0 || objectServer.objectCount() != 1 {
		t.Fatalf("other user delete script status=%d response=%#v, objects=%d", status, otherDelete, objectServer.objectCount())
	}

	deleted := doJSON[map[string]any](t, http.MethodDelete, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, nil)
	if deleted.Code != 0 || objectServer.objectCount() != 0 {
		t.Fatalf("delete script = %#v, objects=%d", deleted, objectServer.objectCount())
	}
	status, raw = doRawRequest(t, http.MethodGet, server.URL+"/api/v1/scripts/"+projectID, first.Data.Token, "", nil)
	if status != http.StatusNotFound {
		t.Fatalf("deleted script detail status=%d body=%s", status, raw)
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
				map[string]any{"id": "message-1-" + projectID, "role": "user", "content": "分析主线", "createdAt": "2026-08-30T08:00:00Z"},
				map[string]any{"id": "message-2-" + projectID, "role": "assistant", "content": "主线已分析", "createdAt": "2026-08-30T08:01:00Z"},
			}},
			map[string]any{"id": conversationTwo, "title": "分集", "createdAt": "2026-08-30T08:02:00Z", "updatedAt": "2026-08-30T08:02:00Z", "messages": []any{
				map[string]any{"id": "message-3-" + projectID, "role": "user", "content": "继续拆解", "createdAt": "2026-08-30T08:02:00Z"},
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

type storyboardDocumentView struct {
	Scenes []struct {
		ID       string `json:"id"`
		SceneNo  int    `json:"sceneNo"`
		Segments []struct {
			ID        string `json:"id"`
			SegmentNo int    `json:"segmentNo"`
			Shots     []struct {
				ID     string `json:"id"`
				ShotNo int    `json:"shotNo"`
			} `json:"shots"`
		} `json:"segments"`
	} `json:"scenes"`
}

func storyboardPayload(id string) map[string]any {
	return map[string]any{
		"id": id, "title": "第一集", "source": "场景一：雨夜。", "options": map[string]any{"aspectRatio": "9:16"}, "model": "test-model", "sourceHash": "source-hash-1",
		"directorPlan": map[string]any{"schemaVersion": "1.0", "scenes": []any{map[string]any{"sceneNo": 1, "summary": "雨夜相遇"}}},
		"document": map[string]any{
			"schemaVersion": "1.0",
			"scenes": []any{map[string]any{
				"id": "model-id", "sceneNo": 1,
				"segments": []any{map[string]any{
					"id": "model-id", "segmentNo": 1,
					"shots": []any{
						map[string]any{"id": "model-id", "shotNo": 1, "visual": "远景"},
						map[string]any{"id": "model-id", "shotNo": 2, "visual": "近景"},
					},
				}},
			}},
		},
		"validation": map[string]any{"status": "warning", "errors": []any{}, "warnings": []any{}},
	}
}

func decodeStoryboardDocument(t *testing.T, raw json.RawMessage) storyboardDocumentView {
	t.Helper()
	var document storyboardDocumentView
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("decode storyboard document: %v: %s", err, raw)
	}
	return document
}

func assertGeneratedStoryboardIDs(t *testing.T, document storyboardDocumentView, untrusted string) {
	t.Helper()
	ids := []string{document.Scenes[0].ID, document.Scenes[0].Segments[0].ID, document.Scenes[0].Segments[0].Shots[0].ID, document.Scenes[0].Segments[0].Shots[1].ID}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || id == untrusted || seen[id] {
			t.Fatalf("storyboard generated ids = %v", ids)
		}
		if _, err := uuid.Parse(id); err != nil {
			t.Fatalf("storyboard id is not uuid: %q: %v", id, err)
		}
		seen[id] = true
	}
}

func assertSameStoryboardIDs(t *testing.T, before, after storyboardDocumentView) {
	t.Helper()
	if before.Scenes[0].ID != after.Scenes[0].ID || before.Scenes[0].Segments[0].ID != after.Scenes[0].Segments[0].ID {
		t.Fatalf("scene/segment ids changed: before=%#v after=%#v", before, after)
	}
	for i := range before.Scenes[0].Segments[0].Shots {
		if before.Scenes[0].Segments[0].Shots[i].ID != after.Scenes[0].Segments[0].Shots[i].ID {
			t.Fatalf("shot %d id changed: before=%#v after=%#v", i, before, after)
		}
	}
}

type asyncRequestResult struct {
	status int
	body   []byte
	err    error
}

func asyncJSONRequest(method, requestURL, token string, payload any) <-chan asyncRequestResult {
	result := make(chan asyncRequestResult, 1)
	body, err := json.Marshal(payload)
	if err != nil {
		result <- asyncRequestResult{err: err}
		return result
	}
	go func() {
		request, requestErr := http.NewRequest(method, requestURL, bytes.NewReader(body))
		if requestErr != nil {
			result <- asyncRequestResult{err: requestErr}
			return
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		response, requestErr := http.DefaultClient.Do(request)
		if requestErr != nil {
			result <- asyncRequestResult{err: requestErr}
			return
		}
		defer response.Body.Close()
		content, readErr := io.ReadAll(response.Body)
		result <- asyncRequestResult{status: response.StatusCode, body: content, err: readErr}
	}()
	return result
}

func waitForAsyncRequest(t *testing.T, result <-chan asyncRequestResult) asyncRequestResult {
	t.Helper()
	select {
	case response := <-result:
		if response.err != nil {
			t.Fatal(response.err)
		}
		return response
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for async request")
		return asyncRequestResult{}
	}
}

func waitForSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

type storyboardObjectGate struct {
	*httptest.Server
	mu      sync.Mutex
	method  string
	entered chan struct{}
	release chan struct{}
	proxy   *httputil.ReverseProxy
}

func newStoryboardObjectGate(t *testing.T, targetURL string) *storyboardObjectGate {
	t.Helper()
	target, err := url.Parse(targetURL)
	if err != nil {
		t.Fatal(err)
	}
	gate := &storyboardObjectGate{proxy: httputil.NewSingleHostReverseProxy(target)}
	gate.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.mu.Lock()
		if gate.method == r.Method {
			entered, release := gate.entered, gate.release
			gate.method = ""
			close(entered)
			gate.mu.Unlock()
			<-release
		} else {
			gate.mu.Unlock()
		}
		gate.proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(gate.Close)
	return gate
}

func (gate *storyboardObjectGate) blockNext(method string) (<-chan struct{}, chan<- struct{}) {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	gate.method = method
	gate.entered = make(chan struct{})
	gate.release = make(chan struct{})
	return gate.entered, gate.release
}

func rejectStoryboardProjectUpdates(t *testing.T) func() {
	t.Helper()
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	functionName := "reject_storyboard_update_" + suffix
	triggerName := "reject_storyboard_update_trigger_" + suffix
	if err := db.Exec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'reject storyboard update'; END; $$ LANGUAGE plpgsql`, functionName)).Error; err != nil {
		t.Fatalf("create storyboard update rejection function: %v", err)
	}
	if err := db.Exec(fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE ON storyboard_projects FOR EACH ROW EXECUTE FUNCTION %s()`, triggerName, functionName)).Error; err != nil {
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
		t.Fatalf("create storyboard update rejection trigger: %v", err)
	}
	return func() {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + triggerName + " ON storyboard_projects").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
	}
}
