package service

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// saveVideoTaskInRepo 保存视频任务所有权映射。
func saveVideoTaskInRepo(userID, taskID, modelName string) error {
	return repository.SaveVideoTask(userID, taskID, modelName)
}

// getVideoTaskByTaskIDAndUser 校验用户是否拥有该视频任务。
func getVideoTaskByTaskIDAndUser(taskID, userID string) (*model.VideoTask, error) {
	vt, err := repository.GetVideoTaskByTaskIDAndUser(taskID, userID)
	if err != nil {
		return nil, err
	}
	return &vt, nil
}
