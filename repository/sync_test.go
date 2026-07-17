package repository

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestMergeCanvasSyncFactsOrdersAndLimitsMixedFacts(t *testing.T) {
	projects := make([]model.CanvasProject, 150)
	deletes := make([]model.DeletedRecord, 150)
	for i := range projects {
		projects[i].Revision = uint64(i*2 + 1)
		deletes[i].Revision = uint64(i*2 + 2)
		deletes[i].RecordID = "deleted"
	}
	facts := mergeCanvasSyncFacts(projects, deletes)
	if len(facts) != syncLimit {
		t.Fatalf("got %d facts, want %d", len(facts), syncLimit)
	}
	for i, fact := range facts {
		if fact.Revision != uint64(i+1) {
			t.Fatalf("fact %d has revision %d", i, fact.Revision)
		}
	}
}
