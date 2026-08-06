package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

var (
	generationProfiles = func() []model.GenerationProfile {
		profiles, err := AvailableGenerationProfiles()
		if err != nil {
			return nil
		}
		return profiles
	}
	generationChannel              = SelectModelChannel
	generationRouteChannel         = SelectModelChannelByName
	generationCost                 = ModelCost
	generationHTTPClient           = http.DefaultClient
	generationPresign              = S3PresignGet
	generationPersistVideo         = persistGenerationVideo
	generationPollInterval         = 5 * time.Second
	generationCallbackPollInterval = 30 * time.Second
	generationPollIntervalMax      = 30 * time.Second
	generationTaskTimeout          = 30 * time.Minute
	generationDispatch             = func(ctx context.Context, taskID string) {
		go processGenerationTask(ctx, taskID, repository.NewWorkerID())
	}
)

var (
	ErrInvalidGenerationCommand  = errors.New("生成命令无效")
	ErrGenerationCommandConflict = errors.New("请求 ID 已用于不同的生成命令")
	ErrGenerationMediaForbidden  = errors.New("媒体文件不存在或无权使用")
)

func CreateGeneration(ctx context.Context, user model.AuthUser, command model.GenerationCommand) (model.FirstPartyGenerationTask, error) {
	profile, ok := findGenerationProfile(generationProfiles(), command.ModelProfileID)
	if !ok {
		return model.FirstPartyGenerationTask{}, NewGenerationValidationError("MODEL_DISABLED", "modelProfileId", "生成模型不可用", false, "")
	}
	if err := validateGenerationProfile(profile); err != nil {
		return model.FirstPartyGenerationTask{}, NewGenerationValidationError("MODEL_CONFIGURATION_INVALID", "modelProfileId", "生成模型配置不可用", false, "")
	}
	if command.CommandVersion != 1 {
		return model.FirstPartyGenerationTask{}, invalidCommand("commandVersion", "生成命令版本无效", "")
	}
	if strings.TrimSpace(command.ClientRequestID) == "" {
		return model.FirstPartyGenerationTask{}, invalidCommand("clientRequestId", "请求 ID 不能为空", "")
	}
	if !validGenerationSource(command.Source) {
		return model.FirstPartyGenerationTask{}, invalidCommand("source", "生成来源无效", "")
	}
	if !profileSupportsIntent(profile, command.Intent.Kind) {
		return model.FirstPartyGenerationTask{}, invalidCommand("intent.kind", "当前模型不支持该生成类型", "")
	}
	if err := validateGenerationIntent(profile, &command.Intent); err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	settings, err := normalizeGenerationSettings(profile, command.Intent.Settings)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	command.Intent.Settings = settings
	if err := validateGenerationReferences(user.ID, command.Intent.References); err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	if command.Intent.Kind == model.IntentVideoShortDrama {
		if err := validateShortDramaReferences(user.ID, profile, command.Intent.Assets); err != nil {
			return model.FirstPartyGenerationTask{}, err
		}
	}
	body, err := json.Marshal(command)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	summaryBody, err := json.Marshal(generationCommandSummary(command))
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	hash := sha256.Sum256(body)
	commandHash := hex.EncodeToString(hash[:])
	if existing, found, err := repository.GetGenerationTaskByClientRequestID(user.ID, command.ClientRequestID); err != nil {
		return model.FirstPartyGenerationTask{}, err
	} else if found {
		if existing.CommandHash != commandHash {
			return model.FirstPartyGenerationTask{}, ErrGenerationCommandConflict
		}
		return firstPartyTask(existing), nil
	}
	var channel model.ModelChannel
	if profile.ChannelName != "" {
		channel, err = generationRouteChannel(profile.ChannelName, profile.UpstreamModel)
	} else {
		channel, err = generationChannel(profile.UpstreamModel)
	}
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	billing, err := generationBillingPlanFor(profile, command.Intent)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	credits := billing.Credits
	now := time.Now().UTC().Format(time.RFC3339)
	taskID := "gentask-" + uuid.NewString()
	callbackToken := ""
	if profileCompletion(profile, "callback") {
		callbackToken = "callback-" + uuid.NewString()
	}
	task := model.GenerationTask{
		ID:               taskID,
		UserID:           user.ID,
		TaskType:         model.TaskTypeVideo,
		Source:           command.Source,
		Provider:         DetermineProvider(channel),
		Model:            profile.UpstreamModel,
		Status:           model.TaskStatusQueued,
		CallbackToken:    callbackToken,
		Credits:          credits,
		BillingMode:      billing.Mode,
		BillingRate:      billing.Rate,
		Metadata:         string(summaryBody),
		ClientRequestID:  command.ClientRequestID,
		CommandHash:      commandHash,
		CommandVersion:   command.CommandVersion,
		IntentKind:       string(command.Intent.Kind),
		ModelProfileID:   profile.ID,
		ProfileVersion:   profile.Version,
		AdapterKey:       profile.AdapterKey,
		ChannelID:        channel.Name,
		UpstreamModel:    profile.UpstreamModel,
		QueueAvailableAt: now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	payload := model.GenerationPayload{ID: "genpayload-" + uuid.NewString(), CommandBody: string(body), CreatedAt: now}
	if err := repository.CreateGenerationTaskWithCharge(&task, payload, user.ID, profile.UpstreamModel, "/api/v1/generations", credits, DisplayModelName(profile.ID, profile.UpstreamModel)); err != nil {
		if existing, found, lookupErr := repository.GetGenerationTaskByClientRequestID(user.ID, command.ClientRequestID); lookupErr == nil && found {
			if existing.CommandHash == commandHash {
				return firstPartyTask(existing), nil
			}
			return model.FirstPartyGenerationTask{}, ErrGenerationCommandConflict
		}
		return model.FirstPartyGenerationTask{}, err
	}
	result := firstPartyTask(task)
	generationDispatch(context.WithoutCancel(ctx), task.ID)
	return result, nil
}

func validGenerationSource(source string) bool {
	switch model.Source(source) {
	case model.SourceCanvas, model.SourceImageWorkbench, model.SourceVideoWorkbench:
		return true
	default:
		return false
	}
}

func generationCommandSummary(command model.GenerationCommand) model.GenerationCommandSummary {
	fileIDs := make([]string, 0, len(command.Intent.References.Images)+len(command.Intent.References.Videos)+len(command.Intent.References.Audios)+len(command.Intent.Assets))
	for _, references := range [][]model.MediaReference{command.Intent.References.Images, command.Intent.References.Videos, command.Intent.References.Audios} {
		for _, reference := range references {
			fileIDs = append(fileIDs, reference.FileID)
		}
	}
	for _, asset := range command.Intent.Assets {
		fileIDs = append(fileIDs, asset.Reference.FileID)
	}
	return model.GenerationCommandSummary{
		CommandVersion: command.CommandVersion, ClientRequestID: command.ClientRequestID, ModelProfileID: command.ModelProfileID,
		Source: command.Source, IntentKind: command.Intent.Kind, FileIDs: fileIDs,
	}
}

func validateGenerationIntent(profile model.GenerationProfile, intent *model.GenerationIntent) error {
	if intent.Kind == model.IntentVideoGenerate {
		if strings.TrimSpace(intent.Prompt) == "" {
			return invalidCommand("intent.prompt", "请输入视频提示词", "")
		}
		intent.NegativePrompt = strings.TrimSpace(intent.NegativePrompt)
		if utf8.RuneCountInString(intent.NegativePrompt) > 500 {
			return invalidCommand("intent.negativePrompt", "负向提示词不能超过 500 个字符", "")
		}
		return nil
	}
	if intent.Kind != model.IntentVideoShortDrama || profile.Capabilities.Title == nil || profile.Capabilities.Script == nil || profile.Capabilities.Assets == nil {
		return ErrInvalidGenerationCommand
	}
	title := strings.TrimSpace(intent.Title)
	if title == "" {
		return invalidCommand("intent.title", "请输入短剧标题", "")
	}
	if utf8.RuneCountInString(title) > profile.Capabilities.Title.MaxLength {
		return invalidCommand("intent.title", "短剧标题不能超过 20 个字符", "")
	}
	script := strings.TrimSpace(intent.Script)
	scriptLength := utf8.RuneCountInString(script)
	if scriptLength < profile.Capabilities.Script.MinLength {
		return invalidCommand("intent.script", "短剧脚本不能少于 20 个字符", "")
	}
	maxScriptLength := profile.Capabilities.Script.MaxLength
	if containsCJK(script) && profile.Capabilities.Script.CJKMaxLength > 0 {
		maxScriptLength = profile.Capabilities.Script.CJKMaxLength
	}
	if scriptLength > maxScriptLength {
		return invalidCommand("intent.script", fmt.Sprintf("短剧脚本不能超过 %d 个字符", maxScriptLength), "")
	}
	if len(intent.Assets) < profile.Capabilities.Assets.Min {
		return invalidCommand("intent.assets", "请连接并分类至少一张资产图片", "")
	}
	if len(intent.Assets) > profile.Capabilities.Assets.Max {
		return invalidCommand("intent.assets", "短剧资产不能超过 14 个", "")
	}
	seen := map[string]bool{}
	for index, asset := range intent.Assets {
		field := fmt.Sprintf("intent.assets.%d", index)
		resourceID := strings.TrimSpace(asset.SourceNodeID)
		if resourceID == "" || seen[resourceID] {
			return invalidCommand(field+".sourceNodeId", "资产来源节点无效", resourceID)
		}
		seen[resourceID] = true
		if !shortDramaRoleAllowed(profile.Capabilities.Assets.Roles, asset.Role) {
			return invalidCommand(field+".role", "请选择资产角色", resourceID)
		}
		name := strings.TrimSpace(asset.Name)
		if name == "" {
			return invalidCommand(field+".name", "请输入资产名称", resourceID)
		}
		if utf8.RuneCountInString(name) > profile.Capabilities.Assets.NameMaxLength {
			return invalidCommand(field+".name", "资产名称不能超过 30 个字符", resourceID)
		}
		if strings.TrimSpace(asset.Reference.FileID) == "" || asset.Reference.SourceNodeID != resourceID {
			return invalidCommand(field+".reference.fileId", "平台文件引用无效", resourceID)
		}
	}
	return nil
}

func containsCJK(value string) bool {
	for _, current := range value {
		if unicode.In(current, unicode.Han) {
			return true
		}
	}
	return false
}

func shortDramaRoleAllowed(roles []model.ShortDramaAssetRole, role model.ShortDramaAssetRole) bool {
	for _, allowed := range roles {
		if role == allowed {
			return true
		}
	}
	return false
}

func validateShortDramaReferences(userID string, profile model.GenerationProfile, assets []model.ShortDramaAsset) error {
	for index, asset := range assets {
		fieldPath := fmt.Sprintf("intent.assets.%d.reference.fileId", index)
		item, ok, err := repository.GetUserFileByID(strings.TrimSpace(asset.Reference.FileID), userID)
		if err != nil {
			return err
		}
		if !ok {
			return NewGenerationValidationError("MEDIA_NOT_FOUND", fieldPath, "资产图片不存在或无权使用", false, asset.SourceNodeID)
		}
		if !generationFileMatchesMediaType(item.FileType, "images") {
			return NewGenerationValidationError("MEDIA_UNSUPPORTED", fieldPath, "短剧资产必须是图片", false, asset.SourceNodeID)
		}
		allowed := false
		for _, mimeType := range profile.Capabilities.Assets.MimeTypes {
			if item.MimeType == mimeType {
				allowed = true
				break
			}
		}
		if !allowed {
			return NewGenerationValidationError("MEDIA_UNSUPPORTED", fieldPath, "图片格式仅支持 PNG、JPEG 或 WebP", false, asset.SourceNodeID)
		}
	}
	return nil
}

func generationFileMatchesMediaType(fileType, expected string) bool {
	return fileType == expected || fileType == "results/"+expected
}

func validateGenerationReferences(userID string, references model.GenerationReferences) error {
	for fileType, items := range map[string][]model.MediaReference{
		"images": references.Images,
		"videos": references.Videos,
		"audios": references.Audios,
	} {
		for _, reference := range items {
			item, ok, err := repository.GetUserFileByID(strings.TrimSpace(reference.FileID), userID)
			if err != nil {
				return err
			}
			if !ok || !generationFileMatchesMediaType(item.FileType, fileType) {
				return ErrGenerationMediaForbidden
			}
		}
	}
	return nil
}

func GetGeneration(userID, taskID string) (model.FirstPartyGenerationTask, error) {
	task, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return model.FirstPartyGenerationTask{}, err
	}
	return firstPartyTask(task), nil
}

func GetGenerationByClientRequestID(userID, clientRequestID string) (*model.FirstPartyGenerationTask, error) {
	task, found, err := repository.GetGenerationTaskByClientRequestID(userID, clientRequestID)
	if err != nil || !found {
		return nil, err
	}
	result := firstPartyTask(task)
	return &result, nil
}

func findGenerationProfile(profiles []model.GenerationProfile, id string) (model.GenerationProfile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return model.GenerationProfile{}, false
}

func generationProfileForTask(task model.GenerationTask) (model.GenerationProfile, bool) {
	upstreamModel := task.UpstreamModel
	if upstreamModel == "" {
		upstreamModel = task.Model
	}
	if task.AdapterKey != "" {
		for _, profile := range GenerationProfiles() {
			if profile.AdapterKey == task.AdapterKey {
				profile.ID = task.ModelProfileID
				profile.UpstreamModel = upstreamModel
				return profile, true
			}
		}
	}
	if profile, ok := findGenerationProfile(generationProfiles(), task.ModelProfileID); ok {
		profile.UpstreamModel = upstreamModel
		return profile, true
	}
	if profile, ok := findGenerationProfile(GenerationProfiles(), task.ModelProfileID); ok {
		profile.UpstreamModel = upstreamModel
		return profile, true
	}
	return model.GenerationProfile{}, false
}

func firstPartyTask(task model.GenerationTask) model.FirstPartyGenerationTask {
	result := (*model.FirstPartyGenerationResult)(nil)
	if task.ResultJSON != "" {
		var value model.FirstPartyGenerationResult
		if json.Unmarshal([]byte(task.ResultJSON), &value) == nil {
			result = &value
		}
	}
	public := model.FirstPartyGenerationTask{
		ID:             task.ID,
		Status:         publicTaskStatus(task.Status),
		ModelProfileID: task.ModelProfileID,
		IntentKind:     model.GenerationIntentKind(task.IntentKind),
		Result:         result,
		CreatedAt:      task.CreatedAt,
	}
	if task.ErrorCode != "" {
		public.Error = &model.GenerationError{Code: task.ErrorCode, Message: task.ErrorMessage, Retryable: task.ErrorRetryable}
	}
	return public
}

func publicTaskStatus(status model.TaskStatus) model.TaskStatus {
	if status == model.TaskStatusSuccess {
		return model.TaskStatusSucceeded
	}
	if status == model.TaskStatusPending {
		return model.TaskStatusRunning
	}
	return status
}

func executeGeneration(ctx context.Context, task model.GenerationTask, profile model.GenerationProfile, channel model.ModelChannel) {
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err == nil && isTerminalGenerationStatus(stored.Status) {
		return
	}
	intent, references, err := generationIntentFromTask(ctx, task)
	if err != nil {
		failGenerationTask(task, profile, "MEDIA_REFERENCE_UNAVAILABLE", err)
		return
	}
	adapter, ok := generationAdapterFor(task.AdapterKey)
	if !ok {
		failGenerationTask(task, profile, "MODEL_CONFIGURATION_INVALID", fmt.Errorf("unsupported adapter %q", task.AdapterKey))
		return
	}
	var ref ProviderTaskRef
	if task.UpstreamTaskID != "" {
		ref, err = adapter.Poll(ctx, channel, task.UpstreamTaskID)
	} else {
		callbackURL := ""
		if task.CallbackToken != "" && strings.TrimSpace(config.Cfg.PublicBaseURL) != "" {
			callbackURL = strings.TrimRight(config.Cfg.PublicBaseURL, "/") + "/api/v1/generations/callback?token=" + task.CallbackToken
		}
		ref, err = adapter.Create(ctx, AdapterCreateRequest{Profile: profile, Channel: channel, Intent: intent, References: references, CallbackURL: callbackURL})
	}
	persistGenerationAudit(task.ID, ref.Audit)
	if err != nil {
		failGenerationTaskWithError(task, profile, ref.Error, err)
		return
	}
	updates := map[string]any{"upstream_task_id": ref.ID, "status": string(model.TaskStatusRunning), "updated_at": time.Now().UTC().Format(time.RFC3339Nano)}
	changed, updateErr := repository.TransitionGenerationTask(task.ID, []model.TaskStatus{model.TaskStatusRunning}, updates)
	if updateErr != nil || !changed {
		return
	}
	_ = appendGenerationTaskEvent(task.ID, "submit", ref.ID)
	deadline := time.Now().Add(generationTaskTimeout)
	if createdAt, parseErr := time.Parse(time.RFC3339Nano, task.CreatedAt); parseErr == nil {
		deadline = createdAt.Add(generationTaskTimeout)
	} else if createdAt, parseErr = time.Parse(time.RFC3339, task.CreatedAt); parseErr == nil {
		deadline = createdAt.Add(generationTaskTimeout)
	}
	attempt := 0
	for !isTerminalGenerationStatus(ref.Status) {
		stored, loadErr := repository.GetGenerationTaskByID(task.ID)
		if loadErr == nil && isTerminalGenerationStatus(stored.Status) {
			return
		}
		if !time.Now().Before(deadline) {
			_ = timeoutGenerationTask(task, profile)
			return
		}
		interval := generationPollInterval
		if profileCompletion(profile, "callback") {
			interval = generationCallbackPollInterval
		}
		for i := 0; i < attempt && interval < generationPollIntervalMax; i++ {
			interval *= 2
			if interval > generationPollIntervalMax {
				interval = generationPollIntervalMax
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
		attempt++
		_ = appendGenerationTaskEvent(task.ID, "poll", fmt.Sprint(attempt))
		ref, err = adapter.Poll(ctx, channel, ref.ID)
		persistGenerationAudit(task.ID, ref.Audit)
		if err != nil {
			log.Printf("first-party generation poll failed: task=%s err=%v", task.ID, err)
			_ = appendGenerationTaskEvent(task.ID, "retry", sanitizeGenerationAuditJSON(strconv.Quote(err.Error())))
			continue
		}
		if !isTerminalGenerationStatus(ref.Status) {
			_ = updateGenerationProgress(task.ID, ref.Status, "poll")
		}
	}
	_ = resolveGenerationTask(ctx, task, profile, ref, "poll")
}

func generationIntentFromTask(ctx context.Context, task model.GenerationTask) (model.GenerationIntent, AdapterMediaReferences, error) {
	payload, err := repository.GetGenerationPayloadByTaskID(task.ID)
	if err != nil {
		return model.GenerationIntent{}, AdapterMediaReferences{}, err
	}
	if strings.TrimSpace(payload.CommandBody) == "" {
		payload.CommandBody = payload.RequestBody
	}
	var command model.GenerationCommand
	if err := json.Unmarshal([]byte(payload.CommandBody), &command); err != nil {
		return model.GenerationIntent{}, AdapterMediaReferences{}, err
	}
	references := AdapterMediaReferences{}
	imageReferences := command.Intent.References.Images
	if command.Intent.Kind == model.IntentVideoShortDrama {
		imageReferences = make([]model.MediaReference, 0, len(command.Intent.Assets))
		for _, asset := range command.Intent.Assets {
			imageReferences = append(imageReferences, asset.Reference)
		}
	}
	for _, group := range []struct {
		fileType string
		items    []model.MediaReference
		target   *[]string
	}{
		{"images", imageReferences, &references.Images},
		{"videos", command.Intent.References.Videos, &references.Videos},
		{"audios", command.Intent.References.Audios, &references.Audios},
	} {
		for _, reference := range group.items {
			item, ok, err := repository.GetUserFileByID(strings.TrimSpace(reference.FileID), task.UserID)
			if err != nil {
				return model.GenerationIntent{}, AdapterMediaReferences{}, err
			}
			if !ok || !generationFileMatchesMediaType(item.FileType, group.fileType) {
				return model.GenerationIntent{}, AdapterMediaReferences{}, ErrGenerationMediaForbidden
			}
			url, err := generationPresign(ctx, item.S3Key, presignExpiry)
			if err != nil {
				return model.GenerationIntent{}, AdapterMediaReferences{}, err
			}
			*group.target = append(*group.target, url)
		}
	}
	return command.Intent, references, nil
}

func failGenerationTask(task model.GenerationTask, profile model.GenerationProfile, code string, err error) {
	failGenerationTaskWithError(task, profile, &model.GenerationError{Code: code, Message: err.Error()}, err)
}

func failGenerationTaskWithError(task model.GenerationTask, profile model.GenerationProfile, normalized *model.GenerationError, err error) {
	if normalized == nil {
		normalized = &model.GenerationError{Code: "INTERNAL_ERROR", Message: "生成任务处理失败", Retryable: true}
	}
	_ = resolveGenerationTask(context.Background(), task, profile, ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusFailed, Error: normalized}, "worker")
	if err != nil {
		_ = repository.UpdateGenerationPayloadRawError(task.ID, sanitizeGenerationAuditJSON(strconv.Quote(err.Error())))
	}
}

func completeGenerationTask(ctx context.Context, task model.GenerationTask, profile model.GenerationProfile, ref ProviderTaskRef) {
	_ = resolveGenerationTask(ctx, task, profile, ref, "worker")
}

func persistGenerationVideo(ctx context.Context, userID, rawURL string) (*model.UserFile, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := generationHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("result download returned %d", response.StatusCode)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	mimeType := response.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "video/mp4"
	}
	return UploadUserFile(ctx, userID, "results/videos", "generated.mp4", mimeType, bytes.NewReader(data), int64(len(data)))
}

func persistGenerationAudit(taskID string, audit GenerationAudit) {
	if audit.ResponseBody != "" || audit.ResponseHeaders != "" {
		_ = repository.UpdateGenerationPayload(taskID, audit.ResponseBody, audit.ResponseHeaders)
	}
	if audit.RequestBody != "" {
		_ = repository.UpdateGenerationPayloadRequest(taskID, audit.RequestBody, audit.RequestHeaders)
	}
	if audit.RawError != "" {
		_ = repository.UpdateGenerationPayloadRawError(taskID, audit.RawError)
	}
}
