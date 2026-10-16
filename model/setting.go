package model

import "encoding/json"

type SettingKey string

const (
	SettingKeyPublic          SettingKey = "public"
	SettingKeyPrivate         SettingKey = "private"
	SettingKeyVolcAssetConfig SettingKey = "VolcAssetConfig"
	SettingKeyAdminKey        SettingKey = "AdminKey"
)

// ModelChannel 模型渠道配置。
type ModelChannel struct {
	// Protocol 渠道协议：openai（默认）或 gemini。决定后端 AI 代理构造上游 URL 与鉴权方式。
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	BaseURL  string   `json:"baseUrl"`
	APIKey   string   `json:"apiKey"`
	Models   []string `json:"models"`
	Weight   int      `json:"weight"`
	Enabled  bool     `json:"enabled"`
	Remark   string   `json:"remark"`
}

// SupportsCallback 判断渠道是否支持异步回调通知。
func (ch ModelChannel) SupportsCallback() bool {
	return ch.Protocol == "aidrama"
}

// ModelCost 模型算力点配置。
type ModelCost struct {
	Model             string             `json:"model"`
	DisplayName       string             `json:"displayName,omitempty"`
	Credits           Decimal            `json:"credits"`
	ResolutionCredits map[string]Decimal `json:"resolutionCredits,omitempty"`
}

type ImageRequestFormatSetting struct {
	Model             string   `json:"model"`
	Format            string   `json:"format"`
	CanvasRequestMode string   `json:"canvasRequestMode"`
	Resolutions       []string `json:"resolutions"`
}

// PublicModelChannelSetting 公开模型渠道配置。
type PublicModelChannelSetting struct {
	AvailableModels     []string                    `json:"availableModels"`
	ModelCosts          []ModelCost                 `json:"modelCosts"`
	ImageRequestFormats []ImageRequestFormatSetting `json:"imageRequestFormats"`
	DefaultModel        string                      `json:"defaultModel"`
	DefaultImageModel   string                      `json:"defaultImageModel"`
	DefaultVideoModel   string                      `json:"defaultVideoModel"`
	DefaultTextModel    string                      `json:"defaultTextModel"`
	DefaultAudioModel   string                      `json:"defaultAudioModel"`
	ImageModels         []string                    `json:"imageModels"`
	VideoModels         []string                    `json:"videoModels"`
	TextModels          []string                    `json:"textModels"`
	TextModelProtocols  map[string]string           `json:"textModelProtocols"`
	AudioModels         []string                    `json:"audioModels"`
	SystemPrompt        string                      `json:"systemPrompt"`
	AllowCustomChannel  *bool                       `json:"allowCustomChannel"`
}

// PublicSetting 公开配置。
type PublicSetting struct {
	ModelChannel PublicModelChannelSetting `json:"modelChannel"`
	Auth         PublicAuthSetting         `json:"auth"`
	Navigation   PublicNavigationSetting   `json:"navigation"`
}

type PublicNavigationSetting struct {
	Enabled          *bool                             `json:"enabled"`
	Canvas           *bool                             `json:"canvas"`
	CanvasLocalAgent bool                              `json:"canvasLocalAgent"`
	Storyboard       *bool                             `json:"storyboard"`
	Image            *bool                             `json:"image"`
	Video            *bool                             `json:"video"`
	Assets           *bool                             `json:"assets"`
	VolcengineAssets *bool                             `json:"volcengineAssets"`
	Prompts          *bool                             `json:"prompts"`
	StoryboardItems  PublicStoryboardNavigationSetting `json:"storyboardItems"`
}

type PublicStoryboardNavigationSetting struct {
	BrainstormAgent *bool `json:"brainstormAgent"`
	Storyboard      *bool `json:"storyboard"`
	ScriptAgent     *bool `json:"scriptAgent"`
}

type PublicAuthSetting struct {
	AllowRegister *bool                    `json:"allowRegister"`
	LinuxDo       PublicLinuxDoAuthSetting `json:"linuxDo"`
}

type PublicLinuxDoAuthSetting struct {
	Enabled bool `json:"enabled"`
}

type GenerationLimitOverrides struct {
	DurationSecondsMax *int     `json:"durationSecondsMax,omitempty"`
	ResolutionValues   []string `json:"resolutionValues,omitempty"`
}

type GenerationBillingMode string

const (
	BillingModePerCredit GenerationBillingMode = "per_credit"
	BillingModePerSecond GenerationBillingMode = "per_second"
	BillingModePerCall   GenerationBillingMode = "per_call"
)

type GenerationProfileBinding struct {
	ID             string                `json:"id"`
	ProfileID      string                `json:"profileId"`
	UpstreamModel  string                `json:"upstreamModel"`
	UpstreamModels []string              `json:"upstreamModels,omitempty"`
	ChannelName    string                `json:"channelName"`
	BillingMode    GenerationBillingMode `json:"billingMode"`
	// LegacyCredits is retained for rollback compatibility; current billing uses public modelCosts.
	LegacyCredits  *Decimal                 `json:"credits,omitempty"`
	Enabled        bool                     `json:"enabled"`
	LimitOverrides GenerationLimitOverrides `json:"limitOverrides"`
	Metadata       map[string]any           `json:"metadata,omitempty"`
}

// PrivateSetting 私有配置。
type PrivateSetting struct {
	Channels           []ModelChannel             `json:"channels"`
	GenerationProfiles []GenerationProfileBinding `json:"generationProfiles"`
	PromptSync         PromptSyncSetting          `json:"promptSync"`
	Auth               PrivateAuthSetting         `json:"auth"`
	FileSizeLimits     FileSizeLimits             `json:"fileSizeLimits"`
}

// FileSizeLimits 各文件类型上传大小上限（字节）。
type FileSizeLimits struct {
	Image  int64 `json:"image"`
	Video  int64 `json:"video"`
	Audio  int64 `json:"audio"`
	Prompt int64 `json:"prompt"`
}

// PromptSyncSetting 提示词定时同步配置。
type PromptSyncSetting struct {
	Enabled *bool  `json:"enabled"`
	Cron    string `json:"cron"`
}

type PrivateAuthSetting struct {
	LinuxDo PrivateLinuxDoAuthSetting `json:"linuxDo"`
}

type PrivateLinuxDoAuthSetting struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// Setting 系统配置。
type Setting struct {
	Key       SettingKey      `json:"key" gorm:"primaryKey"`
	Value     json.RawMessage `json:"value" gorm:"serializer:json"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

// Settings 系统公开和私有配置。
type Settings struct {
	Public  PublicSetting  `json:"public"`
	Private PrivateSetting `json:"private"`
}
