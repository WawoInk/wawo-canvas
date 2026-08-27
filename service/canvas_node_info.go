package service

import (
	"encoding/json"
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

// ListAdminCanvasNodes 从当前画布项目快照解析并分页返回节点信息。
func ListAdminCanvasNodes(q model.Query) (model.CanvasNodeInfoList, error) {
	projects, err := repository.ListCanvasNodeProjectSnapshots()
	if err != nil {
		return model.CanvasNodeInfoList{}, err
	}
	items := make([]model.CanvasNodeInfo, 0)
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
			if node.CreatedAt != "" {
				if _, err := time.Parse(time.RFC3339, node.CreatedAt); err != nil {
					continue
				}
			}
			items = append(items, model.CanvasNodeInfo{
				UserID:         project.UserID,
				Username:       project.Username,
				NodeID:         node.ID,
				UpstreamTaskID: node.Metadata.UpstreamTaskID,
				CreatedAt:      node.CreatedAt,
				ResultURL:      node.Metadata.Content,
			})
		}
	}

	q.Normalize()
	result := model.CanvasNodeInfoList{Items: items, Total: len(items)}
	start := q.Offset()
	if start < 0 || start >= result.Total {
		result.Items = make([]model.CanvasNodeInfo, 0)
		return result, nil
	}
	end := start + q.PageSize
	if end > result.Total {
		end = result.Total
	}
	result.Items = result.Items[start:end]
	return result, nil
}
