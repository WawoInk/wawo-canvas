package service

import (
	"fmt"
	"maps"
	"math"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type GenerationValidationError struct {
	Code       string
	FieldPath  string
	Message    string
	Retryable  bool
	ResourceID string
}

func NewGenerationValidationError(code, fieldPath, message string, retryable bool, resourceID string) GenerationValidationError {
	return GenerationValidationError{Code: code, FieldPath: fieldPath, Message: message, Retryable: retryable, ResourceID: resourceID}
}

func (err GenerationValidationError) Error() string {
	return fmt.Sprintf("%s: %s", err.FieldPath, err.Message)
}

func (err GenerationValidationError) SafeMessage() string { return err.Message }

func (err GenerationValidationError) FailureData() any {
	data := map[string]any{"code": err.Code, "retryable": err.Retryable, "fieldPath": err.FieldPath}
	if err.ResourceID != "" {
		data["resourceId"] = err.ResourceID
	}
	return data
}

func invalidCommand(fieldPath, message, resourceID string) GenerationValidationError {
	return NewGenerationValidationError("INVALID_COMMAND", fieldPath, message, false, resourceID)
}

func invalidSetting(fieldPath, message string) GenerationValidationError {
	return NewGenerationValidationError("INVALID_SETTING", fieldPath, message, false, "")
}

func GenerationProfiles() []model.GenerationProfile {
	return []model.GenerationProfile{
		{
			ID:            "seedance-1-5-pro",
			Version:       1,
			DisplayName:   "Seedance 1.5 Pro",
			AdapterKey:    "seedance-contents-v1",
			UpstreamModel: "seedance-1-5-pro",
			Intents:       []model.GenerationIntentKind{model.IntentVideoGenerate},
			Capabilities:  seedanceCapabilities(),
		},
		{
			ID:            "vidu-q3-drama",
			Version:       1,
			DisplayName:   "Vidu Q3 Drama",
			AdapterKey:    "vidu-short-drama-v1",
			UpstreamModel: "viduq3-drama-oversea",
			Intents:       []model.GenerationIntentKind{model.IntentVideoShortDrama},
			Capabilities:  viduDramaCapabilities(),
		},
	}
}

func seedanceCapabilities() model.GenerationCapabilities {
	return model.GenerationCapabilities{
		Settings: map[string]model.GenerationSettingDefinition{
			"aspectRatio":     {Type: model.GenerationSettingEnum, Values: []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}, Default: "adaptive"},
			"resolution":      {Type: model.GenerationSettingEnum, Values: []string{"480p", "720p", "1080p"}, Default: "720p"},
			"durationSeconds": {Type: model.GenerationSettingDuration, Min: intPtr(4), Max: intPtr(15), AllowAuto: true, Default: -1},
			"generateAudio":   {Type: model.GenerationSettingBoolean, Default: true},
			"watermark":       {Type: model.GenerationSettingBoolean, Default: false},
		},
		Completion: []string{"poll"},
	}
}

func viduDramaCapabilities() model.GenerationCapabilities {
	return model.GenerationCapabilities{
		Title:  &model.GenerationTextDefinition{Required: true, MinLength: 1, MaxLength: 20},
		Script: &model.GenerationTextDefinition{Required: true, MinLength: 20, MaxLength: 5000, CJKMaxLength: 2000},
		Assets: &model.GenerationAssetDefinition{
			Required: true, Min: 1, Max: 14, NameMaxLength: 30,
			Roles:     []model.ShortDramaAssetRole{model.ShortDramaAssetCharacter, model.ShortDramaAssetScene, model.ShortDramaAssetTool},
			MimeTypes: []string{"image/png", "image/jpeg", "image/webp"},
		},
		Settings: map[string]model.GenerationSettingDefinition{
			"aspectRatio":     {Type: model.GenerationSettingEnum, Values: []string{"16:9", "9:16"}, Default: "9:16"},
			"resolution":      {Type: model.GenerationSettingEnum, Values: []string{"1080p"}, Default: "1080p"},
			"durationSeconds": {Type: model.GenerationSettingDuration, Min: intPtr(8), Max: intPtr(12), AllowAuto: true, Default: "auto"},
			"quality":         {Type: model.GenerationSettingEnum, Values: []string{"standard", "high"}, Default: "high"},
		},
		Completion: []string{"callback", "poll"},
	}
}

func ValidateGenerationProfiles() error {
	seen := map[string]bool{}
	for _, profile := range GenerationProfiles() {
		if seen[profile.ID] {
			return fmt.Errorf("duplicate generation profile %q", profile.ID)
		}
		seen[profile.ID] = true
		if err := validateGenerationProfile(profile); err != nil {
			return err
		}
	}
	return nil
}

func validateGenerationProfile(profile model.GenerationProfile) error {
	if strings.TrimSpace(profile.ID) == "" || profile.Version < 1 || strings.TrimSpace(profile.UpstreamModel) == "" {
		return fmt.Errorf("invalid generation profile %q", profile.ID)
	}
	intentByAdapter := map[string]model.GenerationIntentKind{
		"seedance-contents-v1": model.IntentVideoGenerate,
		"vidu-short-drama-v1":  model.IntentVideoShortDrama,
	}
	intent, ok := intentByAdapter[profile.AdapterKey]
	if !ok || len(profile.Intents) != 1 || !profileSupportsIntent(profile, intent) {
		return fmt.Errorf("profile %q has no supported intent", profile.ID)
	}
	completion := map[string]bool{}
	for _, capability := range profile.Capabilities.Completion {
		if capability != "poll" && capability != "callback" || completion[capability] {
			return fmt.Errorf("profile %q has unsupported completion capabilities", profile.ID)
		}
		completion[capability] = true
	}
	if !completion["poll"] {
		return fmt.Errorf("profile %q has unsupported completion capabilities", profile.ID)
	}
	for key, definition := range profile.Capabilities.Settings {
		if strings.TrimSpace(key) == "" {
			return fmt.Errorf("profile %q has an empty setting key", profile.ID)
		}
		if _, err := validateGenerationSetting(definition, definition.Default); err != nil {
			return fmt.Errorf("profile %q setting %q: %w", profile.ID, key, err)
		}
	}
	if profile.AdapterKey == "vidu-short-drama-v1" {
		if profile.Capabilities.Title == nil || profile.Capabilities.Script == nil || profile.Capabilities.Assets == nil || profile.Capabilities.Assets.Min < 1 || profile.Capabilities.Assets.Max < profile.Capabilities.Assets.Min || len(profile.Capabilities.Assets.Roles) == 0 || len(profile.Capabilities.Assets.MimeTypes) == 0 {
			return fmt.Errorf("profile %q has invalid short-drama capabilities", profile.ID)
		}
	}
	return nil
}

func normalizeGenerationSettings(profile model.GenerationProfile, provided model.ScalarSettings) (model.ScalarSettings, error) {
	for key := range provided {
		if _, ok := profile.Capabilities.Settings[key]; !ok {
			return nil, invalidSetting("intent.settings."+key, "unsupported setting")
		}
	}
	normalized := make(model.ScalarSettings, len(profile.Capabilities.Settings))
	for key, definition := range profile.Capabilities.Settings {
		value, ok := provided[key]
		if !ok {
			value = definition.Default
		}
		validated, err := validateGenerationSetting(definition, value)
		if err != nil {
			return nil, invalidSetting("intent.settings."+key, err.Error())
		}
		normalized[key] = validated
	}
	return normalized, nil
}

func ValidateGenerationBindings(settings model.Settings) error {
	_, err := resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(settings.Private))
	return err
}

func resolveGenerationProfiles(templates []model.GenerationProfile, private model.PrivateSetting) ([]model.GenerationProfile, error) {
	if private.GenerationProfiles == nil {
		profiles := []model.GenerationProfile{}
		for _, profile := range templates {
			if len(modelChannelsForModel(private.Channels, profile.UpstreamModel)) > 0 {
				profiles = append(profiles, profile)
			}
		}
		return profiles, nil
	}

	profiles := []model.GenerationProfile{}
	seen := map[string]bool{}
	for _, binding := range private.GenerationProfiles {
		if !binding.Enabled {
			continue
		}
		template, ok := findGenerationProfile(templates, binding.ProfileID)
		if !ok {
			return nil, safeMessageError{message: fmt.Sprintf("unknown generation profile %q", binding.ProfileID)}
		}
		models := generationBindingModels(binding)
		if len(models) == 0 || (binding.Credits != nil && *binding.Credits < 0) {
			return nil, safeMessageError{message: fmt.Sprintf("invalid generation profile binding %q", binding.ProfileID)}
		}
		for _, upstreamModel := range models {
			profile := template
			profile.Capabilities.Settings = maps.Clone(template.Capabilities.Settings)
			profile.UpstreamModel = upstreamModel
			profile.ChannelName = strings.TrimSpace(binding.ChannelName)
			profile.ID = upstreamModel
			profile.DisplayName = upstreamModel
			if seen[profile.ID] {
				return nil, safeMessageError{message: fmt.Sprintf("duplicate generation model binding %q", profile.ID)}
			}
			seen[profile.ID] = true
			if binding.Credits != nil {
				profile.Credits = intPtr(*binding.Credits)
			}
			channels := modelChannelsForModel(private.Channels, profile.UpstreamModel)
			if binding.ChannelName != "" {
				channels = channels[:0]
				for _, channel := range modelChannelsForModel(private.Channels, profile.UpstreamModel) {
					if channel.Name == binding.ChannelName {
						channels = append(channels, channel)
					}
				}
			}
			if len(channels) == 0 {
				return nil, safeMessageError{message: fmt.Sprintf("generation profile %q model %q has no enabled channel binding", binding.ProfileID, upstreamModel)}
			}
			if max := binding.LimitOverrides.DurationSecondsMax; max != nil {
				definition := profile.Capabilities.Settings["durationSeconds"]
				if definition.Min == nil || definition.Max == nil || *max < *definition.Min || *max > *definition.Max {
					return nil, safeMessageError{message: fmt.Sprintf("generation profile %q has an unsafe duration limit override", binding.ProfileID)}
				}
				definition.Max = intPtr(*max)
				profile.Capabilities.Settings["durationSeconds"] = definition
			}
			profiles = append(profiles, profile)
		}
	}
	return profiles, nil
}

func AvailableGenerationProfiles() ([]model.GenerationProfile, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return nil, err
	}
	return resolveGenerationProfiles(GenerationProfiles(), normalizePrivateSetting(settings.Private))
}

func ValidateStoredGenerationBindings() error {
	settings, err := repository.GetSettings()
	if err != nil {
		return err
	}
	return ValidateGenerationBindings(settings)
}

func validateGenerationSetting(definition model.GenerationSettingDefinition, value any) (any, error) {
	switch definition.Type {
	case model.GenerationSettingEnum:
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("must be a string")
		}
		for _, allowed := range definition.Values {
			if text == allowed {
				return text, nil
			}
		}
		return nil, fmt.Errorf("value is not allowed")
	case model.GenerationSettingDuration:
		if definition.AllowAuto && definition.Default == "auto" && value == "auto" {
			return "auto", nil
		}
		number, ok := scalarInteger(value)
		if !ok {
			return nil, fmt.Errorf("must be an integer")
		}
		if definition.AllowAuto && definition.Default != "auto" && number == -1 {
			return number, nil
		}
		if definition.Min == nil || definition.Max == nil || number < *definition.Min || number > *definition.Max {
			return nil, fmt.Errorf("value is outside the allowed range")
		}
		return number, nil
	case model.GenerationSettingBoolean:
		boolean, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("must be a boolean")
		}
		return boolean, nil
	default:
		return nil, fmt.Errorf("unknown setting type %q", definition.Type)
	}
}

func scalarInteger(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case float64:
		if math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) || number < math.MinInt || number > math.MaxInt {
			return 0, false
		}
		return int(number), true
	default:
		return 0, false
	}
}

func profileSupportsIntent(profile model.GenerationProfile, intent model.GenerationIntentKind) bool {
	for _, supported := range profile.Intents {
		if supported == intent {
			return true
		}
	}
	return false
}

func intPtr(value int) *int { return &value }
