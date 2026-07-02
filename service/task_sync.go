package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type TaskSyncMode string

const (
	TaskSyncPoll     TaskSyncMode = "poll"
	TaskSyncCallback TaskSyncMode = "callback"
)

// TaskSyncConfig 任务状态同步配置。
type TaskSyncConfig struct {
	GenTaskID       string             // generation_tasks 主键
	UpstreamTaskID  string             // 上游厂商任务 ID
	Channel         model.ModelChannel // 渠道配置
	Mode            TaskSyncMode       // poll 或 callback
	MaxRetries      int                // 最大轮询次数，默认 20
	PollIntervalMin time.Duration      // 起始轮询间隔，默认 5s
	PollIntervalMax time.Duration      // 最大轮询间隔，默认 10s
	CallbackToken   string             // 回调验证令牌
}

// TaskResult 任务终态结果。
type TaskResult struct {
	ErrorCode       string
	ErrorMessage    string
	ResponseBody    string
	ResponseHeaders string
}

// DefaultTaskSyncConfig 返回默认配置。
func DefaultTaskSyncConfig() TaskSyncConfig {
	return TaskSyncConfig{
		Mode:            TaskSyncPoll,
		MaxRetries:      20,
		PollIntervalMin: 5 * time.Second,
		PollIntervalMax: 10 * time.Second,
	}
}

var (
	taskSyncCancels sync.Map // genTaskID -> context.CancelFunc
)

// SyncTaskStatus 启动异步任务状态同步。
func SyncTaskStatus(cfg TaskSyncConfig) {
	if cfg.MaxRetries <= 0 {
		cfg.MaxRetries = 20
	}
	if cfg.PollIntervalMin <= 0 {
		cfg.PollIntervalMin = 5 * time.Second
	}
	if cfg.PollIntervalMax <= 0 {
		cfg.PollIntervalMax = 10 * time.Second
	}
	if cfg.CallbackToken == "" {
		cfg.CallbackToken = fmt.Sprintf("cbtok-%s", cfg.GenTaskID)
		// persist callback token so webhook handler can validate
		repository.UpdateGenerationTask(cfg.GenTaskID, map[string]any{
			"callback_token": cfg.CallbackToken,
		})
	}

	if cfg.Mode == TaskSyncCallback && cfg.Channel.SupportsCallback() {
		go waitForCallback(cfg)
	} else {
		go pollUntilTerminal(cfg)
	}
}

// CancelTaskSync 终止任务同步（取消任务时调用）。
func CancelTaskSync(genTaskID string) {
	if cancel, ok := taskSyncCancels.LoadAndDelete(genTaskID); ok {
		cancel.(context.CancelFunc)()
	}
}

// pollUntilTerminal 轮询上游直到任务进入终态。
func pollUntilTerminal(cfg TaskSyncConfig) {
	ctx, cancel := context.WithCancel(context.Background())
	taskSyncCancels.Store(cfg.GenTaskID, cancel)
	defer taskSyncCancels.Delete(cfg.GenTaskID)

	for i := 0; i < cfg.MaxRetries; i++ {
		// 计算退避间隔：max(cfg.PollIntervalMin, min(cfg.PollIntervalMax, min*2^(i-2)))
		interval := cfg.PollIntervalMin
		if i >= 2 {
			backoff := time.Duration(math.Min(
				float64(cfg.PollIntervalMax),
				float64(cfg.PollIntervalMin)*math.Pow(2, float64(i-2)),
			))
			interval = backoff
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}

		status, result := queryUpstreamTask(cfg)
		if status == model.TaskStatusSuccess || status == model.TaskStatusFailed || status == model.TaskStatusCancelled {
			OnTaskCompleted(cfg.GenTaskID, status, result)
			return
		}
	}

	// 超时：标记为失败
	OnTaskCompleted(cfg.GenTaskID, model.TaskStatusFailed, TaskResult{
		ErrorCode:    "TASK_SYNC_TIMEOUT",
		ErrorMessage: "任务状态同步超时",
	})
}

// waitForCallback 等待厂商回调（占位轮询 fallback）。
func waitForCallback(cfg TaskSyncConfig) {
	// 存储 callback_token 供 webhook 验证
	// 启动一个长超时轮询作为 fallback（厂商可能不回调）
	pollUntilTerminal(cfg)
}

// queryUpstreamTask 通过 HTTP 查询上游任务状态。
func queryUpstreamTask(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
	return queryUpstreamTaskViaHTTP(cfg)
}

// queryUpstreamTaskViaHTTP 通过 HTTP GET 查询上游任务状态。
func queryUpstreamTaskViaHTTP(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
	path := fmt.Sprintf("/v1/contents/generations/tasks/%s", cfg.UpstreamTaskID)
	targetURL := strings.TrimRight(cfg.Channel.BaseURL, "/") + path

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return model.TaskStatusRunning, TaskResult{}
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Channel.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("task_sync: HTTP query failed: genTask=%s url=%s err=%v", cfg.GenTaskID, targetURL, err)
		return model.TaskStatusRunning, TaskResult{}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(body, &result)

	status := mapArkStatusToModel(result.Status)
	taskResult := TaskResult{ResponseBody: string(body)}
	if result.Error != nil {
		taskResult.ErrorCode = result.Error.Code
		taskResult.ErrorMessage = result.Error.Message
	}
	return status, taskResult
}

// mapArkStatusToModel 将 Ark 响应状态映射为 model.TaskStatus。
func mapArkStatusToModel(status string) model.TaskStatus {
	switch status {
	case "succeeded":
		return model.TaskStatusSuccess
	case "failed":
		return model.TaskStatusFailed
	case "cancelled":
		return model.TaskStatusCancelled
	case "running", "queued":
		return model.TaskStatusRunning
	default:
		return model.TaskStatusRunning
	}
}

// OnTaskCompleted 统一终态回写。
func OnTaskCompleted(genTaskID string, status model.TaskStatus, result TaskResult) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"status":     string(status),
		"updated_at": now,
	}
	if result.ErrorCode != "" {
		updates["error_code"] = result.ErrorCode
		updates["error_message"] = result.ErrorMessage
	}
	if err := repository.UpdateGenerationTask(genTaskID, updates); err != nil {
		log.Printf("task_sync: update failed: genTask=%s err=%v", genTaskID, err)
	}

	if result.ResponseBody != "" {
		if err := repository.UpdateGenerationPayload(genTaskID, result.ResponseBody, result.ResponseHeaders); err != nil {
			log.Printf("task_sync: update payload failed: genTask=%s err=%v", genTaskID, err)
		}
	}

	// 清理取消上下文
	taskSyncCancels.Delete(genTaskID)
}
