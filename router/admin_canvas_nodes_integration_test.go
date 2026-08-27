package router_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	firstURL := "https://cdn.example.test/result.png?signature=a%2Bb#fragment"
	project := model.CanvasProject{
		ID:     "canvas-" + uuid.NewString(),
		UserID: user.ID,
		Name:   "画布节点测试",
		ProjectJSON: canvasNodeProjectJSON(t, []any{
			map[string]any{"id": "node-removed", "createdAt": earlierAt, "metadata": map[string]any{"upstreamTaskId": "upstream-removed", "content": "https://cdn.example.test/removed.png"}},
			map[string]any{"id": "node-current", "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": "upstream-current", "content": firstURL}},
			map[string]any{"id": "node-invalid-time", "createdAt": "not-rfc3339", "metadata": map[string]any{"upstreamTaskId": "upstream-invalid", "content": "不是生成结果 URL"}},
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
			db.Where("id IN ?", []string{project.ID, malformedProject.ID}).Delete(&model.CanvasProject{})
			db.Where("id IN ?", []string{admin.ID, user.ID}).Delete(&model.User{})
		}
	})
	if err := repository.CreateCanvasProject(&project); err != nil {
		t.Fatalf("create canvas project: %v", err)
	}
	if err := repository.CreateCanvasProject(&malformedProject); err != nil {
		t.Fatalf("create malformed canvas project: %v", err)
	}

	initial := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=500", session.Data.Token, nil)
	if initial.Code != 0 || initial.Data.Total != baseline.Data.Total+3 {
		t.Fatalf("initial canvas nodes = %#v", initial)
	}
	current, currentIndex := findAdminCanvasNode(initial.Data.Items, "node-current")
	_, removedIndex := findAdminCanvasNode(initial.Data.Items, "node-removed")
	invalid, invalidIndex := findAdminCanvasNode(initial.Data.Items, "node-invalid-time")
	if currentIndex >= removedIndex {
		t.Fatalf("node order = current:%d removed:%d, want createdAt descending", currentIndex, removedIndex)
	}
	if current.UserID != user.ID || current.Username != user.Username || current.UpstreamTaskID != "upstream-current" || current.CreatedAt != createdAt || current.ResultURL != firstURL {
		t.Fatalf("current canvas node = %#v", current)
	}
	if _, err := time.Parse(time.RFC3339, current.CreatedAt); err != nil {
		t.Fatalf("createdAt is not RFC3339: %q", current.CreatedAt)
	}
	if invalidIndex == len(initial.Data.Items) || invalid.CreatedAt != "" || invalid.ResultURL != "" {
		t.Fatalf("invalid canvas node = %#v", invalid)
	}

	stored, err := repository.GetCanvasProjectByID(project.ID)
	if err != nil {
		t.Fatalf("get canvas project: %v", err)
	}
	updatedURL := "https://cdn.example.test/result-v2.png?signature=c%2Bd#fresh"
	if err := repository.UpdateCanvasProjectWithLock(stored.ID, stored.UserID, canvasNodeProjectJSON(t, []any{
		map[string]any{"id": "node-current", "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": "upstream-current", "content": updatedURL}},
	}), stored.Revision, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("update canvas project: %v", err)
	}

	updated := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=500", session.Data.Token, nil)
	updatedCurrent, _ := findAdminCanvasNode(updated.Data.Items, "node-current")
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
