package service

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type canvasNodeProjectJSON struct {
	Nodes []json.RawMessage `json:"nodes"`
}

type canvasNodeMetadata struct {
	Content          string `json:"content"`
	UpstreamTaskID   string `json:"upstreamTaskId"`
	PlatformTaskID   string `json:"platformTaskId"`
	GenerationTaskID string `json:"generationTaskId"`
}

type canvasNodeJSON struct {
	ID        string             `json:"id"`
	CreatedAt string             `json:"createdAt"`
	Metadata  canvasNodeMetadata `json:"metadata"`
}

type adminCanvasNodeItem struct {
	model.CanvasNodeInfo
	platformTaskID   string
	generationTaskID string
	createdAt        time.Time
	hasCreatedAt     bool
}

// ListAdminCanvasNodes 从当前画布项目快照解析并分页返回节点信息。
func ListAdminCanvasNodes(q model.CanvasNodeInfoQuery) (model.CanvasNodeInfoList, error) {
	startAt, endAt, err := canvasNodeCreatedAtRange(q)
	if err != nil {
		return model.CanvasNodeInfoList{}, err
	}
	projects, err := repository.ListCanvasNodeProjectSnapshots()
	if err != nil {
		return model.CanvasNodeInfoList{}, err
	}

	// ponytail: parse source-of-truth snapshots in memory; use indexed JSON queries only if measured admin volume requires it.
	items := make([]adminCanvasNodeItem, 0)
	for _, project := range projects {
		var snapshot canvasNodeProjectJSON
		if json.Unmarshal([]byte(project.ProjectJSON), &snapshot) != nil {
			continue
		}
		for _, rawNode := range snapshot.Nodes {
			var node canvasNodeJSON
			if json.Unmarshal(rawNode, &node) != nil || node.ID == "" {
				continue
			}
			createdAt, err := time.Parse(time.RFC3339, node.CreatedAt)
			if err != nil {
				node.CreatedAt = ""
			}
			items = append(items, adminCanvasNodeItem{
				CanvasNodeInfo: model.CanvasNodeInfo{
					UserID:         project.UserID,
					Username:       project.Username,
					NodeID:         node.ID,
					UpstreamTaskID: node.Metadata.UpstreamTaskID,
					CreatedAt:      node.CreatedAt,
					ResultURL:      canvasNodeResultURL(node.Metadata.Content),
				},
				platformTaskID:   node.Metadata.PlatformTaskID,
				generationTaskID: node.Metadata.GenerationTaskID,
				createdAt:        createdAt,
				hasCreatedAt:     err == nil,
			})
		}
	}
	if err := hydrateCanvasNodeUpstreamTaskIDs(items); err != nil {
		return model.CanvasNodeInfoList{}, err
	}

	filtered := items[:0]
	for _, item := range items {
		if canvasNodeMatches(item, q, startAt, endAt) {
			filtered = append(filtered, item)
		}
	}
	items = filtered
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i], items[j]
		if left.hasCreatedAt != right.hasCreatedAt {
			return left.hasCreatedAt
		}
		if left.hasCreatedAt && !left.createdAt.Equal(right.createdAt) {
			return left.createdAt.After(right.createdAt)
		}
		if left.UserID != right.UserID {
			return left.UserID < right.UserID
		}
		if left.NodeID != right.NodeID {
			return left.NodeID < right.NodeID
		}
		if left.UpstreamTaskID != right.UpstreamTaskID {
			return left.UpstreamTaskID < right.UpstreamTaskID
		}
		return left.ResultURL < right.ResultURL
	})

	q.Normalize()
	result := model.CanvasNodeInfoList{Total: len(items)}
	start := q.Offset()
	if start < 0 || start >= result.Total {
		result.Items = make([]model.CanvasNodeInfo, 0)
		return result, nil
	}
	end := start + q.PageSize
	if end > result.Total {
		end = result.Total
	}
	result.Items = make([]model.CanvasNodeInfo, 0, end-start)
	for _, item := range items[start:end] {
		result.Items = append(result.Items, item.CanvasNodeInfo)
	}
	return result, nil
}

func hydrateCanvasNodeUpstreamTaskIDs(items []adminCanvasNodeItem) error {
	seen := make(map[string]struct{})
	ids := make([]string, 0)
	for _, item := range items {
		for _, id := range []string{item.platformTaskID, item.generationTaskID, item.UpstreamTaskID} {
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	tasks, err := repository.ListGenerationTasksByIDs(ids)
	if err != nil {
		return err
	}
	upstreamByTask := make(map[string]string, len(tasks))
	for _, task := range tasks {
		upstreamByTask[canvasNodeTaskKey(task.UserID, task.ID)] = task.UpstreamTaskID
	}
	for index := range items {
		item := &items[index]
		if item.UpstreamTaskID != "" {
			if upstreamTaskID := upstreamByTask[canvasNodeTaskKey(item.UserID, item.UpstreamTaskID)]; upstreamTaskID != "" {
				item.UpstreamTaskID = upstreamTaskID
			}
			continue
		}
		for _, id := range []string{item.platformTaskID, item.generationTaskID} {
			if upstreamTaskID := upstreamByTask[canvasNodeTaskKey(item.UserID, id)]; upstreamTaskID != "" {
				item.UpstreamTaskID = upstreamTaskID
				break
			}
		}
	}
	return nil
}

func canvasNodeTaskKey(userID, taskID string) string {
	return userID + "\x00" + taskID
}

func canvasNodeCreatedAtRange(q model.CanvasNodeInfoQuery) (time.Time, time.Time, error) {
	var startAt, endAt time.Time
	var err error
	if q.StartTime != "" {
		if startAt, err = time.Parse(time.RFC3339, q.StartTime); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("start_time must be RFC3339: %w", err)
		}
	}
	if q.EndTime != "" {
		if endAt, err = time.Parse(time.RFC3339, q.EndTime); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("end_time must be RFC3339: %w", err)
		}
	}
	return startAt, endAt, nil
}

func canvasNodeMatches(item adminCanvasNodeItem, q model.CanvasNodeInfoQuery, startAt, endAt time.Time) bool {
	if !canvasNodeContains(item.UserID, q.UserID) || !canvasNodeContains(item.Username, q.Username) || !canvasNodeContains(item.NodeID, q.NodeID) || !canvasNodeContains(item.UpstreamTaskID, q.UpstreamTaskID) {
		return false
	}
	return startAt.IsZero() && endAt.IsZero() || item.hasCreatedAt && (startAt.IsZero() || !item.createdAt.Before(startAt)) && (endAt.IsZero() || !item.createdAt.After(endAt))
}

func canvasNodeContains(value, filter string) bool {
	return strings.Contains(strings.ToLower(value), strings.ToLower(filter))
}

func canvasNodeResultURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return value
}
