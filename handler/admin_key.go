package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func AdminKeyStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	status, err := service.AdminKeyStatus()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, status)
}

func GenerateAdminKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	key, err := service.GenerateAdminKey(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, key)
}

func RevokeAdminKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if err := service.RevokeAdminKey(); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
