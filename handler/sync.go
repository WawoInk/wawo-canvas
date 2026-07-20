package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

// Sync GET /api/v1/sync?cursor=xxx&domains=assets,canvas,tasks
func Sync(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	q := r.URL.Query()
	cursor := q.Get("cursor")
	canvasCursor := q.Get("canvasCursor")
	domains := q.Get("domains")

	result, err := service.SyncUserDomains(user.ID, cursor, canvasCursor, domains)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
