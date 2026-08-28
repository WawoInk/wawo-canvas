package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	volcengineAssetAPIVersion = "2024-01-01"
	volcengineAssetService    = "ark"
	volcengineAssetMaxBody    = 10 << 20
)

type volcengineAssetUpstreamError struct {
	code    string
	message string
	status  int
}

func (err volcengineAssetUpstreamError) Error() string {
	if err.code != "" {
		return "volcengine asset upstream error: " + err.code
	}
	return "volcengine asset upstream request failed"
}

func (err volcengineAssetUpstreamError) SafeMessage() string {
	return "上游素材库请求失败"
}

func (err volcengineAssetUpstreamError) FailureData() any {
	message := strings.TrimSpace(err.message)
	if len(message) > 512 {
		message = message[:512]
	}
	errorData := map[string]string{}
	if err.code != "" {
		errorData["code"] = err.code
	}
	if message != "" {
		errorData["message"] = message
	}
	if len(errorData) == 0 {
		return nil
	}
	return map[string]any{"error": errorData}
}

func volcengineAssetErrorFromResponse(body []byte, status int) error {
	code := strings.TrimSpace(gjson.GetBytes(body, "error.code").String())
	message := strings.TrimSpace(gjson.GetBytes(body, "error.message").String())
	if code == "" {
		code = strings.TrimSpace(gjson.GetBytes(body, "ResponseMetadata.Error.Code").String())
	}
	if message == "" {
		message = strings.TrimSpace(gjson.GetBytes(body, "ResponseMetadata.Error.Message").String())
	}
	if code == "" {
		code = strings.TrimSpace(gjson.GetBytes(body, "Code").String())
	}
	if message == "" {
		message = strings.TrimSpace(gjson.GetBytes(body, "Message").String())
	}
	if code == "" && message == "" {
		message = "上游素材库请求失败"
	}
	return volcengineAssetUpstreamError{code: code, message: message, status: status}
}

type volcengineAssetListFilter struct {
	GroupIDs  []string `json:"GroupIds,omitempty"`
	GroupType string   `json:"GroupType,omitempty"`
	Statuses  []string `json:"Statuses,omitempty"`
	Name      string   `json:"Name,omitempty"`
}

type volcengineAssetListRequest struct {
	Filter      *volcengineAssetListFilter `json:"Filter,omitempty"`
	PageNumber  int64                      `json:"PageNumber"`
	PageSize    int64                      `json:"PageSize"`
	SortBy      string                     `json:"SortBy,omitempty"`
	SortOrder   string                     `json:"SortOrder,omitempty"`
	ProjectName string                     `json:"ProjectName,omitempty"`
}

type volcengineAssetIDRequest struct {
	ID          string `json:"Id"`
	ProjectName string `json:"ProjectName,omitempty"`
}

type volcengineAssetCreateRequest struct {
	GroupID     string `json:"GroupId"`
	URL         string `json:"URL"`
	Name        string `json:"Name,omitempty"`
	AssetType   string `json:"AssetType"`
	ProjectName string `json:"ProjectName,omitempty"`
}

type volcengineAssetUpdateRequest struct {
	ID          string `json:"Id"`
	Name        string `json:"Name,omitempty"`
	ProjectName string `json:"ProjectName,omitempty"`
}

type volcengineAssetGroupFilter struct {
	Name      string   `json:"Name,omitempty"`
	GroupIDs  []string `json:"GroupIds,omitempty"`
	GroupType string   `json:"GroupType,omitempty"`
}

type volcengineAssetListGroupsRequest struct {
	Filter      *volcengineAssetGroupFilter `json:"Filter,omitempty"`
	PageNumber  int64                       `json:"PageNumber"`
	PageSize    int64                       `json:"PageSize"`
	SortBy      string                      `json:"SortBy,omitempty"`
	SortOrder   string                      `json:"SortOrder,omitempty"`
	ProjectName string                      `json:"ProjectName,omitempty"`
}

type volcengineAssetCreateGroupRequest struct {
	Name        string `json:"Name"`
	Description string `json:"Description,omitempty"`
	GroupType   string `json:"GroupType,omitempty"`
	ProjectName string `json:"ProjectName,omitempty"`
}

type volcengineAssetUpdateGroupRequest struct {
	ID          string `json:"Id"`
	Name        string `json:"Name,omitempty"`
	Description string `json:"Description,omitempty"`
	ProjectName string `json:"ProjectName,omitempty"`
}

type volcengineAssetScope struct {
	user         model.AuthUser
	scopeType    string
	enterpriseID string
	outbound     model.VolcengineAssetOutbound
	projectName  string
	groupID      string
	groupType    string
}

type volcengineAssetRateWindow struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

var assetRateWindow = volcengineAssetRateWindow{hits: map[string][]time.Time{}}

var (
	volcengineAssetProxy = http.ProxyFromEnvironment

	// ponytail: serialize rare first-use provisioning; shard per scope only if this becomes a measured bottleneck.
	volcengineAssetProvisionMu sync.Mutex
)

// AdminVolcengineAssetConfig returns the redacted independent config as JSON for the admin editor.
func AdminVolcengineAssetConfig() (string, error) {
	config, err := repository.GetVolcengineAssetConfig()
	if err != nil {
		return "", err
	}
	value, err := json.MarshalIndent(redactVolcengineAssetConfig(config), "", "  ")
	if err != nil {
		return "", err
	}
	return string(value), nil
}

// SaveVolcengineAssetConfig validates a config document and retains absent secrets from the stored version.
func SaveVolcengineAssetConfig(raw string) (string, error) {
	var document map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &document) != nil || document == nil {
		return "", safeMessageError{message: "配置 JSON 无效"}
	}
	var next model.VolcengineAssetConfig
	if json.Unmarshal([]byte(raw), &next) != nil {
		return "", safeMessageError{message: "配置 JSON 无效"}
	}
	previous, err := repository.GetVolcengineAssetConfig()
	if err != nil {
		return "", err
	}
	next = mergeVolcengineAssetClientConfig(normalizeVolcengineAssetConfig(next), previous)
	if err := validateVolcengineAssetConfig(next); err != nil {
		return "", err
	}
	stored, err := repository.SaveVolcengineAssetConfig(next, now())
	if err != nil {
		return "", err
	}
	value, err := json.MarshalIndent(redactVolcengineAssetConfig(stored), "", "  ")
	if err != nil {
		return "", err
	}
	return string(value), nil
}

func redactVolcengineAssetConfig(config model.VolcengineAssetConfig) model.VolcengineAssetConfig {
	return config.Redacted()
}

func mergeVolcengineAssetClientConfig(next, previous model.VolcengineAssetConfig) model.VolcengineAssetConfig {
	return next.MergeSecretsFrom(previous)
}

func normalizeVolcengineAssetConfig(config model.VolcengineAssetConfig) model.VolcengineAssetConfig {
	config.DefaultOutbound = strings.TrimSpace(config.DefaultOutbound)
	config.OutboundSelectorHeader = strings.TrimSpace(config.OutboundSelectorHeader)
	for i := range config.Outbounds {
		outbound := &config.Outbounds[i]
		outbound.ID = strings.TrimSpace(outbound.ID)
		outbound.Name = strings.TrimSpace(outbound.Name)
		outbound.Format = strings.TrimSpace(outbound.Format)
		outbound.BaseURL = strings.TrimSpace(outbound.BaseURL)
		outbound.SignHost = strings.TrimSpace(outbound.SignHost)
		outbound.Region = strings.TrimSpace(outbound.Region)
		outbound.ProjectName = strings.TrimSpace(outbound.ProjectName)
		outbound.GroupType = strings.TrimSpace(outbound.GroupType)
		outbound.AccessKey = strings.TrimSpace(outbound.AccessKey)
		outbound.SecretKey = strings.TrimSpace(outbound.SecretKey)
		outbound.AccessToken = strings.TrimSpace(outbound.AccessToken)
	}
	for i := range config.CustomFormats {
		config.CustomFormats[i].ID = strings.TrimSpace(config.CustomFormats[i].ID)
		config.CustomFormats[i].Name = strings.TrimSpace(config.CustomFormats[i].Name)
		config.CustomFormats[i].Auth.Type = strings.TrimSpace(config.CustomFormats[i].Auth.Type)
		config.CustomFormats[i].Auth.Name = strings.TrimSpace(config.CustomFormats[i].Auth.Name)
	}
	return config
}

func validateVolcengineAssetConfig(config model.VolcengineAssetConfig) error {
	if config.RateLimitCount < 0 || config.RateLimitDurationSeconds < 0 {
		return safeMessageError{message: "限流配置不能为负数"}
	}
	if strings.ContainsAny(config.OutboundSelectorHeader, " \t\r\n") {
		return safeMessageError{message: "素材库 outbound 选择请求头无效"}
	}
	formats := map[string]bool{}
	for _, format := range config.CustomFormats {
		if format.ID == "" || model.IsBuiltinVolcengineAssetFormat(format.ID) || formats[format.ID] {
			return safeMessageError{message: "自定义素材库格式配置无效"}
		}
		if format.Auth.Type != "" && format.Auth.Type != "none" && format.Auth.Type != "header" && format.Auth.Type != "query" && format.Auth.Type != "bearer" {
			return safeMessageError{message: "自定义素材库鉴权配置无效"}
		}
		formats[format.ID] = true
	}
	outboundIDs := map[string]bool{}
	for _, outbound := range config.Outbounds {
		id := outbound.EffectiveID()
		if outboundIDs[id] {
			return safeMessageError{message: "素材库 outbound ID 不能重复"}
		}
		outboundIDs[id] = true
		format := outbound.EffectiveFormat()
		if !model.IsBuiltinVolcengineAssetFormat(format) && !formats[format] {
			return safeMessageError{message: "素材库引用了不存在的自定义格式"}
		}
		if outbound.BaseURL != "" && !validVolcengineAssetURL(outbound.BaseURL) {
			return safeMessageError{message: "素材库 base_url 无效"}
		}
		if outbound.SignHost != "" && strings.ContainsAny(outbound.SignHost, " \t\r\n/?#@") {
			return safeMessageError{message: "素材库 sign_host 无效"}
		}
	}
	if config.DefaultOutbound != "" && !outboundIDs[config.DefaultOutbound] {
		return safeMessageError{message: "默认素材库 outbound 不存在"}
	}
	return nil
}

func validVolcengineAssetURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

// VolcengineAssetOutbounds returns only metadata that is safe for a normal user.
func VolcengineAssetOutbounds() ([]model.VolcengineAssetOutboundView, error) {
	config, err := repository.GetVolcengineAssetConfig()
	if err != nil {
		return nil, err
	}
	result := make([]model.VolcengineAssetOutboundView, 0)
	for _, outbound := range config.EffectiveOutbounds() {
		if !config.OutboundConfigured(outbound) {
			continue
		}
		name := strings.TrimSpace(outbound.Name)
		if name == "" {
			name = outbound.EffectiveID()
		}
		result = append(result, model.VolcengineAssetOutboundView{ID: outbound.EffectiveID(), Name: name, Format: outbound.EffectiveFormat(), ProjectName: outbound.ProjectName, GroupType: outbound.GroupTypeOrDefault()})
	}
	return result, nil
}

func validateVolcengineAssetUserAction(action string) error {
	switch action {
	case "ListAssets", "GetAsset", "CreateAsset", "UpdateAsset", "DeleteAsset":
		return nil
	default:
		return safeMessageError{message: "不支持的素材操作"}
	}
}

// VolcengineAssetUserAction executes a scoped user action. The client cannot select group, project, tenant, or credentials.
func VolcengineAssetUserAction(ctx context.Context, user model.AuthUser, headers http.Header, query url.Values, action string, raw []byte) (json.RawMessage, error) {
	if err := validateVolcengineAssetUserAction(action); err != nil {
		return nil, err
	}
	config, err := repository.GetVolcengineAssetConfig()
	if err != nil {
		return nil, err
	}
	candidates := resolveVolcengineAssetOutbounds(config, strings.TrimSpace(headers.Get(config.SelectorHeader())), strings.TrimSpace(query.Get("outbound")))
	if len(candidates) == 0 {
		return nil, safeMessageError{message: "没有可用的素材库配置"}
	}
	if err := checkVolcengineAssetRateLimit(config, user.ID); err != nil {
		return nil, err
	}
	var lastErr error
	for _, outbound := range candidates {
		scope, err := ensureVolcengineAssetScope(ctx, config, outbound, user)
		if err != nil {
			lastErr = err
			if config.Failover && isRetryableVolcengineAssetError(err) {
				continue
			}
			return nil, err
		}
		result, err := executeVolcengineAssetUserAction(ctx, user, config, scope, action, raw)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if config.Failover && isRetryableVolcengineAssetError(err) {
			continue
		}
		return nil, err
	}
	return nil, lastErr
}

func executeVolcengineAssetUserAction(ctx context.Context, user model.AuthUser, config model.VolcengineAssetConfig, scope *volcengineAssetScope, action string, raw []byte) (json.RawMessage, error) {
	var body []byte
	var verifyResult func(json.RawMessage) error
	switch action {
	case "ListAssets":
		var request volcengineAssetListRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil {
			return nil, err
		}
		if request.Filter == nil {
			request.Filter = &volcengineAssetListFilter{}
		}
		request.Filter.GroupIDs = []string{scope.groupID}
		request.Filter.GroupType = scope.groupType
		request.Filter.Statuses = nonEmptyStrings(request.Filter.Statuses)
		request.ProjectName = scope.projectName
		body, _ = json.Marshal(request)
	case "GetAsset":
		var request volcengineAssetIDRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil || strings.TrimSpace(request.ID) == "" {
			if err != nil {
				return nil, err
			}
			return nil, safeMessageError{message: "素材 ID 不能为空"}
		}
		request.ProjectName = scope.projectName
		body, _ = json.Marshal(request)
		verifyResult = func(result json.RawMessage) error {
			if !volcengineAssetBelongsToScope(result, scope) {
				return safeMessageError{message: "素材不存在或无权访问"}
			}
			return nil
		}
	case "CreateAsset":
		var request volcengineAssetCreateRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil {
			return nil, err
		}
		request.GroupID = scope.groupID
		request.ProjectName = scope.projectName
		request.URL = strings.TrimSpace(request.URL)
		request.AssetType = strings.TrimSpace(request.AssetType)
		if !validVolcengineAssetURL(request.URL) {
			return nil, safeMessageError{message: "URL 必须是有效的 http 或 https 地址"}
		}
		if request.AssetType != "Image" && request.AssetType != "Video" && request.AssetType != "Audio" {
			return nil, safeMessageError{message: "素材类型必须是 Image、Video 或 Audio"}
		}
		body, _ = json.Marshal(request)
	case "UpdateAsset":
		var request volcengineAssetUpdateRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil || strings.TrimSpace(request.ID) == "" {
			if err != nil {
				return nil, err
			}
			return nil, safeMessageError{message: "素材 ID 不能为空"}
		}
		if err := verifyVolcengineAssetOwnership(ctx, config, scope, request.ID); err != nil {
			return nil, err
		}
		request.ProjectName = scope.projectName
		body, _ = json.Marshal(request)
	case "DeleteAsset":
		var request volcengineAssetIDRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil || strings.TrimSpace(request.ID) == "" {
			if err != nil {
				return nil, err
			}
			return nil, safeMessageError{message: "素材 ID 不能为空"}
		}
		if err := verifyVolcengineAssetOwnership(ctx, config, scope, request.ID); err != nil {
			return nil, err
		}
		request.ProjectName = scope.projectName
		body, _ = json.Marshal(request)
	default:
		return nil, safeMessageError{message: "不支持的素材操作"}
	}
	return withVolcengineAssetActionCharge(user, config, action, func() (json.RawMessage, error) {
		result, err := callVolcengineAssetAPI(ctx, config, scope.outbound, action, body)
		if err != nil {
			return nil, err
		}
		if verifyResult != nil {
			if err := verifyResult(result); err != nil {
				return nil, err
			}
		}
		return result, nil
	})
}
func withVolcengineAssetActionCharge(user model.AuthUser, config model.VolcengineAssetConfig, action string, call func() (json.RawMessage, error)) (json.RawMessage, error) {
	cost := config.ActionPrice(action)
	if cost <= 0 {
		return call()
	}
	credits := model.NewDecimal(int64(cost))
	operationID := newID("volc_asset")
	path := "/api/v1/doubao/open/" + action
	if err := ConsumeUserCreditsOnce(user.ID, "volc-asset/"+action, credits, path, operationID); err != nil {
		return nil, err
	}
	result, err := call()
	if err == nil {
		return result, nil
	}
	if refundErr := RefundUserCreditsOnce(user.ID, "volc-asset/"+action, credits, path, operationID); refundErr != nil {
		return nil, refundErr
	}
	return nil, err
}

func VolcengineAssetAdminGroupAction(ctx context.Context, user model.AuthUser, headers http.Header, query url.Values, action string, raw []byte) (json.RawMessage, error) {
	switch action {
	case "CreateAssetGroup", "ListAssetGroups", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup":
	default:
		return nil, safeMessageError{message: "不支持的分组操作"}
	}
	config, err := repository.GetVolcengineAssetConfig()
	if err != nil {
		return nil, err
	}
	if err := checkVolcengineAssetRateLimit(config, user.ID); err != nil {
		return nil, err
	}
	candidates := resolveVolcengineAssetOutbounds(config, strings.TrimSpace(headers.Get(config.SelectorHeader())), strings.TrimSpace(query.Get("outbound")))
	if len(candidates) == 0 {
		return nil, safeMessageError{message: "没有可用的素材库配置"}
	}
	var lastErr error
	for _, outbound := range candidates {
		body, err := buildVolcengineAssetAdminGroupRequest(outbound, action, raw)
		if err != nil {
			return nil, err
		}
		result, err := withVolcengineAssetActionCharge(user, config, action, func() (json.RawMessage, error) {
			return callVolcengineAssetAPI(ctx, config, outbound, action, body)
		})
		if err == nil {
			return result, nil
		}
		lastErr = err
		if config.Failover && isRetryableVolcengineAssetError(err) {
			continue
		}
		return nil, err
	}
	return nil, lastErr
}

func buildVolcengineAssetAdminGroupRequest(outbound model.VolcengineAssetOutbound, action string, raw []byte) ([]byte, error) {
	var body []byte
	switch action {
	case "CreateAssetGroup":
		var request volcengineAssetCreateGroupRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil {
			return nil, err
		}
		if strings.TrimSpace(request.Name) == "" {
			return nil, safeMessageError{message: "分组名称不能为空"}
		}
		if request.GroupType == "" {
			request.GroupType = outbound.GroupTypeOrDefault()
		}
		if request.ProjectName == "" {
			request.ProjectName = outbound.ProjectName
		}
		body, _ = json.Marshal(request)
	case "ListAssetGroups":
		var request volcengineAssetListGroupsRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil {
			return nil, err
		}
		if request.Filter == nil {
			request.Filter = &volcengineAssetGroupFilter{}
		}
		request.Filter.GroupIDs = nonEmptyStrings(request.Filter.GroupIDs)
		if request.Filter.GroupType == "" {
			request.Filter.GroupType = outbound.GroupTypeOrDefault()
		}
		if request.ProjectName == "" {
			request.ProjectName = outbound.ProjectName
		}
		body, _ = json.Marshal(request)
	case "GetAssetGroup", "DeleteAssetGroup":
		var request volcengineAssetIDRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil || strings.TrimSpace(request.ID) == "" {
			if err != nil {
				return nil, err
			}
			return nil, safeMessageError{message: "分组 ID 不能为空"}
		}
		if request.ProjectName == "" {
			request.ProjectName = outbound.ProjectName
		}
		body, _ = json.Marshal(request)
	case "UpdateAssetGroup":
		var request volcengineAssetUpdateGroupRequest
		if err := decodeVolcengineAssetRequest(raw, &request); err != nil || strings.TrimSpace(request.ID) == "" {
			if err != nil {
				return nil, err
			}
			return nil, safeMessageError{message: "分组 ID 不能为空"}
		}
		if request.ProjectName == "" {
			request.ProjectName = outbound.ProjectName
		}
		body, _ = json.Marshal(request)
	default:
		return nil, safeMessageError{message: "不支持的分组操作"}
	}
	return body, nil
}
func decodeVolcengineAssetRequest(raw []byte, target any) error {
	if len(bytes.TrimSpace(raw)) == 0 || !json.Valid(raw) || json.Unmarshal(raw, target) != nil {
		return safeMessageError{message: "请求 JSON 无效"}
	}
	return nil
}

func resolveVolcengineAssetOutbounds(config model.VolcengineAssetConfig, headerSelector, querySelector string) []model.VolcengineAssetOutbound {
	selector := strings.TrimSpace(headerSelector)
	if selector == "" {
		selector = strings.TrimSpace(querySelector)
	}
	return config.ResolveOutboundCandidates(selector)
}

func resolveVolcengineAssetOutbound(config model.VolcengineAssetConfig, headerSelector, querySelector string) (model.VolcengineAssetOutbound, bool) {
	candidates := resolveVolcengineAssetOutbounds(config, headerSelector, querySelector)
	if len(candidates) == 0 {
		return model.VolcengineAssetOutbound{}, false
	}
	return candidates[0], true
}

func isRetryableVolcengineAssetError(err error) bool {
	var upstreamErr volcengineAssetUpstreamError
	if !errors.As(err, &upstreamErr) {
		return false
	}
	return upstreamErr.status == 0 || upstreamErr.status == http.StatusRequestTimeout || upstreamErr.status == http.StatusTooManyRequests || upstreamErr.status >= http.StatusInternalServerError
}
func checkVolcengineAssetRateLimit(config model.VolcengineAssetConfig, userID string) error {
	if config.RateLimitCount <= 0 || config.RateLimitDurationSeconds <= 0 || userID == "" {
		return nil
	}
	now := time.Now()
	cutoff := now.Add(-time.Duration(config.RateLimitDurationSeconds) * time.Second)
	assetRateWindow.mu.Lock()
	defer assetRateWindow.mu.Unlock()
	hits := assetRateWindow.hits[userID][:0]
	for _, hit := range assetRateWindow.hits[userID] {
		if hit.After(cutoff) {
			hits = append(hits, hit)
		}
	}
	if len(hits) >= config.RateLimitCount {
		assetRateWindow.hits[userID] = hits
		return safeMessageError{message: "素材库操作过于频繁，请稍后重试"}
	}
	assetRateWindow.hits[userID] = append(hits, now)
	return nil
}

func ensureVolcengineAssetScope(ctx context.Context, config model.VolcengineAssetConfig, outbound model.VolcengineAssetOutbound, user model.AuthUser) (*volcengineAssetScope, error) {
	scopeType, enterpriseID := model.VolcengineAssetScopePersonal, ""
	if user.EnterpriseID != "" {
		scopeType, enterpriseID = model.VolcengineAssetScopeEnterprise, user.EnterpriseID
	}
	needsProvision := func(binding model.VolcengineAssetGroupBinding, found bool) bool {
		return !found || binding.GroupID == "" || binding.ProjectName != outbound.ProjectName || binding.Format != outbound.EffectiveFormat()
	}
	binding, found, err := repository.GetVolcengineAssetGroupBinding(scopeType, enterpriseID, user.ID, outbound.EffectiveID())
	if err != nil {
		return nil, err
	}
	if needsProvision(binding, found) {
		volcengineAssetProvisionMu.Lock()
		defer volcengineAssetProvisionMu.Unlock()
		binding, found, err = repository.GetVolcengineAssetGroupBinding(scopeType, enterpriseID, user.ID, outbound.EffectiveID())
		if err != nil {
			return nil, err
		}
		if needsProvision(binding, found) {
			binding, err = provisionVolcengineAssetGroup(ctx, config, outbound, user, scopeType, enterpriseID)
			if err != nil {
				return nil, err
			}
		}
	}
	if needsProvision(binding, true) {
		return nil, safeMessageError{message: "素材库分组配置无效"}
	}
	groupType := binding.GroupType
	if groupType == "" {
		groupType = outbound.GroupTypeOrDefault()
	}
	return &volcengineAssetScope{user: user, scopeType: scopeType, enterpriseID: enterpriseID, outbound: outbound, projectName: outbound.ProjectName, groupID: binding.GroupID, groupType: groupType}, nil
}

func provisionVolcengineAssetGroup(ctx context.Context, config model.VolcengineAssetConfig, outbound model.VolcengineAssetOutbound, user model.AuthUser, scopeType, enterpriseID string) (model.VolcengineAssetGroupBinding, error) {
	name := stableVolcengineAssetGroupName(scopeType, enterpriseID, user.ID, outbound.EffectiveID())
	groupID, err := findVolcengineAssetGroupID(ctx, config, outbound, name)
	if err != nil {
		return model.VolcengineAssetGroupBinding{}, err
	}
	if groupID == "" {
		body, _ := json.Marshal(volcengineAssetCreateGroupRequest{Name: name, Description: "Infinite Canvas 自动管理的用户素材分组", GroupType: outbound.GroupTypeOrDefault(), ProjectName: outbound.ProjectName})
		result, createErr := callVolcengineAssetAPI(ctx, config, outbound, "CreateAssetGroup", body)
		if createErr == nil {
			groupID = assetGroupID(result)
		}
		if groupID == "" {
			groupID, err = findVolcengineAssetGroupID(ctx, config, outbound, name)
			if err != nil {
				if createErr != nil {
					return model.VolcengineAssetGroupBinding{}, createErr
				}
				return model.VolcengineAssetGroupBinding{}, err
			}
		}
	}
	if groupID == "" {
		return model.VolcengineAssetGroupBinding{}, safeMessageError{message: "无法初始化素材库分组"}
	}
	now := now()
	binding := model.VolcengineAssetGroupBinding{ID: newID("volc_asset_group"), ScopeType: scopeType, EnterpriseID: enterpriseID, UserID: user.ID, OutboundID: outbound.EffectiveID(), Format: outbound.EffectiveFormat(), ProjectName: outbound.ProjectName, GroupID: groupID, GroupType: outbound.GroupTypeOrDefault(), CreatedAt: now, UpdatedAt: now}
	return repository.SaveVolcengineAssetGroupBinding(binding)
}

func stableVolcengineAssetGroupName(scopeType, enterpriseID, userID, outboundID string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{scopeType, enterpriseID, userID, outboundID}, "|")))
	return "infinite-canvas-" + scopeType + "-" + hex.EncodeToString(sum[:8])
}

func findVolcengineAssetGroupID(ctx context.Context, config model.VolcengineAssetConfig, outbound model.VolcengineAssetOutbound, name string) (string, error) {
	body, _ := json.Marshal(volcengineAssetListGroupsRequest{Filter: &volcengineAssetGroupFilter{Name: name, GroupType: outbound.GroupTypeOrDefault()}, PageNumber: 1, PageSize: 50, ProjectName: outbound.ProjectName})
	result, err := callVolcengineAssetAPI(ctx, config, outbound, "ListAssetGroups", body)
	if err != nil {
		return "", err
	}
	items := gjson.GetBytes(result, "Items")
	var groupID string
	items.ForEach(func(_, item gjson.Result) bool {
		if item.Get("Name").String() == name {
			groupID = item.Get("Id").String()
			if groupID == "" {
				groupID = item.Get("GroupId").String()
			}
			return false
		}
		return true
	})
	return groupID, nil
}

func assetGroupID(result []byte) string {
	if id := gjson.GetBytes(result, "Id").String(); id != "" {
		return id
	}
	return gjson.GetBytes(result, "GroupId").String()
}

func verifyVolcengineAssetOwnership(ctx context.Context, config model.VolcengineAssetConfig, scope *volcengineAssetScope, id string) error {
	body, _ := json.Marshal(volcengineAssetIDRequest{ID: id, ProjectName: scope.projectName})
	result, err := callVolcengineAssetAPI(ctx, config, scope.outbound, "GetAsset", body)
	if err != nil {
		return err
	}
	if !volcengineAssetBelongsToScope(result, scope) {
		return safeMessageError{message: "素材不存在或无权访问"}
	}
	return nil
}

func volcengineAssetBelongsToScope(result []byte, scope *volcengineAssetScope) bool {
	return scope.groupID != "" &&
		gjson.GetBytes(result, "GroupId").String() == scope.groupID &&
		gjson.GetBytes(result, "ProjectName").String() == scope.projectName
}

func nonEmptyStrings(values []string) []string {
	result := values[:0]
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func callVolcengineAssetAPI(ctx context.Context, config model.VolcengineAssetConfig, outbound model.VolcengineAssetOutbound, action string, body []byte) (json.RawMessage, error) {
	switch outbound.EffectiveFormat() {
	case model.VolcengineAssetFormatVolcengine, model.VolcengineAssetFormatVolcengineCustom:
		return callVolcengineFormat(ctx, outbound, action, body)
	case model.VolcengineAssetFormatNewAPI:
		return callNewAPIAssetFormat(ctx, outbound, action, body)
	default:
		format, ok := config.CustomFormat(outbound.EffectiveFormat())
		if !ok {
			return nil, safeMessageError{message: "素材库配置无效"}
		}
		return callCustomAssetFormat(ctx, outbound, format, action, body)
	}
}

func callVolcengineFormat(ctx context.Context, outbound model.VolcengineAssetOutbound, action string, body []byte) (json.RawMessage, error) {
	if outbound.AccessKey == "" || outbound.SecretKey == "" {
		return nil, safeMessageError{message: "素材库配置无效"}
	}
	endpoint, err := url.Parse(outbound.ResolvedBaseURL())
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return nil, safeMessageError{message: "素材库配置无效"}
	}
	if endpoint.Path == "" {
		endpoint.Path = "/"
	}
	query := endpoint.Query()
	query.Set("Action", action)
	query.Set("Version", volcengineAssetAPIVersion)
	endpoint.RawQuery = query.Encode()
	signHost := outbound.SignHost
	if signHost == "" {
		signHost = endpoint.Host
	}
	if strings.ContainsAny(signHost, " \t\r\n/?#@") {
		return nil, safeMessageError{message: "素材库配置无效"}
	}
	response, status, err := sendVolcengineAssetHTTP(ctx, http.MethodPost, endpoint.String(), nil, body, func(request *http.Request) {
		signVolcengineAssetRequest(request, body, outbound.AccessKey, outbound.SecretKey, outbound.RegionOrDefault(), signHost)
	})
	if err != nil {
		return nil, volcengineAssetUpstreamError{}
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, volcengineAssetErrorFromResponse(response, status)
	}
	if code := strings.TrimSpace(gjson.GetBytes(response, "ResponseMetadata.Error.Code").String()); code != "" && code != "0" {
		return nil, volcengineAssetUpstreamError{code: code, message: gjson.GetBytes(response, "ResponseMetadata.Error.Message").String(), status: status}
	}
	if result := gjson.GetBytes(response, "Result"); result.Exists() {
		return json.RawMessage(result.Raw), nil
	}
	return json.RawMessage(response), nil
}

func callNewAPIAssetFormat(ctx context.Context, outbound model.VolcengineAssetOutbound, action string, body []byte) (json.RawMessage, error) {
	if outbound.BaseURL == "" || outbound.AccessToken == "" {
		return nil, safeMessageError{message: "素材库配置无效"}
	}
	response, status, err := sendVolcengineAssetHTTP(ctx, http.MethodPost, strings.TrimRight(outbound.BaseURL, "/")+"/"+action, map[string]string{"Authorization": "Bearer " + outbound.AccessToken, "X-Track-Id": uuid.NewString()}, body, nil)
	if err != nil {
		return nil, volcengineAssetUpstreamError{}
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, volcengineAssetErrorFromResponse(response, status)
	}
	if code := strings.TrimSpace(gjson.GetBytes(response, "code").String()); code != "" {
		data := gjson.GetBytes(response, "data")
		if code != "0" {
			errorCode := strings.TrimSpace(data.Get("error.code").String())
			if errorCode == "" {
				errorCode = code
			}
			errorMessage := strings.TrimSpace(data.Get("error.message").String())
			if errorMessage == "" {
				errorMessage = gjson.GetBytes(response, "msg").String()
			}
			return nil, volcengineAssetUpstreamError{code: errorCode, message: errorMessage, status: status}
		}
		if data.Exists() {
			return json.RawMessage(data.Raw), nil
		}
	}
	return json.RawMessage(response), nil
}

func callCustomAssetFormat(ctx context.Context, outbound model.VolcengineAssetOutbound, format model.VolcengineAssetCustomFormat, action string, canonical []byte) (json.RawMessage, error) {
	template := resolveVolcengineAssetActionTemplate(format, action)
	method, requestURL, headers, body, err := buildCustomVolcengineAssetRequest(outbound, format, template, action, canonical)
	if err != nil || !validVolcengineAssetURL(requestURL) {
		return nil, safeMessageError{message: "素材库配置无效"}
	}
	response, status, err := sendVolcengineAssetHTTP(ctx, method, requestURL, headers, body, nil)
	if err != nil {
		return nil, volcengineAssetUpstreamError{}
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return nil, volcengineAssetErrorFromResponse(response, status)
	}
	return parseCustomVolcengineAssetResponse(template, response)
}

func sendVolcengineAssetHTTP(ctx context.Context, method, endpoint string, headers map[string]string, body []byte, sign func(*http.Request)) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("Accept", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	if sign != nil {
		sign(request)
	}
	client, closeIdle, err := volcengineAssetHTTPClient(endpoint)
	if err != nil {
		return nil, 0, err
	}
	defer closeIdle()
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	value, err := io.ReadAll(io.LimitReader(response.Body, volcengineAssetMaxBody))
	if err != nil {
		return nil, 0, err
	}
	return value, response.StatusCode, nil
}

func volcengineAssetHTTPClient(endpoint string) (*http.Client, func(), error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Hostname() == "" {
		return nil, func() {}, errors.New("invalid endpoint")
	}
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil, func() {}, errors.New("invalid transport")
	}
	transport := base.Clone()
	transport.Proxy = volcengineAssetProxy
	return &http.Client{Timeout: 30 * time.Second, Transport: transport}, transport.CloseIdleConnections, nil
}

func signVolcengineAssetRequest(request *http.Request, body []byte, accessKey, secretKey, region, signHost string) {
	payloadHash := sha256.Sum256(body)
	hexPayloadHash := hex.EncodeToString(payloadHash[:])
	now := time.Now().UTC()
	xDate := now.Format("20060102T150405Z")
	shortDate := now.Format("20060102")
	request.Host = signHost
	request.Header.Set("X-Date", xDate)
	request.Header.Set("X-Content-Sha256", hexPayloadHash)

	query := request.URL.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(query))
	for _, key := range keys {
		values := append([]string(nil), query[key]...)
		sort.Strings(values)
		for _, value := range values {
			parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
	}
	headers := map[string]string{"host": signHost, "x-date": xDate, "x-content-sha256": hexPayloadHash}
	if contentType := request.Header.Get("Content-Type"); contentType != "" {
		headers["content-type"] = contentType
	}
	headerKeys := make([]string, 0, len(headers))
	for key := range headers {
		headerKeys = append(headerKeys, key)
	}
	sort.Strings(headerKeys)
	var canonicalHeaders strings.Builder
	for _, key := range headerKeys {
		canonicalHeaders.WriteString(key)
		canonicalHeaders.WriteString(":")
		canonicalHeaders.WriteString(strings.TrimSpace(headers[key]))
		canonicalHeaders.WriteString("\n")
	}
	signedHeaders := strings.Join(headerKeys, ";")
	canonicalRequest := strings.Join([]string{request.Method, request.URL.EscapedPath(), strings.Join(parts, "&"), canonicalHeaders.String(), signedHeaders, hexPayloadHash}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonicalRequest))
	credentialScope := shortDate + "/" + region + "/" + volcengineAssetService + "/request"
	stringToSign := "HMAC-SHA256\n" + xDate + "\n" + credentialScope + "\n" + hex.EncodeToString(canonicalHash[:])
	kDate := volcengineAssetHMAC([]byte(shortDate), []byte(secretKey))
	kRegion := volcengineAssetHMAC([]byte(region), kDate)
	kService := volcengineAssetHMAC([]byte(volcengineAssetService), kRegion)
	kSigning := volcengineAssetHMAC([]byte("request"), kService)
	signature := hex.EncodeToString(volcengineAssetHMAC([]byte(stringToSign), kSigning))
	request.Header.Set("Authorization", "HMAC-SHA256 Credential="+accessKey+"/"+credentialScope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func volcengineAssetHMAC(data, key []byte) []byte {
	signer := hmac.New(sha256.New, key)
	_, _ = signer.Write(data)
	return signer.Sum(nil)
}

func resolveVolcengineAssetActionTemplate(format model.VolcengineAssetCustomFormat, action string) model.VolcengineAssetActionTemplate {
	template := format.VolcengineAssetActionTemplate
	override, ok := format.Actions[action]
	if !ok {
		return template
	}
	if override.Method != "" {
		template.Method = override.Method
	}
	if override.URLTemplate != "" {
		template.URLTemplate = override.URLTemplate
	}
	if len(override.Headers) > 0 {
		template.Headers = override.Headers
	}
	if len(override.RequestStatic) > 0 {
		template.RequestStatic = override.RequestStatic
	}
	if len(override.RequestMapping) > 0 {
		template.RequestMapping = override.RequestMapping
	}
	if override.RequestPassthrough {
		template.RequestPassthrough = true
	}
	if override.ResultPath != "" {
		template.ResultPath = override.ResultPath
	}
	if override.ErrorCodePath != "" {
		template.ErrorCodePath = override.ErrorCodePath
	}
	if override.ErrorMessagePath != "" {
		template.ErrorMessagePath = override.ErrorMessagePath
	}
	if override.ItemsPath != "" {
		template.ItemsPath = override.ItemsPath
	}
	if len(override.ItemMapping) > 0 {
		template.ItemMapping = override.ItemMapping
	}
	if len(override.ResponseMapping) > 0 {
		template.ResponseMapping = override.ResponseMapping
	}
	return template
}

func buildCustomVolcengineAssetRequest(outbound model.VolcengineAssetOutbound, format model.VolcengineAssetCustomFormat, template model.VolcengineAssetActionTemplate, action string, canonical []byte) (string, string, map[string]string, []byte, error) {
	context := volcengineAssetTemplateContext(outbound, action)
	method := strings.ToUpper(strings.TrimSpace(template.Method))
	if method == "" {
		method = http.MethodPost
	}
	requestURL := template.URLTemplate
	if requestURL == "" {
		requestURL = "{base_url}?Action={action}"
	}
	requestURL = applyVolcengineAssetTemplate(requestURL, context, canonical)
	body := []byte("{}")
	if template.RequestPassthrough {
		body = canonical
	} else {
		for _, mapping := range template.RequestMapping {
			value := gjson.GetBytes(canonical, mapping.From)
			if !value.Exists() {
				continue
			}
			var err error
			body, err = sjson.SetRawBytes(body, mapping.To, []byte(value.Raw))
			if err != nil {
				return "", "", nil, nil, err
			}
		}
	}
	for path, value := range template.RequestStatic {
		var err error
		body, err = sjson.SetBytes(body, path, applyVolcengineAssetTemplate(value, context, canonical))
		if err != nil {
			return "", "", nil, nil, err
		}
	}
	headers := make(map[string]string, len(template.Headers)+1)
	for name, value := range template.Headers {
		headers[name] = applyVolcengineAssetTemplate(value, context, canonical)
	}
	applyVolcengineAssetAuth(format.Auth, &requestURL, headers, context, canonical)
	return method, requestURL, headers, body, nil
}

func parseCustomVolcengineAssetResponse(template model.VolcengineAssetActionTemplate, body []byte) (json.RawMessage, error) {
	if template.ErrorCodePath != "" {
		code := gjson.GetBytes(body, template.ErrorCodePath)
		if code.Exists() && code.String() != "" && code.String() != "0" {
			message := ""
			if template.ErrorMessagePath != "" {
				message = gjson.GetBytes(body, template.ErrorMessagePath).String()
			}
			return nil, volcengineAssetUpstreamError{code: code.String(), message: message, status: http.StatusOK}
		}
	}
	result := gjson.Result{Raw: string(body)}
	if template.ResultPath != "" {
		if value := gjson.GetBytes(body, template.ResultPath); value.Exists() {
			result = value
		}
	}
	resultRaw := []byte(result.Raw)
	if len(template.ResponseMapping) == 0 && len(template.ItemMapping) == 0 {
		return json.RawMessage(resultRaw), nil
	}
	canonical := []byte("{}")
	for _, mapping := range template.ResponseMapping {
		value := gjson.GetBytes(resultRaw, mapping.From)
		if !value.Exists() {
			continue
		}
		var err error
		canonical, err = sjson.SetRawBytes(canonical, mapping.To, []byte(value.Raw))
		if err != nil {
			return nil, safeMessageError{message: "素材库格式配置无效"}
		}
	}
	if len(template.ItemMapping) > 0 {
		items := gjson.ParseBytes(resultRaw)
		if template.ItemsPath != "" {
			items = gjson.GetBytes(resultRaw, template.ItemsPath)
		}
		index := 0
		var mappingErr error
		items.ForEach(func(_, item gjson.Result) bool {
			mapped := []byte("{}")
			for _, mapping := range template.ItemMapping {
				value := item.Get(mapping.From)
				if !value.Exists() {
					continue
				}
				mapped, mappingErr = sjson.SetRawBytes(mapped, mapping.To, []byte(value.Raw))
				if mappingErr != nil {
					return false
				}
			}
			canonical, mappingErr = sjson.SetRawBytes(canonical, fmt.Sprintf("Items.%d", index), mapped)
			if mappingErr != nil {
				return false
			}
			index++
			return true
		})
		if mappingErr != nil {
			return nil, safeMessageError{message: "素材库格式配置无效"}
		}
	}
	return json.RawMessage(canonical), nil
}

func volcengineAssetTemplateContext(outbound model.VolcengineAssetOutbound, action string) map[string]string {
	return map[string]string{
		"{base_url}":     strings.TrimRight(outbound.ResolvedBaseURL(), "/"),
		"{action}":       action,
		"{access_key}":   outbound.AccessKey,
		"{secret_key}":   outbound.SecretKey,
		"{access_token}": outbound.AccessToken,
		"{project_name}": outbound.ProjectName,
		"{region}":       outbound.RegionOrDefault(),
		"{group_type}":   outbound.GroupTypeOrDefault(),
		"{uuid}":         uuid.NewString(),
	}
}

func applyVolcengineAssetTemplate(value string, context map[string]string, canonical []byte) string {
	for key, replacement := range context {
		value = strings.ReplaceAll(value, key, replacement)
	}
	for {
		start := strings.Index(value, "{field:")
		if start < 0 {
			return value
		}
		end := strings.Index(value[start:], "}")
		if end < 0 {
			return value
		}
		end += start
		path := value[start+7 : end]
		value = value[:start] + gjson.GetBytes(canonical, path).String() + value[end+1:]
	}
}

func applyVolcengineAssetAuth(auth model.VolcengineAssetAuthSpec, requestURL *string, headers map[string]string, context map[string]string, canonical []byte) {
	value := applyVolcengineAssetTemplate(auth.Value, context, canonical)
	switch auth.Type {
	case "header":
		if auth.Name != "" {
			headers[auth.Name] = value
		}
	case "bearer":
		headers["Authorization"] = "Bearer " + value
	case "query":
		if auth.Name == "" {
			return
		}
		separator := "?"
		if strings.Contains(*requestURL, "?") {
			separator = "&"
		}
		*requestURL += separator + url.QueryEscape(auth.Name) + "=" + url.QueryEscape(value)
	}
}
