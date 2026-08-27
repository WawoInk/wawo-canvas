package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

// AdminCanvasNodes GET /api/admin/canvas-nodes
func AdminCanvasNodes(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	nodes, err := service.ListAdminCanvasNodes(model.CanvasNodeInfoQuery{
		Query:          parseQuery(r),
		UserID:         values.Get("user_id"),
		Username:       values.Get("username"),
		NodeID:         values.Get("node_id"),
		UpstreamTaskID: values.Get("upstream_task_id"),
	})
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, nodes)
}
