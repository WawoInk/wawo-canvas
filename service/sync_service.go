package service

import (
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// SyncDomain represents a single domain's delta sync response.
type SyncDomain struct {
	Cursor  string   `json:"cursor,omitempty"`
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
// Any repository error aborts the sync so the client knows to retry — an empty
// sync returned on DB failure would silently desync the client.
func SyncUserDomains(userID, cursor, canvasCursor, domains string) (*SyncResponse, error) {
	resp := &SyncResponse{
		Assets: SyncDomain{Updates: []model.Asset{}, Deletes: []string{}},
		Canvas: SyncDomain{Updates: []model.CanvasProject{}, Deletes: []string{}},
		Tasks:  SyncDomain{Updates: []model.GenerationTask{}, Deletes: []string{}},
	}

	allDomains := domains == ""
	includeAssets := allDomains || containsDomain(domains, "assets")
	includeCanvas := allDomains || containsDomain(domains, "canvas")
	includeTasks := allDomains || containsDomain(domains, "tasks")

	newCursor := cursor

	if includeAssets {
		items, err := repository.ListUpdatedAssets(userID, cursor)
		if err != nil {
			return nil, err
		}
		deletes, deletedAt, err := fetchDeletes(userID, cursor, "assets")
		if err != nil {
			return nil, err
		}
		resp.Assets = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxTime(newCursor, maxField(items, func(a model.Asset) string { return a.UpdatedAt }), deletedAt)
	}

	if includeCanvas {
		revision, err := strconv.ParseUint(canvasCursor, 10, 64)
		if canvasCursor != "" && err != nil {
			return nil, err
		}
		facts, err := repository.ListCanvasSyncFacts(userID, revision)
		if err != nil {
			return nil, err
		}
		items := make([]model.CanvasProject, 0, len(facts))
		deletes := make([]string, 0, len(facts))
		for _, fact := range facts {
			if fact.Project != nil {
				items = append(items, *fact.Project)
			} else {
				deletes = append(deletes, fact.DeleteID)
			}
			revision = fact.Revision
		}
		resp.Canvas = SyncDomain{Cursor: strconv.FormatUint(revision, 10), Updates: items, Deletes: deletes}
	}

	if includeTasks {
		items, err := repository.ListUpdatedGenerationTasks(userID, cursor)
		if err != nil {
			return nil, err
		}
		deletes, deletedAt, err := fetchDeletes(userID, cursor, "generation_tasks")
		if err != nil {
			return nil, err
		}
		resp.Tasks = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxTime(newCursor, maxField(items, func(t model.GenerationTask) string { return t.UpdatedAt }), deletedAt)
	}

	resp.Cursor = newCursor
	return resp, nil
}

// fetchDeletes returns the deleted IDs for a table plus the latest deleted_at
// (as RFC3339 string). Empty time string when no deletes.
func fetchDeletes(userID, cursor, tableName string) ([]string, string, error) {
	records, err := repository.ListDeletedRecords(userID, cursor)
	if err != nil {
		return nil, "", err
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
	return ids, latest, nil
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

// maxField returns the max of fn(item) over all items — generic over the item
// type so the three domains share one implementation instead of three copies.
func maxField[T any](items []T, fn func(T) string) string {
	var max string
	for _, i := range items {
		if v := fn(i); v > max {
			max = v
		}
	}
	return max
}
