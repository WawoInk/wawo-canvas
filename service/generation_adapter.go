package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
)

type AdapterCreateRequest struct {
	Profile model.GenerationProfile
	Channel model.ModelChannel
	Intent  model.GenerationIntent
}

type ProviderTaskRef struct {
	ID       string
	Status   model.TaskStatus
	VideoURL string
}

type SeedanceContentsV1Adapter struct {
	client *http.Client
}

func NewSeedanceContentsV1Adapter(client *http.Client) SeedanceContentsV1Adapter {
	if client == nil {
		client = http.DefaultClient
	}
	return SeedanceContentsV1Adapter{client: client}
}

func (a SeedanceContentsV1Adapter) Create(ctx context.Context, req AdapterCreateRequest) (ProviderTaskRef, error) {
	payload := map[string]any{
		"model":          req.Profile.UpstreamModel,
		"content":        []map[string]any{{"type": "text", "text": req.Intent.Prompt}},
		"ratio":          "adaptive",
		"resolution":     "720p",
		"duration":       -1,
		"generate_audio": true,
		"watermark":      false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, BuildModelChannelURL(req.Channel, "/contents/generations/tasks"), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Authorization", "Bearer "+req.Channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := a.client.Do(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	if response.StatusCode >= http.StatusBadRequest {
		return ProviderTaskRef{}, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	var result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return ProviderTaskRef{}, err
	}
	if result.ID == "" {
		return ProviderTaskRef{}, fmt.Errorf("upstream task id is missing")
	}
	return ProviderTaskRef{ID: result.ID, Status: mapGenerationStatus(result.Status)}, nil
}

func (a SeedanceContentsV1Adapter) Poll(ctx context.Context, channel model.ModelChannel, taskID string) (ProviderTaskRef, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, BuildModelChannelURL(channel, "/contents/generations/tasks/"+taskID), nil)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	response, err := a.client.Do(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return ProviderTaskRef{}, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	var result struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Content *struct {
			VideoURL string `json:"video_url"`
		} `json:"content"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return ProviderTaskRef{}, err
	}
	ref := ProviderTaskRef{ID: result.ID, Status: mapGenerationStatus(result.Status)}
	if result.Content != nil {
		ref.VideoURL = result.Content.VideoURL
	}
	return ref, nil
}

func mapGenerationStatus(status string) model.TaskStatus {
	switch status {
	case "queued":
		return model.TaskStatusQueued
	case "running", "processing":
		return model.TaskStatusRunning
	case "succeeded", "success":
		return model.TaskStatusSucceeded
	case "failed":
		return model.TaskStatusFailed
	case "cancelled":
		return model.TaskStatusCancelled
	default:
		return model.TaskStatusRunning
	}
}
