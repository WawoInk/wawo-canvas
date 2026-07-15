package repository

import (
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
)

// ClaimGenerationTask atomically claims one queued or expired task for a worker.
func ClaimGenerationTask(owner string, now time.Time, lease time.Duration) (model.GenerationTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, false, err
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	expiresText := now.Add(lease).UTC().Format(time.RFC3339Nano)
	var task model.GenerationTask
	result := db.Raw(`UPDATE generation_tasks
		SET status = ?, worker_lease_owner = ?, worker_lease_expires_at = ?, updated_at = ?
		WHERE id = (
			SELECT id FROM generation_tasks
			WHERE (status = ? AND (queue_available_at = '' OR queue_available_at::timestamptz <= ?::timestamptz))
			   OR (status = ? AND worker_lease_expires_at <> '' AND worker_lease_expires_at::timestamptz <= ?::timestamptz)
			ORDER BY created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING *`,
		model.TaskStatusRunning, owner, expiresText, nowText,
		model.TaskStatusQueued, nowText,
		model.TaskStatusRunning, nowText,
	).Scan(&task)
	if result.Error != nil {
		return model.GenerationTask{}, false, result.Error
	}
	return task, result.RowsAffected > 0, nil
}

// ClaimGenerationTaskByID claims a specific queued task or an expired lease.
func ClaimGenerationTaskByID(id, owner string, now time.Time, lease time.Duration) (model.GenerationTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.GenerationTask{}, false, err
	}
	nowText := now.UTC().Format(time.RFC3339Nano)
	expiresText := now.Add(lease).UTC().Format(time.RFC3339Nano)
	var task model.GenerationTask
	result := db.Raw(`UPDATE generation_tasks
		SET status = ?, worker_lease_owner = ?, worker_lease_expires_at = ?, updated_at = ?
		WHERE id = ? AND ((status = ? AND (queue_available_at = '' OR queue_available_at::timestamptz <= ?::timestamptz))
			OR (status = ? AND worker_lease_expires_at <> '' AND worker_lease_expires_at::timestamptz <= ?::timestamptz))
		RETURNING *`,
		model.TaskStatusRunning, owner, expiresText, nowText, id,
		model.TaskStatusQueued, nowText,
		model.TaskStatusRunning, nowText,
	).Scan(&task)
	if result.Error != nil {
		return model.GenerationTask{}, false, result.Error
	}
	return task, result.RowsAffected > 0, nil
}

// NewWorkerID returns a unique process-local worker identity.
func NewWorkerID() string { return "worker-" + uuid.NewString() }
