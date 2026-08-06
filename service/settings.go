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
	hasChannelConfig := settings.Private.Channels != nil
	settings = normalizeSettings(settings)
	saved = normalizeSettings(saved)
	keepPrivateAPIKeys(&settings, saved)
	keepPrivateAuthSecrets(&settings, saved)
	keepLegacyGenerationCredits(&settings, saved)
	migrateLegacyGenerationCosts(&settings)
	filterModelCosts(&settings, hasChannelConfig)
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
	hasChannelConfig := settings.Private.Channels != nil
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
	filterModelCosts(&settings, hasChannelConfig)
	return settings
}

func filterModelCosts(settings *model.Settings, hasChannelConfig bool) {
	if !hasChannelConfig {
		return
	}
	allowed := map[string]bool{}
	for _, modelName := range enabledChannelModels(settings.Private.Channels) {
		allowed[modelName] = true
	}
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.Enabled && allowed[binding.UpstreamModel] {
			allowed[binding.ID] = true
		}
	}
	costs := settings.Public.ModelChannel.ModelCosts[:0]
	for _, cost := range settings.Public.ModelChannel.ModelCosts {
		if allowed[cost.Model] {
			costs = append(costs, cost)
		}
	}
	settings.Public.ModelChannel.ModelCosts = costs
}

func migrateLegacyGenerationCosts(settings *model.Settings) {
	configured := map[string]bool{}
	for _, cost := range settings.Public.ModelChannel.ModelCosts {
		configured[cost.Model] = true
	}
	legacy := map[string]model.Decimal{}
	conflicts := map[string]bool{}
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.LegacyCredits == nil || binding.UpstreamModel == "" || configured[binding.UpstreamModel] {
			continue
		}
		credits := *binding.LegacyCredits
		if credits.IsNegative() {
			credits = model.DecimalZero
		}
		if existing, ok := legacy[binding.UpstreamModel]; ok && !existing.Equal(credits) {
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
		setting.ModelChannel.ModelCosts[i].DisplayName = strings.TrimSpace(setting.ModelChannel.ModelCosts[i].DisplayName)
		if setting.ModelChannel.ModelCosts[i].Credits.IsNegative() {
			setting.ModelChannel.ModelCosts[i].Credits = model.DecimalZero
		}
		for resolution, credits := range setting.ModelChannel.ModelCosts[i].ResolutionCredits {
			if credits.IsNegative() {
				setting.ModelChannel.ModelCosts[i].ResolutionCredits[resolution] = model.DecimalZero
			}
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
	setting.ModelChannel.ImageModels = uniqueModelNames(setting.ModelChannel.ImageModels)
	setting.ModelChannel.VideoModels = uniqueModelNames(setting.ModelChannel.VideoModels)
	setting.ModelChannel.TextModels = uniqueModelNames(setting.ModelChannel.TextModels)
	setting.ModelChannel.AudioModels = uniqueModelNames(setting.ModelChannel.AudioModels)
	setting.ModelChannel.ImageRequestFormats = normalizeImageRequestFormats(setting.ModelChannel.ImageRequestFormats, setting.ModelChannel.ImageModels)
	setting.ModelChannel.DefaultTextModel = repairDefaultModel(setting.ModelChannel.DefaultTextModel, setting.ModelChannel.TextModels, isTextModelName)
	setting.ModelChannel.DefaultImageModel = repairDefaultModel(setting.ModelChannel.DefaultImageModel, setting.ModelChannel.ImageModels, isImageModelName)
	setting.ModelChannel.DefaultVideoModel = repairDefaultModel(setting.ModelChannel.DefaultVideoModel, setting.ModelChannel.VideoModels, isVideoModelName)
	setting.ModelChannel.DefaultAudioModel = repairDefaultModel(setting.ModelChannel.DefaultAudioModel, setting.ModelChannel.AudioModels, isAudioModelName)
	setting.ModelChannel.DefaultModel = repairDefaultModel(setting.ModelChannel.DefaultModel, setting.ModelChannel.TextModels, isTextModelName)
	return setting
}

func normalizeImageRequestFormats(items []model.ImageRequestFormatSetting, imageModels []string) []model.ImageRequestFormatSetting {
	allowedModels := map[string]bool{}
	for _, modelName := range imageModels {
		allowedModels[modelName] = true
	}
	result := make([]model.ImageRequestFormatSetting, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item.Model = strings.TrimSpace(item.Model)
		item.Format = strings.TrimSpace(item.Format)
		if seen[item.Model] || !allowedModels[item.Model] || (item.Format != "application/json" && item.Format != "multipart/form-data") {
			continue
		}
		seen[item.Model] = true
		result = append(result, item)
	}
	return result
}

func publicModelAllowed(public model.PublicSetting, taskType model.TaskType, modelName string) bool {
	models := public.ModelChannel.TextModels
	switch taskType {
	case model.TaskTypeImage:
		models = public.ModelChannel.ImageModels
	case model.TaskTypeVideo:
		models = public.ModelChannel.VideoModels
	case model.TaskTypeAudio:
		models = public.ModelChannel.AudioModels
	}
	modelName = strings.TrimSpace(modelName)
	for _, allowed := range models {
		if strings.TrimSpace(allowed) == modelName {
			return true
		}
	}
	return false
}

func ResolveModelDisplayName(public model.PublicSetting, modelNames ...string) string {
	for _, modelName := range modelNames {
		modelName = strings.TrimSpace(modelName)
		for _, item := range public.ModelChannel.ModelCosts {
			if strings.TrimSpace(item.Model) == modelName && strings.TrimSpace(item.DisplayName) != "" {
				return strings.TrimSpace(item.DisplayName)
			}
		}
	}
	for i := len(modelNames) - 1; i >= 0; i-- {
		if modelName := strings.TrimSpace(modelNames[i]); modelName != "" {
			return modelName
		}
	}
	return ""
}

func DisplayModelName(modelNames ...string) string {
	public, err := PublicSettings()
	if err != nil {
		public = model.PublicSetting{}
	}
	return ResolveModelDisplayName(public, modelNames...)
}

func ModelCost(modelName string) (model.Decimal, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.DecimalZero, err
	}
	settings = normalizeSettings(settings)
	modelName = strings.TrimSpace(modelName)
	for _, item := range settings.Public.ModelChannel.ModelCosts {
		if item.Model == modelName {
			return item.Credits, nil
		}
	}
	var legacyCost *model.Decimal
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.UpstreamModel != modelName || binding.LegacyCredits == nil {
			continue
		}
		credits := *binding.LegacyCredits
		if credits.IsNegative() {
			credits = model.DecimalZero
		}
		if legacyCost != nil && !legacyCost.Equal(credits) {
			return model.DecimalZero, fmt.Errorf("模型 %s 存在冲突的历史扣费，请在公开配置中设置统一算力点", modelName)
		}
		legacyCost = &credits
	}
	if legacyCost != nil {
		return *legacyCost, nil
	}
	return model.DecimalZero, nil
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
		switch binding.BillingMode {
		case model.BillingModePerCredit, model.BillingModePerSecond, model.BillingModePerCall:
		default:
			binding.BillingMode = model.BillingModePerCall
		}
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
	legacy := map[string]*model.Decimal{}
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
