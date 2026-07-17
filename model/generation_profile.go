package model

// GenerationIntentKind identifies a platform generation intent.
type GenerationIntentKind string

const (
	IntentVideoGenerate   GenerationIntentKind = "video.generate"
	IntentVideoShortDrama GenerationIntentKind = "video.short-drama"
)

// GenerationProfile is the public, code-versioned model capability projection.
type GenerationProfile struct {
	ID            string                 `json:"id"`
	Version       int                    `json:"version"`
	DisplayName   string                 `json:"displayName"`
	AdapterKey    string                 `json:"adapterKey"`
	UpstreamModel string                 `json:"-"`
	ChannelName   string                 `json:"-"`
	Credits       *int                   `json:"-"`
	Intents       []GenerationIntentKind `json:"intents"`
	Capabilities  GenerationCapabilities `json:"capabilities"`
}

// GenerationSettingType identifies the validation shape of a scalar setting.
type GenerationSettingType string

const (
	GenerationSettingEnum     GenerationSettingType = "enum"
	GenerationSettingDuration GenerationSettingType = "duration"
	GenerationSettingBoolean  GenerationSettingType = "boolean"
)

// GenerationSettingDefinition is the public, provider-neutral setting contract.
type GenerationSettingDefinition struct {
	Type      GenerationSettingType `json:"type"`
	Values    []string              `json:"values,omitempty"`
	Min       *int                  `json:"min,omitempty"`
	Max       *int                  `json:"max,omitempty"`
	AllowAuto bool                  `json:"allowAuto,omitempty"`
	Default   any                   `json:"default"`
}

// GenerationTextDefinition declares a constrained short-drama text field.
type GenerationTextDefinition struct {
	Required     bool `json:"required"`
	MinLength    int  `json:"minLength"`
	MaxLength    int  `json:"maxLength"`
	CJKMaxLength int  `json:"cjkMaxLength,omitempty"`
}

// GenerationAssetDefinition declares a constrained short-drama asset collection.
type GenerationAssetDefinition struct {
	Required      bool                  `json:"required"`
	Min           int                   `json:"min"`
	Max           int                   `json:"max"`
	NameMaxLength int                   `json:"nameMaxLength"`
	Roles         []ShortDramaAssetRole `json:"roles"`
	MimeTypes     []string              `json:"mimeTypes"`
}

// GenerationCapabilities declares the settings and structured inputs supported by a profile.
type GenerationCapabilities struct {
	Title        *GenerationTextDefinition              `json:"title,omitempty"`
	Script       *GenerationTextDefinition              `json:"script,omitempty"`
	Assets       *GenerationAssetDefinition             `json:"assets,omitempty"`
	Settings     map[string]GenerationSettingDefinition `json:"settings"`
	Cancellation bool                                   `json:"cancellation"`
	Completion   []string                               `json:"completion"`
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

// ScalarSettings contains only profile-declared scalar values.
type ScalarSettings map[string]any

// ShortDramaAssetRole is an explicit per-target role for a short-drama image.
type ShortDramaAssetRole string

const (
	ShortDramaAssetCharacter ShortDramaAssetRole = "character"
	ShortDramaAssetScene     ShortDramaAssetRole = "scene"
	ShortDramaAssetTool      ShortDramaAssetRole = "tool"
)

// ShortDramaAsset describes one classified image in a short-drama intent.
type ShortDramaAsset struct {
	SourceNodeID string              `json:"sourceNodeId"`
	Role         ShortDramaAssetRole `json:"role"`
	Name         string              `json:"name"`
	Description  string              `json:"description,omitempty"`
	Reference    MediaReference      `json:"reference"`
}

// GenerationIntent is a discriminated first-party generation intent.
type GenerationIntent struct {
	Kind       GenerationIntentKind `json:"kind"`
	Prompt     string               `json:"prompt,omitempty"`
	References GenerationReferences `json:"references,omitempty"`
	Title      string               `json:"title,omitempty"`
	Script     string               `json:"script,omitempty"`
	Assets     []ShortDramaAsset    `json:"assets,omitempty"`
	Settings   ScalarSettings       `json:"settings,omitempty"`
}
