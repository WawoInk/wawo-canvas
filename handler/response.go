package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/basketikun/infinite-canvas/model"
)

type response struct {
	Code int    `json:"code"`
	Data any    `json:"data"`
	Msg  string `json:"msg"`
}

func OK(w http.ResponseWriter, data any) {
	writeJSON(w, response{Code: 0, Data: data, Msg: "ok"})
}

func Fail(w http.ResponseWriter, msg string) {
	writeJSON(w, response{Code: 1, Data: nil, Msg: msg})
}

func FailError(w http.ResponseWriter, err error) {
	log.Printf("request failed: %v", err)
	msg := "操作失败"
	var safe interface{ SafeMessage() string }
	if errors.As(err, &safe) {
		msg = safe.SafeMessage()
	}
	var failure interface{ FailureData() any }
	if errors.As(err, &failure) {
		writeJSON(w, response{Code: 1, Data: failure.FailureData(), Msg: msg})
		return
	}
	Fail(w, msg)
}

// Conflict 返回 HTTP 409，携带当前服务端版本供前端回滚。
func Conflict(w http.ResponseWriter, msg string, current any) {
	w.WriteHeader(http.StatusConflict)
	writeJSON(w, response{Code: -1, Data: map[string]any{"current": current, "msg": msg}, Msg: msg})
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func parseQuery(r *http.Request) model.Query {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	return model.Query{
		Keyword:  q.Get("keyword"),
		Tags:     q["tag"],
		Category: q.Get("category"),
		Type:     q.Get("type"),
		Page:     page,
		PageSize: pageSize,
	}
}
