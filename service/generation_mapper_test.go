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

func TestHistoryMapsFirstPartySucceededStatusToSuccess(t *testing.T) {
	task := model.GenerationTask{
		ID:        "succeeded-history-1",
		TaskType:  model.TaskTypeVideo,
		Model:     "video-model",
		Status:    model.TaskStatusSucceeded,
		CreatedAt: "2026-01-01T00:00:00Z",
	}

	if got := ToVideoHistoryDTO(task, nil).Status; got != "success" {
		t.Fatalf("video history status = %q, want success", got)
	}
	if got := ToImageHistoryDTO(model.GenerationTask{
		ID:        "succeeded-history-2",
		TaskType:  model.TaskTypeImage,
		Model:     "image-model",
		Status:    model.TaskStatusSucceeded,
		CreatedAt: "2026-01-01T00:00:00Z",
	}, nil).Status; got != "success" {
		t.Fatalf("image history status = %q, want success", got)
	}
}

func TestVideoHistoryMapsFirstPartyWorkbenchResult(t *testing.T) {
	dto := ToVideoHistoryDTO(model.GenerationTask{
		ID:             "first-party-video-1",
		TaskType:       model.TaskTypeVideo,
		Source:         string(model.SourceVideoWorkbench),
		Model:          "seedance-1-5-pro",
		ModelProfileID: "seedance-profile",
		IntentKind:     string(model.IntentVideoGenerate),
		Status:         model.TaskStatusSucceeded,
		ResultJSON:     `{"kind":"video","file":{"fileId":"file-video-1","mimeType":"video/mp4","bytes":123}}`,
		CreatedAt:      "2026-08-20T00:00:00Z",
	}, &model.GenerationPayload{
		CommandBody: `{"commandVersion":1,"modelProfileId":"seedance-profile","source":"video_workbench","intent":{"kind":"video.generate","prompt":"雨夜街道","settings":{"aspectRatio":"9:16","resolution":"1080p","durationSeconds":10,"generateAudio":false,"watermark":true}}}`,
	})

	if dto.ModelProfileID != "seedance-profile" || dto.Prompt != "雨夜街道" || dto.Size != "9:16" || dto.Vquality != "1080p" || dto.VideoSeconds != "10" {
		t.Fatalf("first-party history fields = %#v", dto)
	}
	if len(dto.FileIDs) != 1 || dto.FileIDs[0] != "file-video-1" {
		t.Fatalf("first-party result file IDs = %#v", dto.FileIDs)
	}
}

func TestVideoHistoryDoesNotTreatFirstPartyInputFilesAsResults(t *testing.T) {
	dto := ToVideoHistoryDTO(model.GenerationTask{
		ID:             "first-party-video-failed",
		TaskType:       model.TaskTypeVideo,
		ModelProfileID: "seedance-profile",
		CommandVersion: 1,
		Status:         model.TaskStatusFailed,
		Metadata:       `{"fileIds":["file-reference-1"]}`,
		CreatedAt:      "2026-08-20T00:00:00Z",
	}, nil)

	if len(dto.FileIDs) != 0 {
		t.Fatalf("first-party input files leaked into result file IDs: %#v", dto.FileIDs)
	}
}
