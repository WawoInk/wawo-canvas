package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type response struct {
	Code int    `json:"code"`
	Data any    `json:"data"`
	Msg  string `json:"msg"`
}

func main() {
	sha := os.Getenv("DEPLOY_SHA")
	userID := "deploy-test-user"
	token := "deploy-test-token-" + os.Getenv("JWT_SECRET")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if sha == "health-fail" {
			http.Error(w, "unhealthy", http.StatusServiceUnavailable)
			return
		}
		if sha == "public-fail" && !strings.HasSuffix(r.Host, ":3000") && !strings.HasSuffix(r.Host, ":8088") {
			http.Error(w, "public verification failed", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, _ *http.Request) {
		if sha == "database-fail" {
			writeJSON(w, response{Code: 1, Msg: "database probe failed"})
			return
		}
		databaseValue, err := exec.Command("psql", os.Getenv("DATABASE_DSN"), "-Atc", "SELECT value FROM deploy_probe WHERE id = 1").Output()
		fileValue, fileErr := os.ReadFile("/app/data/deploy-probe.txt")
		if err != nil || fileErr != nil || strings.TrimSpace(string(databaseValue)) == "" || strings.TrimSpace(string(fileValue)) == "" {
			writeJSON(w, response{Code: 1, Msg: "database or shared file probe failed"})
			return
		}
		writeJSON(w, response{Data: map[string]string{"sha": sha, "database": strings.TrimSpace(string(databaseValue)), "file": strings.TrimSpace(string(fileValue))}})
	})
	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, response{Data: map[string]any{"token": token, "user": map[string]string{"id": userID, "role": "admin"}}})
	})
	mux.HandleFunc("/api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		if sha != "jwt-fail" && r.Header.Get("Authorization") == "Bearer "+token {
			writeJSON(w, response{Data: map[string]string{"id": userID, "role": "admin"}})
			return
		}
		writeJSON(w, response{Data: map[string]string{"id": "", "role": "guest"}})
	})
	mux.HandleFunc("/api/slow", func(w http.ResponseWriter, r *http.Request) {
		delay, _ := time.ParseDuration(r.URL.Query().Get("delay"))
		time.Sleep(delay)
		writeJSON(w, response{Data: map[string]string{"sha": sha}})
	})

	server := &http.Server{Addr: ":8088", Handler: mux}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, body response) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
