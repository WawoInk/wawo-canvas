package repository

import "github.com/basketikun/infinite-canvas/model"

// ListCanvasNodeProjectSnapshots 查询当前画布项目快照及其所属用户名。
func ListCanvasNodeProjectSnapshots() ([]model.CanvasNodeProjectSnapshot, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var projects []model.CanvasNodeProjectSnapshot
	err = db.Table("canvas_projects AS cp").
		Select("cp.user_id, u.username, cp.project_json").
		Joins("LEFT JOIN users AS u ON u.id = cp.user_id").
		Order("cp.updated_at DESC").
		Scan(&projects).Error
	return projects, err
}
