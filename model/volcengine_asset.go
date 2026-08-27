package model

import (
	"fmt"
	"strings"
)

const (
	VolcengineAssetFormatVolcengine       = "volcengine"
	VolcengineAssetFormatVolcengineCustom = "volcengine-custom"
	VolcengineAssetFormatNewAPI           = "newapi"
	VolcengineAssetDefaultOutboundID      = "default"
	VolcengineAssetDefaultSelectorHeader  = "X-Asset-Outbound"
	VolcengineAssetScopePersonal          = "personal"
	VolcengineAssetScopeEnterprise        = "enterprise"
)

type VolcengineAssetAuthSpec struct {
	Type  string `json:"type,omitempty"`
	Name  string `json:"name,omitempty"`
	Value string `json:"value,omitempty"`
}

type VolcengineAssetFieldMap struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type VolcengineAssetActionTemplate struct {
	Method             string                    `json:"method,omitempty"`
	URLTemplate        string                    `json:"url_template,omitempty"`
	Headers            map[string]string         `json:"headers,omitempty"`
	RequestStatic      map[string]string         `json:"request_static,omitempty"`
	RequestMapping     []VolcengineAssetFieldMap `json:"request_mapping,omitempty"`
	RequestPassthrough bool                      `json:"request_passthrough,omitempty"`
	ResultPath         string                    `json:"result_path,omitempty"`
	ErrorCodePath      string                    `json:"error_code_path,omitempty"`
	ErrorMessagePath   string                    `json:"error_message_path,omitempty"`
	ItemsPath          string                    `json:"items_path,omitempty"`
	ItemMapping        []VolcengineAssetFieldMap `json:"item_mapping,omitempty"`
	ResponseMapping    []VolcengineAssetFieldMap `json:"response_mapping,omitempty"`
}

type VolcengineAssetCustomFormat struct {
	ID   string                  `json:"id"`
	Name string                  `json:"name,omitempty"`
	Auth VolcengineAssetAuthSpec `json:"auth"`
	VolcengineAssetActionTemplate
	Actions map[string]VolcengineAssetActionTemplate `json:"actions,omitempty"`
}

type VolcengineAssetOutbound struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	Format      string `json:"format"`
	BaseURL     string `json:"base_url,omitempty"`
	SignHost    string `json:"sign_host,omitempty"`
	Region      string `json:"region,omitempty"`
	ProjectName string `json:"project_name,omitempty"`
	GroupType   string `json:"group_type,omitempty"`
	AccessKey   string `json:"access_key,omitempty"`
	SecretKey   string `json:"secret_key,omitempty"`
	AccessToken string `json:"access_token,omitempty"`
	Disabled    bool   `json:"disabled,omitempty"`
}

type VolcengineAssetConfig struct {
	Outbounds                []VolcengineAssetOutbound     `json:"outbounds"`
	DefaultOutbound          string                        `json:"default_outbound,omitempty"`
	OutboundSelectorHeader   string                        `json:"outbound_selector_header,omitempty"`
	Failover                 bool                          `json:"failover,omitempty"`
	CustomFormats            []VolcengineAssetCustomFormat `json:"custom_formats,omitempty"`
	ActionPrices             map[string]int                `json:"action_prices,omitempty"`
	RateLimitCount           int                           `json:"rate_limit_count,omitempty"`
	RateLimitDurationSeconds int                           `json:"rate_limit_duration_seconds,omitempty"`
}

type VolcengineAssetOutboundView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Format      string `json:"format"`
	ProjectName string `json:"project_name"`
	GroupType   string `json:"group_type"`
}

type VolcengineAssetGroupBinding struct {
	ID           string `json:"id" gorm:"primaryKey"`
	ScopeType    string `json:"scopeType" gorm:"not null;uniqueIndex:idx_volcengine_asset_group_scope_user_outbound,priority:1"`
	EnterpriseID string `json:"enterpriseId" gorm:"not null;default:'';uniqueIndex:idx_volcengine_asset_group_scope_user_outbound,priority:2"`
	UserID       string `json:"userId" gorm:"not null;uniqueIndex:idx_volcengine_asset_group_scope_user_outbound,priority:3"`
	OutboundID   string `json:"outboundId" gorm:"not null;uniqueIndex:idx_volcengine_asset_group_scope_user_outbound,priority:4"`
	Format       string `json:"format"`
	ProjectName  string `json:"projectName"`
	GroupID      string `json:"groupId"`
	GroupType    string `json:"groupType"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

func (o VolcengineAssetOutbound) EffectiveID() string {
	if id := strings.TrimSpace(o.ID); id != "" {
		return id
	}
	return VolcengineAssetDefaultOutboundID
}

func (o VolcengineAssetOutbound) EffectiveFormat() string {
	if format := strings.TrimSpace(o.Format); format != "" {
		return format
	}
	return VolcengineAssetFormatVolcengine
}

func (o VolcengineAssetOutbound) RegionOrDefault() string {
	if region := strings.TrimSpace(o.Region); region != "" {
		return region
	}
	return "cn-beijing"
}

func (o VolcengineAssetOutbound) GroupTypeOrDefault() string {
	if groupType := strings.TrimSpace(o.GroupType); groupType != "" {
		return groupType
	}
	return "AIGC"
}

func (o VolcengineAssetOutbound) ResolvedBaseURL() string {
	if o.EffectiveFormat() == VolcengineAssetFormatVolcengine {
		return fmt.Sprintf("https://ark.%s.volcengineapi.com", o.RegionOrDefault())
	}
	return strings.TrimSpace(o.BaseURL)
}

func IsBuiltinVolcengineAssetFormat(format string) bool {
	switch strings.TrimSpace(format) {
	case "", VolcengineAssetFormatVolcengine, VolcengineAssetFormatVolcengineCustom, VolcengineAssetFormatNewAPI:
		return true
	default:
		return false
	}
}

func (config VolcengineAssetConfig) EffectiveOutbounds() []VolcengineAssetOutbound {
	result := make([]VolcengineAssetOutbound, 0, len(config.Outbounds))
	for _, outbound := range config.Outbounds {
		if !outbound.Disabled {
			result = append(result, outbound)
		}
	}
	return result
}

func (config VolcengineAssetConfig) CustomFormat(id string) (VolcengineAssetCustomFormat, bool) {
	for _, format := range config.CustomFormats {
		if format.ID == id {
			return format, true
		}
	}
	return VolcengineAssetCustomFormat{}, false
}

func (config VolcengineAssetConfig) OutboundConfigured(outbound VolcengineAssetOutbound) bool {
	switch outbound.EffectiveFormat() {
	case VolcengineAssetFormatVolcengine:
		return strings.TrimSpace(outbound.AccessKey) != "" && strings.TrimSpace(outbound.SecretKey) != ""
	case VolcengineAssetFormatVolcengineCustom:
		return strings.TrimSpace(outbound.BaseURL) != "" && strings.TrimSpace(outbound.AccessKey) != "" && strings.TrimSpace(outbound.SecretKey) != ""
	case VolcengineAssetFormatNewAPI:
		return strings.TrimSpace(outbound.BaseURL) != "" && strings.TrimSpace(outbound.AccessToken) != ""
	default:
		_, ok := config.CustomFormat(outbound.EffectiveFormat())
		return strings.TrimSpace(outbound.BaseURL) != "" && ok
	}
}

func (config VolcengineAssetConfig) ResolveOutboundCandidates(selector string) []VolcengineAssetOutbound {
	outbounds := config.EffectiveOutbounds()
	if len(outbounds) == 0 {
		return nil
	}
	selector = strings.TrimSpace(selector)
	primary := -1
	for _, target := range []string{selector, strings.TrimSpace(config.DefaultOutbound)} {
		if target == "" || primary >= 0 {
			continue
		}
		for i, outbound := range outbounds {
			if outbound.EffectiveID() == target {
				primary = i
				break
			}
		}
	}
	if primary < 0 {
		primary = 0
	}
	ordered := []VolcengineAssetOutbound{outbounds[primary]}
	if config.Failover {
		for i, outbound := range outbounds {
			if i != primary {
				ordered = append(ordered, outbound)
			}
		}
	}
	result := make([]VolcengineAssetOutbound, 0, len(ordered))
	for _, outbound := range ordered {
		if config.OutboundConfigured(outbound) {
			result = append(result, outbound)
		}
	}
	return result
}

func (config VolcengineAssetConfig) SelectorHeader() string {
	if header := strings.TrimSpace(config.OutboundSelectorHeader); header != "" {
		return header
	}
	return VolcengineAssetDefaultSelectorHeader
}

func (config VolcengineAssetConfig) IsConfigured() bool {
	for _, outbound := range config.EffectiveOutbounds() {
		if config.OutboundConfigured(outbound) {
			return true
		}
	}
	return false
}

func (config VolcengineAssetConfig) ActionPrice(action string) int {
	if price := config.ActionPrices[action]; price > 0 {
		return price
	}
	return 0
}

// Redacted removes all egress details and custom templates before a config is sent to a browser.
func (config VolcengineAssetConfig) Redacted() VolcengineAssetConfig {
	result := config
	result.Outbounds = append([]VolcengineAssetOutbound(nil), config.Outbounds...)
	for i := range result.Outbounds {
		result.Outbounds[i].SecretKey = ""
		result.Outbounds[i].AccessToken = ""
	}
	return result
}

func (config VolcengineAssetConfig) MergeSecretsFrom(existing VolcengineAssetConfig) VolcengineAssetConfig {
	previous := make(map[string]VolcengineAssetOutbound, len(existing.Outbounds))
	for _, outbound := range existing.Outbounds {
		previous[outbound.EffectiveID()] = outbound
	}
	result := config
	result.Outbounds = append([]VolcengineAssetOutbound(nil), config.Outbounds...)
	for i := range result.Outbounds {
		if old, ok := previous[result.Outbounds[i].EffectiveID()]; ok {
			if result.Outbounds[i].SecretKey == "" {
				result.Outbounds[i].SecretKey = old.SecretKey
			}
			if result.Outbounds[i].AccessToken == "" {
				result.Outbounds[i].AccessToken = old.AccessToken
			}
		}
	}
	return result
}
