package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

// AdminCanvasNodes GET /api/admin/canvas-nodes
func AdminCanvasNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := service.ListAdminCanvasNodes(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, nodes)
}
