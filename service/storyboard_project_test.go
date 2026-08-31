package service

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestNormalizeStoryboardDocumentPreservesIDsWhenEntitiesAreInsertedAndRenumbered(t *testing.T) {
	existing := json.RawMessage(`{"scenes":[{"id":"scene-existing","sceneNo":1,"segments":[{"id":"segment-existing","segmentNo":1,"shots":[{"id":"shot-first","shotNo":1},{"id":"shot-second","shotNo":2}]}]}]}`)
	updated := json.RawMessage(`{"scenes":[{"id":"","sceneNo":1,"segments":[]},{"id":"scene-existing","sceneNo":2,"segments":[{"id":"","segmentNo":1,"shots":[]},{"id":"segment-existing","segmentNo":2,"shots":[{"id":"","shotNo":1},{"id":"shot-first","shotNo":2},{"id":"shot-second","shotNo":3}]}]}]}`)

	normalized, err := normalizeStoryboardDocument(updated, existing)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Scenes []struct {
			ID       string `json:"id"`
			Segments []struct {
				ID    string `json:"id"`
				Shots []struct {
					ID string `json:"id"`
				} `json:"shots"`
			} `json:"segments"`
		} `json:"scenes"`
	}
	if err := json.Unmarshal(normalized, &document); err != nil {
		t.Fatal(err)
	}

	movedScene := document.Scenes[1]
	movedSegment := movedScene.Segments[1]
	if movedScene.ID != "scene-existing" || movedSegment.ID != "segment-existing" || movedSegment.Shots[1].ID != "shot-first" || movedSegment.Shots[2].ID != "shot-second" {
		t.Fatalf("existing IDs changed after insertion: %#v", document)
	}
	for _, id := range []string{document.Scenes[0].ID, movedScene.Segments[0].ID, movedSegment.Shots[0].ID} {
		if _, err := uuid.Parse(id); err != nil {
			t.Fatalf("new entity ID %q is not a UUID: %v", id, err)
		}
	}
}
