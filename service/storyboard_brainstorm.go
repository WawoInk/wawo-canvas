package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"gorm.io/gorm"
)

const (
	maxBrainstormIDLength         = 200
	maxBrainstormTitleLength      = 200
	maxBrainstormContentBytes     = 128 * 1024
	maxBrainstormOutputBytes      = 2 * 1024 * 1024
	maxStoryboardMemoryKindLength = 64
	maxStoryboardMemoryPathLength = 200
	maxStoryboardMemoryTags       = 32
	maxStoryboardMemoryTagLength  = 64
	maxStoryboardMemoryBytes      = 32 * 1024
)

type StoryboardBrainstormConversationInput struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type StoryboardBrainstormUserMessageInput struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type StoryboardBrainstormTurnInput struct {
	Mode               string                               `json:"mode"`
	ClientRequestID    string                               `json:"clientRequestId"`
	ParentMessageID    string                               `json:"parentMessageId"`
	TargetMessageID    string                               `json:"targetMessageId"`
	UserMessage        StoryboardBrainstormUserMessageInput `json:"userMessage"`
	AssistantMessageID string                               `json:"assistantMessageId"`
}

type StoryboardBrainstormAssistantInput struct {
	ExpectedRevision *uint64         `json:"expectedRevision"`
	Status           string          `json:"status"`
	Output           json.RawMessage `json:"output"`
}

type StoryboardBrainstormContinueInput struct {
	ClientRequestID  string  `json:"clientRequestId"`
	ExpectedRevision *uint64 `json:"expectedRevision"`
}

type StoryboardMemoryInput struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	Scope           string   `json:"scope"`
	Path            string   `json:"path"`
	Content         string   `json:"content"`
	Tags            []string `json:"tags"`
	SourceMessageID string   `json:"sourceMessageId"`
	OperationID     string   `json:"operationId"`
}

type StoryboardBrainstormDeleteResult struct {
	ID        string `json:"id"`
	DeletedAt string `json:"deletedAt"`
}

func ListStoryboardBrainstormConversations(projectID, userID string, query model.Query) (model.StoryboardBrainstormConversationPage, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormConversationPage{}, err
	}
	if err := ensureStoryboardProject(projectID, userID); err != nil {
		return model.StoryboardBrainstormConversationPage{}, err
	}
	query.Normalize()
	items, total, err := repository.ListStoryboardBrainstormConversations(projectID, userID, query)
	if err != nil {
		return model.StoryboardBrainstormConversationPage{}, err
	}
	if items == nil {
		items = []model.StoryboardBrainstormConversation{}
	}
	return model.StoryboardBrainstormConversationPage{Items: items, Total: total}, nil
}

func CreateStoryboardBrainstormConversation(projectID, userID string, input StoryboardBrainstormConversationInput) (model.StoryboardBrainstormConversation, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	id, err := validateBrainstormID(input.ID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	if err := ensureStoryboardProject(projectID, userID); err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = "新对话"
	}
	if len([]byte(title)) > maxBrainstormTitleLength {
		return model.StoryboardBrainstormConversation{}, safeMessageError{message: "对话标题过长"}
	}
	now := studioNow()
	conversation, err := repository.CreateStoryboardBrainstormConversation(model.StoryboardBrainstormConversation{
		ID: id, ProjectID: projectID, UserID: userID, Title: title, CreatedAt: now, UpdatedAt: now,
	})
	return conversation, brainstormError(err)
}

func RenameStoryboardBrainstormConversation(projectID, conversationID, userID, title string) (model.StoryboardBrainstormConversation, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return model.StoryboardBrainstormConversation{}, safeMessageError{message: "对话标题不能为空"}
	}
	if len([]byte(title)) > maxBrainstormTitleLength {
		return model.StoryboardBrainstormConversation{}, safeMessageError{message: "对话标题过长"}
	}
	conversation, err := repository.RenameStoryboardBrainstormConversation(projectID, conversationID, userID, title, studioNow())
	return conversation, brainstormError(err)
}

func DeleteStoryboardBrainstormConversation(projectID, conversationID, userID string) (StoryboardBrainstormDeleteResult, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return StoryboardBrainstormDeleteResult{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return StoryboardBrainstormDeleteResult{}, err
	}
	if _, err := repository.DeleteStoryboardBrainstormConversation(projectID, conversationID, userID); err != nil {
		return StoryboardBrainstormDeleteResult{}, brainstormError(err)
	}
	return StoryboardBrainstormDeleteResult{ID: conversationID, DeletedAt: studioNow()}, nil
}

func ListStoryboardBrainstormMessages(projectID, conversationID, userID string, query model.Query) (model.StoryboardBrainstormMessagePage, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormMessagePage{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormMessagePage{}, err
	}
	query.Normalize()
	conversation, messages, total, err := repository.ListStoryboardBrainstormMessages(projectID, conversationID, userID, query)
	if err != nil {
		return model.StoryboardBrainstormMessagePage{}, brainstormError(err)
	}
	if messages == nil {
		messages = []model.StoryboardBrainstormMessage{}
	}
	return model.StoryboardBrainstormMessagePage{Conversation: conversation, Items: messages, Total: total}, nil
}

func CreateStoryboardBrainstormTurn(projectID, conversationID, userID string, input StoryboardBrainstormTurnInput) (model.StoryboardBrainstormTurn, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	clientRequestID, err := validateBrainstormID(input.ClientRequestID, "clientRequestId")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	assistantMessageID, err := validateBrainstormID(input.AssistantMessageID, "Assistant 消息 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	command := repository.StoryboardBrainstormTurnCommand{
		Mode: strings.TrimSpace(input.Mode), ProjectID: projectID, ConversationID: conversationID, UserID: userID,
		ClientRequestID: clientRequestID, AssistantMessageID: assistantMessageID,
	}
	semantic := map[string]any{"mode": command.Mode, "assistantMessageId": assistantMessageID}
	switch command.Mode {
	case "append":
		command.ParentMessageID = strings.TrimSpace(input.ParentMessageID)
		if command.ParentMessageID != "" {
			command.ParentMessageID, err = validateBrainstormID(command.ParentMessageID, "父消息 ID")
			if err != nil {
				return model.StoryboardBrainstormTurn{}, err
			}
		}
		command.UserMessageID, err = validateBrainstormID(input.UserMessage.ID, "用户消息 ID")
		if err != nil {
			return model.StoryboardBrainstormTurn{}, err
		}
		if strings.TrimSpace(input.UserMessage.Content) == "" {
			return model.StoryboardBrainstormTurn{}, safeMessageError{message: "用户消息不能为空"}
		}
		if len([]byte(input.UserMessage.Content)) > maxBrainstormContentBytes {
			return model.StoryboardBrainstormTurn{}, safeMessageError{message: "用户消息过长"}
		}
		command.UserMessageContent = input.UserMessage.Content
		semantic["parentMessageId"] = command.ParentMessageID
		semantic["userMessage"] = map[string]string{"id": command.UserMessageID, "content": command.UserMessageContent}
	case "regenerate":
		command.TargetMessageID, err = validateBrainstormID(input.TargetMessageID, "目标消息 ID")
		if err != nil {
			return model.StoryboardBrainstormTurn{}, err
		}
		semantic["targetMessageId"] = command.TargetMessageID
	default:
		return model.StoryboardBrainstormTurn{}, safeMessageError{message: "Turn mode 无效"}
	}
	command.RequestHash = brainstormRequestHash(semantic)
	now := time.Now().UTC()
	command.UserCreatedAt = brainstormTimestamp(now)
	command.AssistantCreatedAt = brainstormTimestamp(now.Add(time.Nanosecond))
	turn, err := repository.CreateStoryboardBrainstormTurn(command)
	return turn, brainstormError(err)
}

func UpdateStoryboardBrainstormAssistant(projectID, conversationID, messageID, userID string, input StoryboardBrainstormAssistantInput) (model.StoryboardBrainstormMessage, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	messageID, err = validateBrainstormID(messageID, "消息 ID")
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	if input.ExpectedRevision == nil || *input.ExpectedRevision < 1 {
		return model.StoryboardBrainstormMessage{}, safeMessageError{message: "expectedRevision 无效"}
	}
	status := strings.TrimSpace(input.Status)
	if !model.IsBrainstormActiveStatus(status) && !model.IsBrainstormTerminalStatus(status) {
		return model.StoryboardBrainstormMessage{}, safeMessageError{message: "Assistant 状态无效"}
	}
	output, err := normalizeBrainstormOutput(input.Output)
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	message, err := repository.UpdateStoryboardBrainstormAssistant(repository.StoryboardBrainstormAssistantUpdate{
		ProjectID: projectID, ConversationID: conversationID, MessageID: messageID, UserID: userID,
		ExpectedRevision: *input.ExpectedRevision, AllowedStatuses: brainstormAssistantAllowedFrom(status), Status: status, Output: output, UpdatedAt: studioNow(),
	})
	return message, brainstormError(err)
}

func ContinueStoryboardBrainstormAssistant(projectID, conversationID, messageID, userID string, input StoryboardBrainstormContinueInput) (model.StoryboardBrainstormTurn, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	conversationID, err = validateBrainstormID(conversationID, "对话 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	messageID, err = validateBrainstormID(messageID, "消息 ID")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	clientRequestID, err := validateBrainstormID(input.ClientRequestID, "clientRequestId")
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	if input.ExpectedRevision == nil || *input.ExpectedRevision < 1 {
		return model.StoryboardBrainstormTurn{}, safeMessageError{message: "expectedRevision 无效"}
	}
	requestHash := brainstormRequestHash(map[string]any{"mode": "continue", "messageId": messageID, "expectedRevision": *input.ExpectedRevision})
	turn, err := repository.ContinueStoryboardBrainstormAssistant(repository.StoryboardBrainstormContinueCommand{
		ProjectID: projectID, ConversationID: conversationID, MessageID: messageID, UserID: userID,
		ClientRequestID: clientRequestID, RequestHash: requestHash, ExpectedRevision: *input.ExpectedRevision, UpdatedAt: studioNow(),
	})
	return turn, brainstormError(err)
}

func ListStoryboardMemories(projectID, userID string, query model.Query) (model.StoryboardMemoryPage, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardMemoryPage{}, err
	}
	if err := ensureStoryboardProject(projectID, userID); err != nil {
		return model.StoryboardMemoryPage{}, err
	}
	query.Normalize()
	items, total, err := repository.ListStoryboardMemories(projectID, userID, query)
	if err != nil {
		return model.StoryboardMemoryPage{}, err
	}
	if items == nil {
		items = []model.StoryboardMemory{}
	}
	return model.StoryboardMemoryPage{Items: items, Total: total}, nil
}

func CreateStoryboardMemory(projectID, userID string, input StoryboardMemoryInput) (model.StoryboardMemory, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	if err := ensureStoryboardProject(projectID, userID); err != nil {
		return model.StoryboardMemory{}, err
	}
	memory, err := normalizeStoryboardMemory(projectID, userID, "", input)
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	now := studioNow()
	memory.CreatedAt = now
	memory.UpdatedAt = now
	memory, err = repository.CreateStoryboardMemory(memory)
	return memory, brainstormError(err)
}

func UpdateStoryboardMemory(projectID, memoryID, userID string, input StoryboardMemoryInput) (model.StoryboardMemory, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	memoryID, err = validateBrainstormID(memoryID, "Memory ID")
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	memory, err := normalizeStoryboardMemory(projectID, userID, memoryID, input)
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	memory.UpdatedAt = studioNow()
	memory, err = repository.UpdateStoryboardMemory(memory)
	return memory, brainstormError(err)
}

func DeleteStoryboardMemory(projectID, memoryID, userID string) (StoryboardBrainstormDeleteResult, error) {
	projectID, err := validateBrainstormID(projectID, "项目 ID")
	if err != nil {
		return StoryboardBrainstormDeleteResult{}, err
	}
	memoryID, err = validateBrainstormID(memoryID, "Memory ID")
	if err != nil {
		return StoryboardBrainstormDeleteResult{}, err
	}
	if _, err := repository.DeleteStoryboardMemory(projectID, memoryID, userID); err != nil {
		return StoryboardBrainstormDeleteResult{}, brainstormError(err)
	}
	return StoryboardBrainstormDeleteResult{ID: memoryID, DeletedAt: studioNow()}, nil
}

func normalizeStoryboardMemory(projectID, userID, memoryID string, input StoryboardMemoryInput) (model.StoryboardMemory, error) {
	id := strings.TrimSpace(input.ID)
	var err error
	if memoryID == "" {
		id, err = validateBrainstormID(id, "Memory ID")
	} else {
		if id != "" && id != memoryID {
			return model.StoryboardMemory{}, safeMessageError{message: "Memory ID 不匹配"}
		}
		id = memoryID
	}
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" || len([]byte(kind)) > maxStoryboardMemoryKindLength {
		return model.StoryboardMemory{}, safeMessageError{message: "Memory kind 无效"}
	}
	scope := strings.TrimSpace(input.Scope)
	path := strings.TrimSpace(input.Path)
	switch scope {
	case model.StoryboardMemoryScopeProject:
		if path != "" {
			return model.StoryboardMemory{}, safeMessageError{message: "项目级 Memory path 必须为空"}
		}
	case model.StoryboardMemoryScopeScene, model.StoryboardMemoryScopeShot:
		if path == "" || len([]byte(path)) > maxStoryboardMemoryPathLength {
			return model.StoryboardMemory{}, safeMessageError{message: "Memory path 无效"}
		}
	default:
		return model.StoryboardMemory{}, safeMessageError{message: "Memory scope 无效"}
	}
	if strings.TrimSpace(input.Content) == "" || len([]byte(input.Content)) > maxStoryboardMemoryBytes {
		return model.StoryboardMemory{}, safeMessageError{message: "Memory 内容无效"}
	}
	operationID, err := validateBrainstormID(input.OperationID, "operationId")
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	tags, err := normalizeStoryboardMemoryTags(input.Tags)
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	sourceMessageID := strings.TrimSpace(input.SourceMessageID)
	if sourceMessageID != "" {
		sourceMessageID, err = validateBrainstormID(sourceMessageID, "来源消息 ID")
		if err != nil {
			return model.StoryboardMemory{}, err
		}
		if _, err := repository.GetStoryboardBrainstormMessage(projectID, sourceMessageID, userID); err != nil {
			return model.StoryboardMemory{}, brainstormError(err)
		}
	}
	return model.StoryboardMemory{
		ID: id, ProjectID: projectID, UserID: userID, Kind: kind, Scope: scope, Path: path, Content: input.Content,
		Tags: tags, SourceMessageID: sourceMessageID, OperationID: operationID,
	}, nil
}

func normalizeStoryboardMemoryTags(input []string) ([]string, error) {
	if len(input) > maxStoryboardMemoryTags {
		return nil, safeMessageError{message: "Memory tags 过多"}
	}
	tags := make([]string, 0, len(input))
	seen := map[string]bool{}
	for _, value := range input {
		tag := strings.TrimSpace(value)
		if tag == "" || len([]byte(tag)) > maxStoryboardMemoryTagLength {
			return nil, safeMessageError{message: "Memory tag 无效"}
		}
		if !seen[tag] {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	return tags, nil
}

func brainstormAssistantAllowedFrom(status string) []string {
	active := []string{model.BrainstormStatusPending, model.BrainstormStatusStreaming, model.BrainstormStatusAwaitingApproval}
	switch status {
	case model.BrainstormStatusPending:
		return []string{model.BrainstormStatusPending}
	case model.BrainstormStatusStreaming:
		return active
	case model.BrainstormStatusAwaitingApproval:
		return active
	default:
		return active
	}
}

func normalizeBrainstormOutput(raw json.RawMessage) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || len(trimmed) > maxBrainstormOutputBytes || trimmed[0] != '[' {
		return nil, safeMessageError{message: "Assistant output 必须是有界 JSON 数组"}
	}
	var items []json.RawMessage
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, safeMessageError{message: "Assistant output 必须是有界 JSON 数组"}
	}
	output, err := json.Marshal(items)
	if err != nil || len(output) > maxBrainstormOutputBytes {
		return nil, safeMessageError{message: "Assistant output 必须是有界 JSON 数组"}
	}
	return output, nil
}

func validateBrainstormID(value, name string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]byte(value)) > maxBrainstormIDLength {
		return "", safeMessageError{message: name + " 无效"}
	}
	return value, nil
}

func ensureStoryboardProject(projectID, userID string) error {
	_, err := repository.GetStoryboardProject(projectID, userID)
	return brainstormError(err)
}

func brainstormTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z07:00")
}

func brainstormRequestHash(value any) string {
	body, _ := json.Marshal(value)
	hash := sha256.Sum256(body)
	return hex.EncodeToString(hash[:])
}

type storyboardBrainstormNotFoundError struct{}

func (*storyboardBrainstormNotFoundError) Error() string {
	return "storyboard brainstorm resource not found"
}
func (*storyboardBrainstormNotFoundError) SafeMessage() string {
	return "资源不存在或无权操作"
}

type storyboardBrainstormConflictError struct {
	message string
	current any
}

func (err *storyboardBrainstormConflictError) Error() string       { return err.message }
func (err *storyboardBrainstormConflictError) SafeMessage() string { return err.message }

func IsStoryboardBrainstormNotFound(err error) bool {
	var target *storyboardBrainstormNotFoundError
	return errors.As(err, &target)
}

func StoryboardBrainstormConflict(err error) (string, any, bool) {
	var target *storyboardBrainstormConflictError
	if !errors.As(err, &target) {
		return "", nil, false
	}
	return target.message, target.current, true
}

func brainstormError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &storyboardBrainstormNotFoundError{}
	}
	if errors.Is(err, repository.ErrBrainstormInvalidParent) {
		return safeMessageError{message: "父消息无效"}
	}
	var conflict *repository.BrainstormConflictError
	if errors.As(err, &conflict) {
		message := "数据冲突"
		switch conflict.Kind {
		case repository.BrainstormConflictActiveTurn:
			message = "当前对话已有进行中的回复"
		case repository.BrainstormConflictIdempotency:
			message = "幂等键已被其他请求使用"
		case repository.BrainstormConflictRevision:
			message = "消息已被其他会话修改"
		case repository.BrainstormConflictLifecycle:
			message = "消息状态转换无效"
		case repository.BrainstormConflictID:
			message = "ID 已被其他记录使用"
		}
		return &storyboardBrainstormConflictError{message: message, current: conflict.Current}
	}
	return err
}
