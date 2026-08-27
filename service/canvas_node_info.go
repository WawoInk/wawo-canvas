package service

import (
	"encoding/json"
	"net/url"
	"sort"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type canvasNodeProjectJSON struct {
	Nodes []json.RawMessage `json:"nodes"`
}

type canvasNodeJSON struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	Metadata  struct {
		Content        string `json:"content"`
		UpstreamTaskID string `json:"upstreamTaskId"`
	} `json:"metadata"`
}

type adminCanvasNodeItem struct {
	model.CanvasNodeInfo
	createdAt    time.Time
	hasCreatedAt bool
}

// ListAdminCanvasNodes 从当前画布项目快照解析并分页返回节点信息。
func ListAdminCanvasNodes(q model.Query) (model.CanvasNodeInfoList, error) {
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
				createdAt:    createdAt,
				hasCreatedAt: err == nil,
			})
		}
	}

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

func canvasNodeResultURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return value
}
