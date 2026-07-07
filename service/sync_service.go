package service

import (
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// SyncDomain represents a single domain's delta sync response.
type SyncDomain struct {
	Updates any      `json:"updates"`
	Deletes []string `json:"deletes"`
}

// SyncResponse is the combined sync API response.
type SyncResponse struct {
	Cursor string     `json:"cursor"`
	Assets SyncDomain `json:"assets"`
	Canvas SyncDomain `json:"canvas"`
	Tasks  SyncDomain `json:"tasks"`
}

// SyncUserDomains fetches delta updates for the requested domains since the cursor.
// domains: comma-separated list, e.g. "assets,canvas,tasks". Empty means all.
func SyncUserDomains(userID, cursor, domains string) (*SyncResponse, error) {
	resp := &SyncResponse{
		Assets: SyncDomain{Updates: []model.Asset{}, Deletes: []string{}},
		Canvas: SyncDomain{Updates: []model.CanvasProject{}, Deletes: []string{}},
		Tasks:  SyncDomain{Updates: []model.GenerationTask{}, Deletes: []string{}},
	}

	allDomains := domains == ""
	includeAssets := allDomains || containsDomain(domains, "assets")
	includeCanvas := allDomains || containsDomain(domains, "canvas")
	includeTasks := allDomains || containsDomain(domains, "tasks")

	// Track the latest timestamp seen across both updates and deletes.
	// deletedAt is a time.Time; updatedAt is an RFC3339 string — compare both
	// against the cursor as RFC3339 strings.
	newCursor := cursor
	if cursor != "" {
		newCursor = "" // reset; we recompute below only if we see anything
	}

	if includeAssets {
		items, _ := repository.ListUpdatedAssets(userID, cursor)
		deletes, deletedAt := fetchDeletesWithTime(userID, cursor, "assets")
		resp.Assets = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxTime(newCursor, maxUpdatedAt(items), deletedAt)
	}

	if includeCanvas {
		items, _ := repository.ListUpdatedCanvasProjects(userID, cursor)
		deletes, deletedAt := fetchDeletesWithTime(userID, cursor, "canvas_projects")
		resp.Canvas = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxTime(newCursor, maxUpdatedAtCanvas(items), deletedAt)
	}

	if includeTasks {
		items, _ := repository.ListUpdatedGenerationTasks(userID, cursor)
		deletes, deletedAt := fetchDeletesWithTime(userID, cursor, "generation_tasks")
		resp.Tasks = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxTime(newCursor, maxUpdatedAtTasks(items), deletedAt)
	}

	// If no data was seen anywhere, keep the old cursor so subsequent syncs
	// don't get stuck.
	if newCursor == "" {
		newCursor = cursor
	}
	resp.Cursor = newCursor
	return resp, nil
}

// fetchDeletesWithTime returns the deleted IDs for a table plus the latest
// deleted_at seen (as RFC3339 string). Empty time string when no deletes.
func fetchDeletesWithTime(userID, cursor, tableName string) ([]string, string) {
	records, err := repository.ListDeletedRecords(userID, cursor)
	if err != nil {
		return nil, ""
	}
	ids := make([]string, 0)
	var latest string
	for _, r := range records {
		if r.TableName != tableName {
			continue
		}
		ids = append(ids, r.RecordID)
		rs := r.DeletedAt.Format(time.RFC3339)
		if rs > latest {
			latest = rs
		}
	}
	return ids, latest
}

// containsDomain reports whether target appears in a comma-separated domains list.
func containsDomain(domains, target string) bool {
	for _, d := range strings.Split(domains, ",") {
		if strings.TrimSpace(d) == target {
			return true
		}
	}
	return false
}

// maxTime returns the latest of the given RFC3339 timestamps.
func maxTime(values ...string) string {
	var max string
	for _, v := range values {
		if v > max {
			max = v
		}
	}
	return max
}

func maxUpdatedAt(items []model.Asset) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}

func maxUpdatedAtCanvas(items []model.CanvasProject) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}

func maxUpdatedAtTasks(items []model.GenerationTask) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}
