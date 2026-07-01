package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

// CreateVideoTask POST /api/v1/contents/generations/tasks
func CreateVideoTask(w http.ResponseWriter, r *http.Request) {
	service.ProxyVideoTaskCreate(w, r)
}

// GetVideoTask GET /api/v1/contents/generations/tasks/:id
func GetVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/contents/generations/tasks/"+id)
}

// CancelVideoTask DELETE /api/v1/contents/generations/tasks/:id
func CancelVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyVideoTaskDelete(w, r, "/contents/generations/tasks/"+id)
}

// RemixVideoTask POST /api/v1/contents/generations/tasks/:id/remix
func RemixVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyVideoTaskRemix(w, r, "/contents/generations/tasks/"+id+"/remix")
}
