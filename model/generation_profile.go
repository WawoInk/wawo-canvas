package model

// GenerationIntentKind identifies a platform generation intent.
type GenerationIntentKind string

const IntentVideoGenerate GenerationIntentKind = "video.generate"

// GenerationProfile is the public, code-versioned model capability projection.
type GenerationProfile struct {
	ID            string                 `json:"id"`
	Version       int                    `json:"version"`
	DisplayName   string                 `json:"displayName"`
	AdapterKey    string                 `json:"adapterKey"`
	UpstreamModel string                 `json:"-"`
	Intents       []GenerationIntentKind `json:"intents"`
}

// MediaReference identifies an authorized platform file.
type MediaReference struct {
	FileID       string `json:"fileId"`
	SourceNodeID string `json:"sourceNodeId,omitempty"`
	Name         string `json:"name,omitempty"`
}

// GenerationReferences groups typed platform media references.
type GenerationReferences struct {
	Images []MediaReference `json:"images"`
	Videos []MediaReference `json:"videos"`
	Audios []MediaReference `json:"audios"`
}

// GenerationIntent is the typed first-party intent used by the initial video tracer.
type GenerationIntent struct {
	Kind       GenerationIntentKind `json:"kind"`
	Prompt     string               `json:"prompt"`
	References GenerationReferences `json:"references,omitempty"`
}
