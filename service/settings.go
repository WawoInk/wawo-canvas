package service

import (
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func PublicSettings() (model.PublicSetting, error) {
	settings, err := repository.GetSettings()
	return normalizeSettings(settings).Public, err
}

func AdminSettings() (model.Settings, error) {
	settings, err := repository.GetSettings()
	return hidePrivateAPIKeys(normalizeSettings(settings)), err
}

func SaveSettings(settings model.Settings) (model.Settings, error) {
	saved, err := repository.GetSettings()
	if err != nil {
		return model.Settings{}, err
	}
	settings = normalizeSettings(settings)
	keepPrivateAPIKeys(&settings, normalizeSettings(saved))
	keepPrivateAuthSecrets(&settings, normalizeSettings(saved))
	if err := ValidateGenerationBindings(settings); err != nil {
		return model.Settings{}, err
	}
	result, err := repository.SaveSettings(settings, now())
	if err == nil {
		RefreshPromptSyncScheduler()
	}
	return hidePrivateAPIKeys(result), err
}

func normalizeSettings(settings model.Settings) model.Settings {
	settings.Private = normalizePrivateSetting(settings.Private)
	settings.Public = normalizePublicSettingWithChannels(settings.Public, settings.Private.Channels)
	if settings.Private.GenerationProfiles != nil {
		bindingIDs := []string{}
		upstreamModels := map[string]bool{}
		for _, binding := range settings.Private.GenerationProfiles {
			if !binding.Enabled || binding.ID == "" || binding.UpstreamModel == "" {
				continue
			}
			bindingIDs = append(bindingIDs, binding.ID)
			upstreamModels[binding.UpstreamModel] = true
		}
		settings.Public.ModelChannel.AvailableModels = replaceBoundUpstreamModels(settings.Public.ModelChannel.AvailableModels, upstreamModels, bindingIDs)
		settings.Public.ModelChannel.VideoModels = replaceBoundUpstreamModels(settings.Public.ModelChannel.VideoModels, upstreamModels, bindingIDs)
	}
	return settings
}

func replaceBoundUpstreamModels(models []string, upstreamModels map[string]bool, profileIDs []string) []string {
	result := []string{}
	for _, modelName := range models {
		if !upstreamModels[modelName] {
			result = append(result, modelName)
		}
	}
	return uniqueModelNames(append(result, profileIDs...))
}

func normalizePublicSetting(setting model.PublicSetting) model.PublicSetting {
	return normalizePublicSettingWithChannels(setting, nil)
}

func normalizePublicSettingWithChannels(setting model.PublicSetting, channels []model.ModelChannel) model.PublicSetting {
	if setting.ModelChannel.AvailableModels == nil {
		setting.ModelChannel.AvailableModels = []string{}
	}
	if setting.ModelChannel.ModelCosts == nil {
		setting.ModelChannel.ModelCosts = []model.ModelCost{}
	}
	for i := range setting.ModelChannel.ModelCosts {
		setting.ModelChannel.ModelCosts[i].Model = strings.TrimSpace(setting.ModelChannel.ModelCosts[i].Model)
		if setting.ModelChannel.ModelCosts[i].Credits < 0 {
			setting.ModelChannel.ModelCosts[i].Credits = 0
		}
	}
	if setting.ModelChannel.AllowCustomChannel == nil {
		enabled := true
		setting.ModelChannel.AllowCustomChannel = &enabled
	}
	if setting.Auth.AllowRegister == nil {
		enabled := true
		setting.Auth.AllowRegister = &enabled
	}
	enabledModels := enabledChannelModels(channels)
	if len(enabledModels) > 0 {
		setting.ModelChannel.AvailableModels = enabledModels
	} else {
		setting.ModelChannel.AvailableModels = uniqueModelNames(setting.ModelChannel.AvailableModels)
	}
	// nil → empty for new per-capability list fields (backward compatible)
	if setting.ModelChannel.ImageModels == nil {
		setting.ModelChannel.ImageModels = []string{}
	}
	if setting.ModelChannel.VideoModels == nil {
		setting.ModelChannel.VideoModels = []string{}
	}
	if setting.ModelChannel.TextModels == nil {
		setting.ModelChannel.TextModels = []string{}
	}
	if setting.ModelChannel.AudioModels == nil {
		setting.ModelChannel.AudioModels = []string{}
	}
	for _, modelName := range setting.ModelChannel.AvailableModels {
		switch {
		case isImageModelName(modelName):
			setting.ModelChannel.ImageModels = append(setting.ModelChannel.ImageModels, modelName)
		case isVideoModelName(modelName):
			setting.ModelChannel.VideoModels = append(setting.ModelChannel.VideoModels, modelName)
		case isAudioModelName(modelName):
			setting.ModelChannel.AudioModels = append(setting.ModelChannel.AudioModels, modelName)
		case isTextModelName(modelName):
			setting.ModelChannel.TextModels = append(setting.ModelChannel.TextModels, modelName)
		}
	}
	setting.ModelChannel.ImageModels = uniqueModelNames(setting.ModelChannel.ImageModels)
	setting.ModelChannel.VideoModels = uniqueModelNames(setting.ModelChannel.VideoModels)
	setting.ModelChannel.TextModels = uniqueModelNames(setting.ModelChannel.TextModels)
	setting.ModelChannel.AudioModels = uniqueModelNames(setting.ModelChannel.AudioModels)
	setting.ModelChannel.DefaultTextModel = repairDefaultModel(setting.ModelChannel.DefaultTextModel, setting.ModelChannel.AvailableModels, isTextModelName)
	setting.ModelChannel.DefaultImageModel = repairDefaultModel(setting.ModelChannel.DefaultImageModel, setting.ModelChannel.AvailableModels, isImageModelName)
	setting.ModelChannel.DefaultVideoModel = repairDefaultModel(setting.ModelChannel.DefaultVideoModel, setting.ModelChannel.AvailableModels, isVideoModelName)
	setting.ModelChannel.DefaultAudioModel = repairDefaultModel(setting.ModelChannel.DefaultAudioModel, setting.ModelChannel.AvailableModels, isAudioModelName)
	setting.ModelChannel.DefaultModel = repairDefaultModel(setting.ModelChannel.DefaultModel, setting.ModelChannel.AvailableModels, isTextModelName)
	return setting
}

func ModelCost(modelName string) (int, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return 0, err
	}
	modelName = strings.TrimSpace(modelName)
	for _, item := range normalizePublicSetting(settings.Public).ModelChannel.ModelCosts {
		if item.Model == modelName {
			return item.Credits, nil
		}
	}
	return 0, nil
}

func generationBindingModels(binding model.GenerationProfileBinding) []string {
	if binding.UpstreamModel != "" {
		return []string{binding.UpstreamModel}
	}
	return uniqueModelNames(binding.UpstreamModels)
}

func normalizePrivateSetting(setting model.PrivateSetting) model.PrivateSetting {
	if setting.Channels == nil {
		setting.Channels = []model.ModelChannel{}
	}
	setting.PromptSync = normalizePromptSyncSetting(setting.PromptSync)
	for i := range setting.Channels {
		if setting.Channels[i].Protocol == "" {
			setting.Channels[i].Protocol = "openai"
		}
		if setting.Channels[i].Models == nil {
			setting.Channels[i].Models = []string{}
		}
		if setting.Channels[i].Weight <= 0 {
			setting.Channels[i].Weight = 1
		}
	}
	for i := range setting.GenerationProfiles {
		binding := &setting.GenerationProfiles[i]
		binding.ID = strings.TrimSpace(binding.ID)
		binding.ProfileID = strings.TrimSpace(binding.ProfileID)
		binding.UpstreamModel = strings.TrimSpace(binding.UpstreamModel)
		binding.UpstreamModels = uniqueModelNames(binding.UpstreamModels)
		// Legacy multi-model bindings remain readable, but new bindings select one model.
		if binding.UpstreamModel == "" && len(binding.UpstreamModels) == 1 {
			binding.UpstreamModel = binding.UpstreamModels[0]
		}
		if binding.ID == "" {
			binding.ID = binding.UpstreamModel
		}
		binding.ChannelName = strings.TrimSpace(binding.ChannelName)
	}
	setting.FileSizeLimits = normalizeFileSizeLimits(setting.FileSizeLimits)
	return setting
}

func normalizeFileSizeLimits(f model.FileSizeLimits) model.FileSizeLimits {
	if f.Image <= 0 {
		f.Image = 30 << 20 // 30 MB
	}
	if f.Video <= 0 {
		f.Video = 50 << 20 // 50 MB
	}
	if f.Audio <= 0 {
		f.Audio = 15 << 20 // 15 MB
	}
	if f.Prompt <= 0 {
		f.Prompt = 5 << 20 // 5 MB
	}
	return f
}

func hidePrivateAPIKeys(settings model.Settings) model.Settings {
	for i := range settings.Private.Channels {
		settings.Private.Channels[i].APIKey = ""
	}
	settings.Private.Auth.LinuxDo.ClientSecret = ""
	return settings
}

func keepPrivateAPIKeys(settings *model.Settings, saved model.Settings) {
	for i := range settings.Private.Channels {
		if strings.TrimSpace(settings.Private.Channels[i].APIKey) != "" {
			continue
		}
		if channel, ok := findSavedChannel(settings.Private.Channels[i], saved.Private.Channels, i); ok {
			settings.Private.Channels[i].APIKey = channel.APIKey
		}
	}
}

func keepPrivateAuthSecrets(settings *model.Settings, saved model.Settings) {
	if strings.TrimSpace(settings.Private.Auth.LinuxDo.ClientSecret) == "" {
		settings.Private.Auth.LinuxDo.ClientSecret = saved.Private.Auth.LinuxDo.ClientSecret
	}
}

func findSavedChannel(channel model.ModelChannel, saved []model.ModelChannel, index int) (model.ModelChannel, bool) {
	for _, item := range saved {
		if item.Name == channel.Name && item.BaseURL == channel.BaseURL {
			return item, true
		}
	}
	if index < len(saved) {
		return saved[index], true
	}
	return model.ModelChannel{}, false
}
