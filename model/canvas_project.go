package model

// CanvasProject 用户画布项目（后端为 Source of Truth）。
type CanvasProject struct {
	ID          string `json:"id" gorm:"primaryKey"`
	UserID      string `json:"userId" gorm:"index:idx_canvas_user_revision,priority:1"`
	Name        string `json:"name"`
	ProjectJSON string `json:"projectJson" gorm:"type:text"`
	Version     int    `json:"version"`
	Revision    uint64 `json:"revision" gorm:"not null;default:(nextval('canvas_revision_seq'));index:idx_canvas_user_revision,priority:2"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// CanvasProjectList 画布项目列表。
type CanvasProjectList struct {
	Items []CanvasProject `json:"items"`
}
