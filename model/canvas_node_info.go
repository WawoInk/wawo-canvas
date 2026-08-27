package model

// CanvasNodeInfo 管理端从当前画布项目快照投影出的节点信息。
type CanvasNodeInfo struct {
	UserID         string `json:"userId"`
	Username       string `json:"username"`
	NodeID         string `json:"nodeId"`
	UpstreamTaskID string `json:"upstreamTaskId"`
	CreatedAt      string `json:"createdAt"`
	ResultURL      string `json:"resultUrl"`
}

// CanvasNodeInfoList 管理端画布节点分页列表。
type CanvasNodeInfoList struct {
	Items []CanvasNodeInfo `json:"items"`
	Total int              `json:"total"`
}

// CanvasNodeInfoQuery 管理端画布节点筛选和分页参数。
type CanvasNodeInfoQuery struct {
	Query
	UserID         string
	Username       string
	NodeID         string
	UpstreamTaskID string
}

// CanvasNodeProjectSnapshot 是读取画布项目 JSON 所需的关联数据。
type CanvasNodeProjectSnapshot struct {
	UserID      string `json:"-"`
	Username    string `json:"-"`
	ProjectJSON string `json:"-"`
}
