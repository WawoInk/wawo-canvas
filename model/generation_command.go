package model

// GenerationCommand is the first-party generation request envelope.
type GenerationCommand struct {
	CommandVersion  int              `json:"commandVersion"`
	ClientRequestID string           `json:"clientRequestId"`
	ModelProfileID  string           `json:"modelProfileId"`
	Source          string           `json:"source"`
	Intent          GenerationIntent `json:"intent"`
}

// FirstPartyGenerationResult is the initial normalized video result projection.
type FirstPartyGenerationResult struct {
	VideoURL string `json:"videoUrl"`
}

// FirstPartyGenerationTask is the stable task projection returned to first-party clients.
type FirstPartyGenerationTask struct {
	ID             string                      `json:"id"`
	Status         TaskStatus                  `json:"status"`
	ModelProfileID string                      `json:"modelProfileId"`
	IntentKind     GenerationIntentKind        `json:"intentKind"`
	Result         *FirstPartyGenerationResult `json:"result,omitempty"`
	ErrorCode      string                      `json:"errorCode,omitempty"`
	ErrorMessage   string                      `json:"errorMessage,omitempty"`
	CreatedAt      string                      `json:"createdAt"`
}
