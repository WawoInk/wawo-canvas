package service

import (
	"encoding/json"
	"fmt"

	"github.com/basketikun/infinite-canvas/model"
)

// ─── Video History DTO ────────────────────────────────────────────────

// VideoHistoryDTO 视频页历史记录展示模型。
type VideoHistoryDTO struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Prompt          string   `json:"prompt"`
	Status          string   `json:"status"`
	Model           string   `json:"model"`
	UpstreamTaskID  string   `json:"upstreamTaskId"`
	Credits         int      `json:"credits"`
	UpstreamCredits *int     `json:"upstreamCredits"`
	DurationMs      int64    `json:"durationMs"`
	VideoURL        string   `json:"videoUrl,omitempty"`
	ThumbnailURL    string   `json:"thumbnailUrl,omitempty"`
	FileIDs         []string `json:"fileIds,omitempty"`
	Size            string   `json:"size,omitempty"`
	Vquality        string   `json:"vquality,omitempty"`
	VideoSeconds    string   `json:"videoSeconds,omitempty"`
	GenAudio        string   `json:"genAudio,omitempty"`
	Watermark       string   `json:"watermark,omitempty"`
	ErrorMessage    string   `json:"error,omitempty"`
	CreatedAt       string   `json:"createdAt"`
}

// ToVideoHistoryDTO 将 Task + Payload 转为视频历史 DTO。
func ToVideoHistoryDTO(task model.GenerationTask, payload *model.GenerationPayload) VideoHistoryDTO {
	dto := VideoHistoryDTO{
		ID:              task.ID,
		Title:           "视频生成",
		Prompt:          extractPromptFromPayload(payload),
		Status:          mapTaskStatus(task.Status),
		Model:           task.Model,
		UpstreamTaskID:  task.UpstreamTaskID,
		Credits:         task.Credits,
		UpstreamCredits: task.UpstreamCredits,
		DurationMs:      task.LatencyMs,
		CreatedAt:       task.CreatedAt,
		FileIDs:         extractFileIDsFromMetadata(task.Metadata),
	}
	// Extract video config from request payload
	if payload != nil && payload.RequestBody != "" {
		var body map[string]any
		if err := json.Unmarshal([]byte(payload.RequestBody), &body); err == nil {
			if v, ok := body["ratio"].(string); ok && v != "" {
				dto.Size = v
			}
			if v, ok := body["resolution"].(string); ok && v != "" {
				dto.Vquality = v
			}
			if v, ok := body["duration"].(float64); ok {
				dto.VideoSeconds = fmtDuration(v)
			}
			if v, ok := body["generate_audio"].(bool); ok {
				dto.GenAudio = fmt.Sprintf("%v", v)
			}
			if v, ok := body["watermark"].(bool); ok {
				dto.Watermark = fmt.Sprintf("%v", v)
			}
		}
	}
	if task.Status == model.TaskStatusFailed {
		dto.ErrorMessage = task.ErrorMessage
	}
	if payload != nil && task.Status == model.TaskStatusSuccess {
		if url := extractVideoURLFromPayload(payload); url != "" {
			dto.VideoURL = url
		}
	}
	return dto
}

func fmtDuration(v float64) string {
	if v == 0 {
		return ""
	}
	return fmt.Sprintf("%.0f", v)
}

// ─── Image History DTO ────────────────────────────────────────────────

// ImageHistoryDTO 图片页历史记录展示模型。
type ImageHistoryDTO struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Prompt       string   `json:"prompt"`
	Status       string   `json:"status"`
	Model        string   `json:"model"`
	Credits      int      `json:"credits"`
	DurationMs   int64    `json:"durationMs"`
	ImageURLs    []string `json:"imageUrls,omitempty"`
	FileIDs      []string `json:"fileIds,omitempty"`
	Quality      string   `json:"quality,omitempty"`
	Size         string   `json:"size,omitempty"`
	Count        string   `json:"count,omitempty"`
	ErrorMessage string   `json:"error,omitempty"`
	CreatedAt    string   `json:"createdAt"`
}

// ToImageHistoryDTO 将 Task + Payload 转为图片历史 DTO。
func ToImageHistoryDTO(task model.GenerationTask, payload *model.GenerationPayload) ImageHistoryDTO {
	dto := ImageHistoryDTO{
		ID:         task.ID,
		Title:      "图片生成",
		Prompt:     extractPromptFromPayload(payload),
		Status:     mapTaskStatus(task.Status),
		Model:      task.Model,
		Credits:    task.Credits,
		DurationMs: task.LatencyMs,
		CreatedAt:  task.CreatedAt,
		FileIDs:    extractFileIDsFromMetadata(task.Metadata),
	}
	// Extract image config from request payload
	if payload != nil && payload.RequestBody != "" {
		var body map[string]any
		if err := json.Unmarshal([]byte(payload.RequestBody), &body); err == nil {
			if v, ok := body["size"].(string); ok && v != "" {
				dto.Size = v
			}
			if v, ok := body["quality"].(string); ok && v != "" {
				dto.Quality = v
			}
			if v, ok := body["count"].(string); ok && v != "" {
				dto.Count = v
			} else if v, ok := body["count"].(float64); ok && v > 0 {
				dto.Count = fmt.Sprintf("%.0f", v)
			}
		}
	}
	if task.Status == model.TaskStatusFailed {
		dto.ErrorMessage = task.ErrorMessage
	}
	if payload != nil && task.Status == model.TaskStatusSuccess {
		if urls := extractImageURLsFromPayload(payload); len(urls) > 0 {
			dto.ImageURLs = urls
		}
	}
	return dto
}

// ─── Helpers ──────────────────────────────────────────────────────────

func mapTaskStatus(status model.TaskStatus) string {
	switch status {
	case model.TaskStatusSuccess:
		return "success"
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		return "failed"
	case model.TaskStatusPending, model.TaskStatusRunning:
		return "pending"
	default:
		return "pending"
	}
}

func extractPromptFromPayload(payload *model.GenerationPayload) string {
	if payload == nil || payload.RequestBody == "" {
		return ""
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(payload.RequestBody), &body); err != nil {
		return ""
	}
	// 优先顶层 prompt
	if prompt, ok := body["prompt"].(string); ok && prompt != "" {
		return prompt
	}
	// 尝试 content 数组中的 text
	if content, ok := body["content"].([]any); ok {
		for _, item := range content {
			if m, ok := item.(map[string]any); ok {
				if t, ok := m["type"].(string); ok && t == "text" {
					if text, ok := m["text"].(string); ok && text != "" {
						return text
					}
				}
			}
		}
	}
	// 尝试 messages 数组最后一条
	if messages, ok := body["messages"].([]any); ok && len(messages) > 0 {
		if last, ok := messages[len(messages)-1].(map[string]any); ok {
			if content, ok := last["content"].(string); ok && content != "" {
				return content
			}
		}
	}
	return ""
}

func extractVideoURLFromPayload(payload *model.GenerationPayload) string {
	if payload == nil || payload.ResponseBody == "" {
		return ""
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(payload.ResponseBody), &body); err != nil {
		return ""
	}
	if content, ok := body["content"].(map[string]any); ok {
		if url, ok := content["video_url"].(string); ok && url != "" {
			return url
		}
	}
	if url, ok := body["video_url"].(string); ok && url != "" {
		return url
	}
	return ""
}

func extractImageURLsFromPayload(payload *model.GenerationPayload) []string {
	if payload == nil || payload.ResponseBody == "" {
		return nil
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(payload.ResponseBody), &body); err != nil {
		return nil
	}
	var urls []string
	// OpenAI 格式: data[].url 或 data[].b64_json
	if data, ok := body["data"].([]any); ok {
		for _, item := range data {
			if m, ok := item.(map[string]any); ok {
				if url, ok := m["url"].(string); ok && url != "" {
					urls = append(urls, url)
				} else if b64, ok := m["b64_json"].(string); ok && b64 != "" {
					urls = append(urls, "data:image/png;base64,"+b64)
				}
			}
		}
	}
	return urls
}

// extractFileIDsFromMetadata 从 task.Metadata JSON 中提取 fileIds 数组。
func extractFileIDsFromMetadata(metadata string) []string {
	if metadata == "" {
		return nil
	}
	var parsed struct {
		FileIDs []string `json:"fileIds"`
	}
	if err := json.Unmarshal([]byte(metadata), &parsed); err != nil {
		return nil
	}
	return parsed.FileIDs
}
