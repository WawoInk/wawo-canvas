package model

// GenerationCommand is the first-party generation request envelope.
type GenerationCommand struct {
	CommandVersion  int              `json:"commandVersion"`
	ClientRequestID string           `json:"clientRequestId"`
	ModelProfileID  string           `json:"modelProfileId"`
	Source          string           `json:"source"`
	Intent          GenerationIntent `json:"intent"`
}

type GenerationCommandSummary struct {
	CommandVersion  int                  `json:"commandVersion"`
	ClientRequestID string               `json:"clientRequestId"`
	ModelProfileID  string               `json:"modelProfileId"`
	Source          string               `json:"source"`
	IntentKind      GenerationIntentKind `json:"intentKind"`
	FileIDs         []string             `json:"fileIds,omitempty"`
}

type GenerationError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Retryable  bool   `json:"retryable"`
	FieldPath  string `json:"fieldPath,omitempty"`
	ResourceID string `json:"resourceId,omitempty"`
}

// GeneratedFile is a platform-owned generated media file.
type GeneratedFile struct {
	FileID   string `json:"fileId"`
	MimeType string `json:"mimeType"`
	Bytes    int64  `json:"bytes,omitempty"`
}

// GenerationShot is normalized short-drama shot information.
type GenerationShot struct {
	Index           int     `json:"index"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
	FileID          string  `json:"fileId,omitempty"`
	Status          string  `json:"status"`
}

// FirstPartyGenerationResult is a discriminated platform-owned video result.
type FirstPartyGenerationResult struct {
	Kind  string           `json:"kind"`
	File  GeneratedFile    `json:"file"`
	Shots []GenerationShot `json:"shots,omitempty"`
}

// FirstPartyGenerationTask is the stable task projection returned to first-party clients.
type FirstPartyGenerationTask struct {
	ID             string                      `json:"id"`
	Status         TaskStatus                  `json:"status"`
	ModelProfileID string                      `json:"modelProfileId"`
	IntentKind     GenerationIntentKind        `json:"intentKind"`
	Result         *FirstPartyGenerationResult `json:"result,omitempty"`
	Error          *GenerationError            `json:"error,omitempty"`
	CreatedAt      string                      `json:"createdAt"`
}
