package service

import (
	"fmt"
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
	saved = normalizeSettings(saved)
	keepPrivateAPIKeys(&settings, saved)
	keepPrivateAuthSecrets(&settings, saved)
	keepLegacyGenerationCredits(&settings, saved)
	migrateLegacyGenerationCosts(&settings)
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
	migrateLegacyGenerationCosts(&settings)
	if settings.Private.GenerationProfiles != nil {
		bindingIDsByUpstreamModel := map[string][]string{}
		for _, binding := range settings.Private.GenerationProfiles {
			if !binding.Enabled || binding.ID == "" || binding.UpstreamModel == "" {
				continue
			}
			bindingIDsByUpstreamModel[binding.UpstreamModel] = append(bindingIDsByUpstreamModel[binding.UpstreamModel], binding.ID)
		}
		settings.Public.ModelChannel.AvailableModels = replaceBoundUpstreamModels(settings.Public.ModelChannel.AvailableModels, bindingIDsByUpstreamModel)
		settings.Public.ModelChannel.VideoModels = replaceBoundUpstreamModels(settings.Public.ModelChannel.VideoModels, bindingIDsByUpstreamModel)
	}
	return settings
}

func migrateLegacyGenerationCosts(settings *model.Settings) {
	configured := map[string]bool{}
	for _, cost := range settings.Public.ModelChannel.ModelCosts {
		configured[cost.Model] = true
	}
	legacy := map[string]int{}
	conflicts := map[string]bool{}
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.LegacyCredits == nil || binding.UpstreamModel == "" || configured[binding.UpstreamModel] {
			continue
		}
		credits := max(0, *binding.LegacyCredits)
		if existing, ok := legacy[binding.UpstreamModel]; ok && existing != credits {
			conflicts[binding.UpstreamModel] = true
			continue
		}
		legacy[binding.UpstreamModel] = credits
	}
	for modelName, credits := range legacy {
		if !conflicts[modelName] {
			settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: modelName, Credits: credits})
		}
	}
}

func replaceBoundUpstreamModels(models []string, bindingIDsByUpstreamModel map[string][]string) []string {
	result := []string{}
	for _, modelName := range models {
		if bindingIDs := bindingIDsByUpstreamModel[modelName]; len(bindingIDs) > 0 {
			result = append(result, bindingIDs...)
			continue
		}
		result = append(result, modelName)
	}
	return uniqueModelNames(result)
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
	inferImageModels := setting.ModelChannel.ImageModels == nil
	inferVideoModels := setting.ModelChannel.VideoModels == nil
	inferTextModels := setting.ModelChannel.TextModels == nil
	inferAudioModels := setting.ModelChannel.AudioModels == nil
	if inferImageModels {
		setting.ModelChannel.ImageModels = []string{}
	}
	if inferVideoModels {
		setting.ModelChannel.VideoModels = []string{}
	}
	if inferTextModels {
		setting.ModelChannel.TextModels = []string{}
	}
	if inferAudioModels {
		setting.ModelChannel.AudioModels = []string{}
	}
	for _, modelName := range setting.ModelChannel.AvailableModels {
		switch {
		case inferImageModels && isImageModelName(modelName):
			setting.ModelChannel.ImageModels = append(setting.ModelChannel.ImageModels, modelName)
		case inferVideoModels && isVideoModelName(modelName):
			setting.ModelChannel.VideoModels = append(setting.ModelChannel.VideoModels, modelName)
		case inferAudioModels && isAudioModelName(modelName):
			setting.ModelChannel.AudioModels = append(setting.ModelChannel.AudioModels, modelName)
		case inferTextModels && isTextModelName(modelName):
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
	settings = normalizeSettings(settings)
	modelName = strings.TrimSpace(modelName)
	for _, item := range settings.Public.ModelChannel.ModelCosts {
		if item.Model == modelName {
			return item.Credits, nil
		}
	}
	legacyCost := -1
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.UpstreamModel != modelName || binding.LegacyCredits == nil {
			continue
		}
		credits := max(0, *binding.LegacyCredits)
		if legacyCost >= 0 && legacyCost != credits {
			return 0, fmt.Errorf("模型 %s 存在冲突的历史扣费，请在公开配置中设置统一算力点", modelName)
		}
		legacyCost = credits
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

func keepLegacyGenerationCredits(settings *model.Settings, saved model.Settings) {
	legacy := map[string]*int{}
	for _, binding := range saved.Private.GenerationProfiles {
		legacy[binding.ID] = binding.LegacyCredits
	}
	for i := range settings.Private.GenerationProfiles {
		binding := &settings.Private.GenerationProfiles[i]
		if binding.LegacyCredits == nil {
			binding.LegacyCredits = legacy[binding.ID]
		}
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
