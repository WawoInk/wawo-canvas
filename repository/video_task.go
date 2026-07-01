package repository

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

// SaveVideoTask 保存视频任务所有权映射。
func SaveVideoTask(userID, taskID, modelName string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	vt := model.VideoTask{
		ID:     "vt-" + uuid.NewString(),
		UserID: userID,
		TaskID: taskID,
		Model:  modelName,
	}
	return db.Create(&vt).Error
}

// GetVideoTaskByTaskID 根据上游任务 ID 查询映射记录。
func GetVideoTaskByTaskID(taskID string) (model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, err
	}
	var vt model.VideoTask
	result := db.Where("task_id = ?", taskID).First(&vt)
	return vt, result.Error
}

// GetVideoTaskByTaskIDAndUser 根据上游任务 ID 和用户 ID 校验所有权。
func GetVideoTaskByTaskIDAndUser(taskID, userID string) (model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, err
	}
	var vt model.VideoTask
	result := db.Where("task_id = ? AND user_id = ?", taskID, userID).First(&vt)
	return vt, result.Error
}

// GetVideoTasksByUserID 列出用户的所有视频任务映射。
func GetVideoTasksByUserID(userID string) ([]model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var tasks []model.VideoTask
	err = db.Where("user_id = ?", userID).Order("created_at desc").Find(&tasks).Error
	return tasks, err
}
