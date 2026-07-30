package service

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestVideoHistoryAcceptsLegacyTaskWithoutFirstPartyFieldsOrPayload(t *testing.T) {
	dto := ToVideoHistoryDTO(model.GenerationTask{
		ID:             "legacy-video-1",
		TaskType:       model.TaskTypeVideo,
		Model:          "seedance-legacy",
		Status:         model.TaskStatusSuccess,
		UpstreamTaskID: "upstream-legacy-1",
		Credits:        credit(12),
		CreatedAt:      "2026-01-01T00:00:00Z",
	}, nil)

	if dto.ID != "legacy-video-1" || dto.Model != "seedance-legacy" || dto.Status != "success" || dto.UpstreamTaskID != "upstream-legacy-1" {
		t.Fatalf("legacy history DTO = %#v", dto)
	}
	if dto.Prompt != "" || dto.VideoURL != "" || dto.Size != "" || dto.Vquality != "" || dto.VideoSeconds != "" || dto.GenAudio != "" || dto.Watermark != "" {
		t.Fatalf("legacy optional fields should remain empty: %#v", dto)
	}
}
