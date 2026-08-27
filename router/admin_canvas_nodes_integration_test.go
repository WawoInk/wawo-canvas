package router_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type adminCanvasNodeInfo struct {
	UserID         string `json:"userId"`
	Username       string `json:"username"`
	NodeID         string `json:"nodeId"`
	UpstreamTaskID string `json:"upstreamTaskId"`
	CreatedAt      string `json:"createdAt"`
	ResultURL      string `json:"resultUrl"`
}

type adminCanvasNodeInfoList struct {
	Items []adminCanvasNodeInfo `json:"items"`
	Total int                   `json:"total"`
}

func TestAdminCanvasNodesReflectCurrentProjectSnapshotThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "admin-canvas-nodes-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	admin, err := service.SaveUser(model.User{Username: "canvas-node-admin-" + uuid.NewString(), Role: model.UserRoleAdmin}, "admin-password")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	user, err := service.SaveUser(model.User{Username: "canvas-node-user-" + uuid.NewString()}, "user-password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	session := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": admin.Username, "password": "admin-password"})
	baseline := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=500", session.Data.Token, nil)
	if baseline.Code != 0 {
		t.Fatalf("baseline canvas nodes = %#v", baseline)
	}

	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	earlierAt := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	currentNodeID := "node-current-" + uuid.NewString()
	linkedNodeID := "node-linked-" + uuid.NewString()
	platformNodeID := "node-platform-" + uuid.NewString()
	removedNodeID := "node-removed-" + uuid.NewString()
	invalidNodeID := "node-invalid-time-" + uuid.NewString()
	currentUpstreamTaskID := "upstream-current-" + uuid.NewString()
	linkedGenerationTaskID := "gentask-" + uuid.NewString()
	linkedUpstreamTaskID := "task_" + uuid.NewString()
	platformGenerationTaskID := "gentask-" + uuid.NewString()
	platformUpstreamTaskID := "task_" + uuid.NewString()
	firstURL := "https://cdn.example.test/result.png?signature=a%2Bb#fragment"
	project := model.CanvasProject{
		ID:     "canvas-" + uuid.NewString(),
		UserID: user.ID,
		Name:   "画布节点测试",
		ProjectJSON: canvasNodeProjectJSON(t, []any{
			map[string]any{"id": removedNodeID, "createdAt": earlierAt, "metadata": map[string]any{"upstreamTaskId": "upstream-removed", "content": "https://cdn.example.test/removed.png"}},
			map[string]any{"id": currentNodeID, "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": currentUpstreamTaskID, "platformTaskId": platformGenerationTaskID, "content": firstURL}},
			map[string]any{"id": linkedNodeID, "createdAt": createdAt, "metadata": map[string]any{"generationTaskId": linkedGenerationTaskID, "content": "https://cdn.example.test/linked.png"}},
			map[string]any{"id": platformNodeID, "createdAt": createdAt, "metadata": map[string]any{"platformTaskId": platformGenerationTaskID, "content": "https://cdn.example.test/platform.png"}},
			map[string]any{"id": invalidNodeID, "createdAt": "not-rfc3339", "metadata": map[string]any{"upstreamTaskId": "upstream-invalid", "content": "不是生成结果 URL"}},
			map[string]any{"id": 1},
		}),
		Version:   1,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	malformedProject := model.CanvasProject{ID: "canvas-" + uuid.NewString(), UserID: user.ID, Name: "损坏画布节点测试", ProjectJSON: "{", CreatedAt: createdAt, UpdatedAt: createdAt}
	t.Cleanup(func() {
		db, err := repository.DB()
		if err == nil {
			db.Where("task_id IN ?", []string{linkedGenerationTaskID, platformGenerationTaskID}).Delete(&model.GenerationPayload{})
			db.Where("id IN ?", []string{linkedGenerationTaskID, platformGenerationTaskID}).Delete(&model.GenerationTask{})
			db.Where("id IN ?", []string{project.ID, malformedProject.ID}).Delete(&model.CanvasProject{})
			db.Where("id IN ?", []string{admin.ID, user.ID}).Delete(&model.User{})
		}
	})
	for _, task := range []model.GenerationTask{
		{ID: linkedGenerationTaskID, UserID: user.ID, TaskType: model.TaskTypeVideo, Status: model.TaskStatusSuccess, UpstreamTaskID: linkedUpstreamTaskID, CreatedAt: createdAt, UpdatedAt: createdAt},
		{ID: platformGenerationTaskID, UserID: user.ID, TaskType: model.TaskTypeImage, Status: model.TaskStatusSuccess, UpstreamTaskID: platformUpstreamTaskID, CreatedAt: createdAt, UpdatedAt: createdAt},
	} {
		if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "genpayload-" + uuid.NewString(), CreatedAt: createdAt}); err != nil {
			t.Fatalf("create linked generation task: %v", err)
		}
	}
	if err := repository.CreateCanvasProject(&project); err != nil {
		t.Fatalf("create canvas project: %v", err)
	}
	if err := repository.CreateCanvasProject(&malformedProject); err != nil {
		t.Fatalf("create malformed canvas project: %v", err)
	}

	initial := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=500", session.Data.Token, nil)
	if initial.Code != 0 || initial.Data.Total != baseline.Data.Total+5 {
		t.Fatalf("initial canvas nodes = %#v", initial)
	}
	current, currentIndex := findAdminCanvasNode(initial.Data.Items, currentNodeID)
	linked, linkedIndex := findAdminCanvasNode(initial.Data.Items, linkedNodeID)
	platform, platformIndex := findAdminCanvasNode(initial.Data.Items, platformNodeID)
	_, removedIndex := findAdminCanvasNode(initial.Data.Items, removedNodeID)
	invalid, invalidIndex := findAdminCanvasNode(initial.Data.Items, invalidNodeID)
	if currentIndex >= removedIndex || linkedIndex >= removedIndex || platformIndex >= removedIndex {
		t.Fatalf("node order = current:%d linked:%d platform:%d removed:%d, want createdAt descending", currentIndex, linkedIndex, platformIndex, removedIndex)
	}
	if current.UserID != user.ID || current.Username != user.Username || current.UpstreamTaskID != currentUpstreamTaskID || current.CreatedAt != createdAt || current.ResultURL != firstURL {
		t.Fatalf("current canvas node = %#v", current)
	}
	if linked.UpstreamTaskID != linkedUpstreamTaskID {
		t.Fatalf("linked canvas node = %#v", linked)
	}
	if platform.UpstreamTaskID != platformUpstreamTaskID {
		t.Fatalf("platform canvas node = %#v", platform)
	}
	if _, err := time.Parse(time.RFC3339, current.CreatedAt); err != nil {
		t.Fatalf("createdAt is not RFC3339: %q", current.CreatedAt)
	}
	if invalidIndex == len(initial.Data.Items) || invalid.CreatedAt != "" || invalid.ResultURL != "" {
		t.Fatalf("invalid canvas node = %#v", invalid)
	}

	for name, want := range map[string]struct {
		query url.Values
		total int
	}{
		"user ID":                   {url.Values{"user_id": {user.ID}}, 5},
		"username":                  {url.Values{"username": {strings.ToUpper(user.Username)}}, 5},
		"node ID":                   {url.Values{"node_id": {strings.ToUpper(currentNodeID)}}, 1},
		"upstream task ID":          {url.Values{"upstream_task_id": {strings.ToUpper(currentUpstreamTaskID)}}, 1},
		"linked upstream task ID":   {url.Values{"upstream_task_id": {strings.ToUpper(linkedUpstreamTaskID)}}, 1},
		"platform upstream task ID": {url.Values{"upstream_task_id": {strings.ToUpper(platformUpstreamTaskID)}}, 1},
	} {
		filtered := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?"+want.query.Encode(), session.Data.Token, nil)
		if filtered.Code != 0 || filtered.Data.Total != want.total {
			t.Fatalf("%s filter = %#v", name, filtered)
		}
	}
	combinedQuery := url.Values{
		"user_id":          {user.ID},
		"username":         {strings.ToUpper(user.Username)},
		"node_id":          {strings.ToUpper(currentNodeID)},
		"upstream_task_id": {strings.ToUpper(currentUpstreamTaskID)},
		"start_time":       {createdAt},
		"end_time":         {createdAt},
		"page":             {"1"},
		"pageSize":         {"1"},
	}
	filtered := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?"+combinedQuery.Encode(), session.Data.Token, nil)
	if filtered.Code != 0 || filtered.Data.Total != 1 || len(filtered.Data.Items) != 1 || filtered.Data.Items[0].NodeID != currentNodeID {
		t.Fatalf("combined canvas node filters = %#v", filtered)
	}

	stored, err := repository.GetCanvasProjectByID(project.ID)
	if err != nil {
		t.Fatalf("get canvas project: %v", err)
	}
	updatedURL := "https://cdn.example.test/result-v2.png?signature=c%2Bd#fresh"
	if err := repository.UpdateCanvasProjectWithLock(stored.ID, stored.UserID, canvasNodeProjectJSON(t, []any{
		map[string]any{"id": currentNodeID, "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": currentUpstreamTaskID, "content": updatedURL}},
	}), stored.Revision, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("update canvas project: %v", err)
	}

	updated := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=500", session.Data.Token, nil)
	updatedCurrent, _ := findAdminCanvasNode(updated.Data.Items, currentNodeID)
	if updated.Code != 0 || updated.Data.Total != baseline.Data.Total+1 || updatedCurrent.ResultURL != updatedURL {
		t.Fatalf("updated canvas nodes = %#v", updated)
	}
}

func findAdminCanvasNode(items []adminCanvasNodeInfo, nodeID string) (adminCanvasNodeInfo, int) {
	for index, item := range items {
		if item.NodeID == nodeID {
			return item, index
		}
	}
	return adminCanvasNodeInfo{}, len(items)
}

func canvasNodeProjectJSON(t *testing.T, nodes []any) string {
	t.Helper()
	value, err := json.Marshal(map[string]any{"nodes": nodes})
	if err != nil {
		t.Fatalf("marshal canvas project: %v", err)
	}
	return string(value)
}
