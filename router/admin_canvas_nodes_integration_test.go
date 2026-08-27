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
	baseline := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=1", session.Data.Token, nil)
	if baseline.Code != 0 {
		t.Fatalf("baseline canvas nodes = %#v", baseline)
	}

	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	firstURL := "https://cdn.example.test/result.png?signature=a%2Bb#fragment"
	project := model.CanvasProject{
		ID:     "canvas-" + uuid.NewString(),
		UserID: user.ID,
		Name:   "画布节点测试",
		ProjectJSON: canvasNodeProjectJSON(t, []any{
			map[string]any{"id": "node-current", "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": "upstream-current", "content": firstURL}},
			map[string]any{"id": "node-removed", "createdAt": createdAt, "metadata": map[string]any{"upstreamTaskId": "upstream-removed", "content": "https://cdn.example.test/removed.png"}},
			map[string]any{"id": 1},
			map[string]any{"id": "node-invalid-time", "createdAt": "not-rfc3339"},
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

	initial := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=1", session.Data.Token, nil)
	if initial.Code != 0 || initial.Data.Total != baseline.Data.Total+2 || len(initial.Data.Items) != 1 {
		t.Fatalf("initial canvas nodes = %#v", initial)
	}
	item := initial.Data.Items[0]
	if item.UserID != user.ID || item.Username != user.Username || item.NodeID != "node-current" || item.UpstreamTaskID != "upstream-current" || item.CreatedAt != createdAt || item.ResultURL != firstURL {
		t.Fatalf("initial canvas node = %#v", item)
	}
	if _, err := time.Parse(time.RFC3339, item.CreatedAt); err != nil {
		t.Fatalf("createdAt is not RFC3339: %q", item.CreatedAt)
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

	updated := doJSON[adminCanvasNodeInfoList](t, http.MethodGet, server.URL+"/api/admin/canvas-nodes?page=1&pageSize=1", session.Data.Token, nil)
	if updated.Code != 0 || updated.Data.Total != baseline.Data.Total+1 || len(updated.Data.Items) != 1 || updated.Data.Items[0].NodeID != "node-current" || updated.Data.Items[0].ResultURL != updatedURL {
		t.Fatalf("updated canvas nodes = %#v", updated)
	}
}

func canvasNodeProjectJSON(t *testing.T, nodes []any) string {
	t.Helper()
	value, err := json.Marshal(map[string]any{"nodes": nodes})
	if err != nil {
		t.Fatalf("marshal canvas project: %v", err)
	}
	return string(value)
}
