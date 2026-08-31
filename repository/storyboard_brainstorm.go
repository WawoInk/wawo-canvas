package repository

import (
	"encoding/json"
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	BrainstormConflictActiveTurn  = "active_turn"
	BrainstormConflictIdempotency = "idempotency"
	BrainstormConflictRevision    = "revision"
	BrainstormConflictLifecycle   = "lifecycle"
	BrainstormConflictID          = "id"
)

var ErrBrainstormInvalidParent = errors.New("invalid brainstorm parent")

type BrainstormConflictError struct {
	Kind    string
	Current any
}

func (err *BrainstormConflictError) Error() string {
	return "storyboard brainstorm conflict: " + err.Kind
}

type StoryboardBrainstormTurnCommand struct {
	Mode               string
	ProjectID          string
	ConversationID     string
	UserID             string
	ClientRequestID    string
	RequestHash        string
	ActiveStatuses     []string
	ParentMessageID    string
	TargetMessageID    string
	UserMessageID      string
	UserMessageContent string
	AssistantMessageID string
	UserCreatedAt      string
	AssistantCreatedAt string
}

type StoryboardBrainstormAssistantUpdate struct {
	ProjectID        string
	ConversationID   string
	MessageID        string
	UserID           string
	ExpectedRevision uint64
	AllowedStatuses  []string
	Status           string
	Output           json.RawMessage
	UpdatedAt        string
}

type StoryboardBrainstormContinueCommand struct {
	ProjectID        string
	ConversationID   string
	MessageID        string
	UserID           string
	ClientRequestID  string
	RequestHash      string
	ExpectedRevision uint64
	ActiveStatuses   []string
	AllowedStatuses  []string
	TargetStatus     string
	UpdatedAt        string
}

func ListStoryboardBrainstormConversations(projectID, userID string, query model.Query) ([]model.StoryboardBrainstormConversation, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	scope := db.Model(&model.StoryboardBrainstormConversation{}).Where("user_id = ? AND project_id = ?", userID, projectID)
	var total int64
	if err := scope.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var conversations []model.StoryboardBrainstormConversation
	err = scope.Order("updated_at DESC, id DESC").Offset(query.Offset()).Limit(query.PageSize).Find(&conversations).Error
	return conversations, total, err
}

func CreateStoryboardBrainstormConversation(conversation model.StoryboardBrainstormConversation) (model.StoryboardBrainstormConversation, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := lockStoryboardProject(tx, conversation.ProjectID, conversation.UserID); err != nil {
			return err
		}
		return tx.Create(&conversation).Error
	})
	if err == nil {
		return conversation, nil
	}
	if !isUniqueViolation(err) {
		return model.StoryboardBrainstormConversation{}, err
	}
	var current model.StoryboardBrainstormConversation
	if findErr := db.Where("id = ? AND user_id = ? AND project_id = ?", conversation.ID, conversation.UserID, conversation.ProjectID).First(&current).Error; findErr == nil {
		return current, nil
	}
	return model.StoryboardBrainstormConversation{}, &BrainstormConflictError{Kind: BrainstormConflictID}
}

func GetStoryboardBrainstormConversation(projectID, conversationID, userID string) (model.StoryboardBrainstormConversation, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	var conversation model.StoryboardBrainstormConversation
	err = db.Where("id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).First(&conversation).Error
	return conversation, err
}

func RenameStoryboardBrainstormConversation(projectID, conversationID, userID, title, updatedAt string) (model.StoryboardBrainstormConversation, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	result := db.Model(&model.StoryboardBrainstormConversation{}).
		Where("id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).
		Updates(map[string]any{"title": title, "updated_at": updatedAt})
	if result.Error != nil {
		return model.StoryboardBrainstormConversation{}, result.Error
	}
	if result.RowsAffected != 1 {
		return model.StoryboardBrainstormConversation{}, gorm.ErrRecordNotFound
	}
	return GetStoryboardBrainstormConversation(projectID, conversationID, userID)
}

func DeleteStoryboardBrainstormConversation(projectID, conversationID, userID string) (model.StoryboardBrainstormConversation, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormConversation{}, err
	}
	var conversation model.StoryboardBrainstormConversation
	err = db.Transaction(func(tx *gorm.DB) error {
		var err error
		conversation, err = lockStoryboardBrainstormConversation(tx, projectID, conversationID, userID)
		if err != nil {
			return err
		}
		if err := tx.Where("conversation_id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).Delete(&model.StoryboardBrainstormMessage{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).Delete(&model.StoryboardBrainstormConversation{}).Error
	})
	return conversation, err
}

func ListStoryboardBrainstormMessages(projectID, conversationID, userID string, query model.Query) (model.StoryboardBrainstormConversation, []model.StoryboardBrainstormMessage, int64, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormConversation{}, nil, 0, err
	}
	var conversation model.StoryboardBrainstormConversation
	if err := db.Where("id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).First(&conversation).Error; err != nil {
		return model.StoryboardBrainstormConversation{}, nil, 0, err
	}
	scope := db.Model(&model.StoryboardBrainstormMessage{}).Where("conversation_id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID)
	var total int64
	if err := scope.Count(&total).Error; err != nil {
		return model.StoryboardBrainstormConversation{}, nil, 0, err
	}
	var messages []model.StoryboardBrainstormMessage
	err = scope.Order("created_at ASC, id ASC").Offset(query.Offset()).Limit(query.PageSize).Find(&messages).Error
	return conversation, messages, total, err
}

func GetStoryboardBrainstormMessage(projectID, messageID, userID string) (model.StoryboardBrainstormMessage, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	var message model.StoryboardBrainstormMessage
	err = db.Where("id = ? AND project_id = ? AND user_id = ?", messageID, projectID, userID).First(&message).Error
	return message, err
}

func CreateStoryboardBrainstormTurn(command StoryboardBrainstormTurnCommand) (model.StoryboardBrainstormTurn, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	var turn model.StoryboardBrainstormTurn
	err = db.Transaction(func(tx *gorm.DB) error {
		conversation, err := lockStoryboardBrainstormConversation(tx, command.ProjectID, command.ConversationID, command.UserID)
		if err != nil {
			return err
		}
		turn.Conversation = conversation

		existing, existingHash, err := findAssistantByClientRequest(tx, command.ProjectID, command.ConversationID, command.UserID, command.ClientRequestID)
		if err == nil {
			if existingHash != command.RequestHash {
				return &BrainstormConflictError{Kind: BrainstormConflictIdempotency, Current: existing}
			}
			turn.AssistantMessage = existing
			if existing.ParentID != "" {
				var userMessage model.StoryboardBrainstormMessage
				if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", existing.ParentID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleUser).First(&userMessage).Error; err == nil {
					turn.UserMessage = &userMessage
				}
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if existingTurn, found, err := findTurnByMessageIDs(tx, command, conversation); err != nil {
			return err
		} else if found {
			turn = existingTurn
			return nil
		}
		if active, err := findActiveAssistant(tx, command.ProjectID, command.ConversationID, command.UserID, command.ActiveStatuses); err == nil {
			return &BrainstormConflictError{Kind: BrainstormConflictActiveTurn, Current: active}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		messageIDs := []string{command.AssistantMessageID}
		if command.Mode == "append" {
			messageIDs = append(messageIDs, command.UserMessageID)
		}
		for _, messageID := range messageIDs {
			var current model.StoryboardBrainstormMessage
			if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ?", messageID, command.ProjectID, command.ConversationID, command.UserID).First(&current).Error; err == nil {
				return &BrainstormConflictError{Kind: BrainstormConflictID, Current: current}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}

		assistant := model.StoryboardBrainstormMessage{
			ID: command.AssistantMessageID, ProjectID: command.ProjectID, ConversationID: command.ConversationID, UserID: command.UserID,
			Role: model.BrainstormRoleAssistant, Output: json.RawMessage("[]"), Status: model.BrainstormStatusPending,
			ClientRequestID: command.ClientRequestID, RequestHash: command.RequestHash, Revision: 1,
			CreatedAt: command.AssistantCreatedAt, UpdatedAt: command.AssistantCreatedAt,
		}
		switch command.Mode {
		case "append":
			if command.ParentMessageID == "" {
				var count int64
				if err := tx.Model(&model.StoryboardBrainstormMessage{}).Where("project_id = ? AND conversation_id = ? AND user_id = ?", command.ProjectID, command.ConversationID, command.UserID).Count(&count).Error; err != nil {
					return err
				}
				if count != 0 {
					return ErrBrainstormInvalidParent
				}
			} else {
				var parent model.StoryboardBrainstormMessage
				if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.ParentMessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&parent).Error; err != nil {
					return err
				}
			}
			userMessage := model.StoryboardBrainstormMessage{
				ID: command.UserMessageID, ProjectID: command.ProjectID, ConversationID: command.ConversationID, UserID: command.UserID,
				ParentID: command.ParentMessageID, Role: model.BrainstormRoleUser, Content: command.UserMessageContent,
				Output: json.RawMessage("[]"), Revision: 1, CreatedAt: command.UserCreatedAt, UpdatedAt: command.UserCreatedAt,
			}
			if err := tx.Create(&userMessage).Error; err != nil {
				return brainstormInsertError(err)
			}
			assistant.ParentID = userMessage.ID
			turn.UserMessage = &userMessage
		case "regenerate":
			var target model.StoryboardBrainstormMessage
			if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.TargetMessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&target).Error; err != nil {
				return err
			}
			assistant.ParentID = target.ParentID
		default:
			return errors.New("unsupported brainstorm turn mode")
		}
		if err := tx.Create(&assistant).Error; err != nil {
			return brainstormInsertError(err)
		}
		result := tx.Model(&model.StoryboardBrainstormConversation{}).
			Where("id = ? AND project_id = ? AND user_id = ?", command.ConversationID, command.ProjectID, command.UserID).
			Updates(map[string]any{"current_message_id": assistant.ID, "updated_at": command.AssistantCreatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		turn.Conversation.CurrentMessageID = assistant.ID
		turn.Conversation.UpdatedAt = command.AssistantCreatedAt
		turn.AssistantMessage = assistant
		return nil
	})
	return turn, err
}

func UpdateStoryboardBrainstormAssistant(command StoryboardBrainstormAssistantUpdate) (model.StoryboardBrainstormMessage, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	var current model.StoryboardBrainstormMessage
	if err := db.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&current).Error; err != nil {
		return model.StoryboardBrainstormMessage{}, err
	}
	if current.Revision != command.ExpectedRevision {
		return model.StoryboardBrainstormMessage{}, &BrainstormConflictError{Kind: BrainstormConflictRevision, Current: current}
	}
	result := db.Model(&model.StoryboardBrainstormMessage{}).
		Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ? AND revision = ? AND status IN ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant, command.ExpectedRevision, command.AllowedStatuses).
		Updates(map[string]any{"status": command.Status, "output": gorm.Expr("?::jsonb", string(command.Output)), "revision": gorm.Expr("revision + 1"), "updated_at": command.UpdatedAt})
	if result.Error != nil {
		return model.StoryboardBrainstormMessage{}, result.Error
	}
	if result.RowsAffected != 1 {
		var latest model.StoryboardBrainstormMessage
		findErr := db.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&latest).Error
		if findErr != nil {
			return model.StoryboardBrainstormMessage{}, findErr
		}
		kind := BrainstormConflictLifecycle
		if latest.Revision != command.ExpectedRevision {
			kind = BrainstormConflictRevision
		}
		return model.StoryboardBrainstormMessage{}, &BrainstormConflictError{Kind: kind, Current: latest}
	}
	current.Status = command.Status
	current.Output = command.Output
	current.Revision++
	current.UpdatedAt = command.UpdatedAt
	return current, nil
}

func ContinueStoryboardBrainstormAssistant(command StoryboardBrainstormContinueCommand) (model.StoryboardBrainstormTurn, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardBrainstormTurn{}, err
	}
	var turn model.StoryboardBrainstormTurn
	err = db.Transaction(func(tx *gorm.DB) error {
		conversation, err := lockStoryboardBrainstormConversation(tx, command.ProjectID, command.ConversationID, command.UserID)
		if err != nil {
			return err
		}
		turn.Conversation = conversation
		existing, existingHash, err := findAssistantByClientRequest(tx, command.ProjectID, command.ConversationID, command.UserID, command.ClientRequestID)
		if err == nil {
			if existing.ID != command.MessageID || existingHash != command.RequestHash {
				return &BrainstormConflictError{Kind: BrainstormConflictIdempotency, Current: existing}
			}
			turn.AssistantMessage = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if active, err := findActiveAssistant(tx, command.ProjectID, command.ConversationID, command.UserID, command.ActiveStatuses); err == nil {
			return &BrainstormConflictError{Kind: BrainstormConflictActiveTurn, Current: active}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var assistant model.StoryboardBrainstormMessage
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&assistant).Error; err != nil {
			return err
		}
		if assistant.Revision != command.ExpectedRevision {
			return &BrainstormConflictError{Kind: BrainstormConflictRevision, Current: assistant}
		}
		result := tx.Model(&model.StoryboardBrainstormMessage{}).
			Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ? AND revision = ? AND status IN ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant, command.ExpectedRevision, command.AllowedStatuses).
			Updates(map[string]any{
				"status": command.TargetStatus, "continue_request_id": command.ClientRequestID, "continue_request_hash": command.RequestHash,
				"revision": gorm.Expr("revision + 1"), "updated_at": command.UpdatedAt,
			})
		if result.Error != nil {
			if isUniqueViolation(result.Error) {
				return &BrainstormConflictError{Kind: BrainstormConflictIdempotency}
			}
			return result.Error
		}
		if result.RowsAffected != 1 {
			var latest model.StoryboardBrainstormMessage
			if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.MessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&latest).Error; err != nil {
				return err
			}
			kind := BrainstormConflictLifecycle
			if latest.Revision != command.ExpectedRevision {
				kind = BrainstormConflictRevision
			}
			return &BrainstormConflictError{Kind: kind, Current: latest}
		}
		if err := tx.Model(&model.StoryboardBrainstormConversation{}).
			Where("id = ? AND project_id = ? AND user_id = ?", command.ConversationID, command.ProjectID, command.UserID).
			Updates(map[string]any{"current_message_id": assistant.ID, "updated_at": command.UpdatedAt}).Error; err != nil {
			return err
		}
		assistant.Status = command.TargetStatus
		assistant.ContinueRequestID = command.ClientRequestID
		assistant.ContinueRequestHash = command.RequestHash
		assistant.Revision++
		assistant.UpdatedAt = command.UpdatedAt
		turn.Conversation.CurrentMessageID = assistant.ID
		turn.Conversation.UpdatedAt = command.UpdatedAt
		turn.AssistantMessage = assistant
		return nil
	})
	return turn, err
}

func ListStoryboardMemories(projectID, userID string, query model.Query) ([]model.StoryboardMemory, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	scope := db.Model(&model.StoryboardMemory{}).Where("project_id = ? AND user_id = ?", projectID, userID)
	var total int64
	if err := scope.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var memories []model.StoryboardMemory
	err = scope.Order("updated_at DESC, id DESC").Offset(query.Offset()).Limit(query.PageSize).Find(&memories).Error
	return memories, total, err
}

func CreateStoryboardMemory(memory model.StoryboardMemory) (model.StoryboardMemory, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	var result model.StoryboardMemory
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := lockStoryboardProject(tx, memory.ProjectID, memory.UserID); err != nil {
			return err
		}
		var existing model.StoryboardMemory
		if err := tx.Where("project_id = ? AND user_id = ? AND operation_id = ?", memory.ProjectID, memory.UserID, memory.OperationID).First(&existing).Error; err == nil {
			if sameStoryboardMemory(existing, memory) {
				result = existing
				return nil
			}
			return &BrainstormConflictError{Kind: BrainstormConflictIdempotency, Current: existing}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Where("id = ? AND project_id = ? AND user_id = ?", memory.ID, memory.ProjectID, memory.UserID).First(&existing).Error; err == nil {
			return &BrainstormConflictError{Kind: BrainstormConflictID, Current: existing}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Create(&memory).Error; err != nil {
			if isUniqueViolation(err) {
				return &BrainstormConflictError{Kind: BrainstormConflictIdempotency}
			}
			return err
		}
		result = memory
		return nil
	})
	return result, err
}

func UpdateStoryboardMemory(memory model.StoryboardMemory) (model.StoryboardMemory, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	var result model.StoryboardMemory
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := lockStoryboardProject(tx, memory.ProjectID, memory.UserID); err != nil {
			return err
		}
		var current model.StoryboardMemory
		if err := tx.Where("id = ? AND project_id = ? AND user_id = ?", memory.ID, memory.ProjectID, memory.UserID).First(&current).Error; err != nil {
			return err
		}
		if memory.OperationID != current.OperationID {
			return &BrainstormConflictError{Kind: BrainstormConflictIdempotency, Current: current}
		}
		if sameStoryboardMemory(current, memory) {
			result = current
			return nil
		}
		tags, _ := json.Marshal(memory.Tags)
		updates := map[string]any{
			"kind": memory.Kind, "scope": memory.Scope, "path": memory.Path, "content": memory.Content, "tags": gorm.Expr("?::jsonb", string(tags)),
			"source_message_id": memory.SourceMessageID, "updated_at": memory.UpdatedAt,
		}
		if err := tx.Model(&model.StoryboardMemory{}).Where("id = ? AND project_id = ? AND user_id = ?", memory.ID, memory.ProjectID, memory.UserID).Updates(updates).Error; err != nil {
			if isUniqueViolation(err) {
				return &BrainstormConflictError{Kind: BrainstormConflictIdempotency}
			}
			return err
		}
		memory.CreatedAt = current.CreatedAt
		result = memory
		return nil
	})
	return result, err
}

func DeleteStoryboardMemory(projectID, memoryID, userID string) (model.StoryboardMemory, error) {
	db, err := DB()
	if err != nil {
		return model.StoryboardMemory{}, err
	}
	var memory model.StoryboardMemory
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, err := lockStoryboardProject(tx, projectID, userID); err != nil {
			return err
		}
		if err := tx.Where("id = ? AND project_id = ? AND user_id = ?", memoryID, projectID, userID).First(&memory).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND project_id = ? AND user_id = ?", memoryID, projectID, userID).Delete(&model.StoryboardMemory{}).Error
	})
	return memory, err
}

func lockStoryboardProject(tx *gorm.DB, projectID, userID string) (model.StoryboardProject, error) {
	var project model.StoryboardProject
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error
	return project, err
}

func findTurnByMessageIDs(tx *gorm.DB, command StoryboardBrainstormTurnCommand, conversation model.StoryboardBrainstormConversation) (model.StoryboardBrainstormTurn, bool, error) {
	var assistant model.StoryboardBrainstormMessage
	err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.AssistantMessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleAssistant).First(&assistant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if command.Mode == "append" {
			var userMessage model.StoryboardBrainstormMessage
			err = tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ?", command.UserMessageID, command.ProjectID, command.ConversationID, command.UserID).First(&userMessage).Error
			if err == nil {
				return model.StoryboardBrainstormTurn{}, false, &BrainstormConflictError{Kind: BrainstormConflictID, Current: userMessage}
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return model.StoryboardBrainstormTurn{}, false, err
			}
		}
		return model.StoryboardBrainstormTurn{}, false, nil
	}
	if err != nil {
		return model.StoryboardBrainstormTurn{}, false, err
	}
	if assistant.RequestHash != command.RequestHash {
		return model.StoryboardBrainstormTurn{}, false, &BrainstormConflictError{Kind: BrainstormConflictID, Current: assistant}
	}
	turn := model.StoryboardBrainstormTurn{Conversation: conversation, AssistantMessage: assistant}
	if command.Mode == "append" {
		var userMessage model.StoryboardBrainstormMessage
		if err := tx.Where("id = ? AND project_id = ? AND conversation_id = ? AND user_id = ? AND role = ?", command.UserMessageID, command.ProjectID, command.ConversationID, command.UserID, model.BrainstormRoleUser).First(&userMessage).Error; err != nil {
			return model.StoryboardBrainstormTurn{}, false, err
		}
		if assistant.ParentID != userMessage.ID || userMessage.ParentID != command.ParentMessageID || userMessage.Content != command.UserMessageContent {
			return model.StoryboardBrainstormTurn{}, false, &BrainstormConflictError{Kind: BrainstormConflictID, Current: userMessage}
		}
		turn.UserMessage = &userMessage
	}
	return turn, true, nil
}

func lockStoryboardBrainstormConversations(tx *gorm.DB, projectID, userID string) error {
	var conversations []model.StoryboardBrainstormConversation
	return tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("project_id = ? AND user_id = ?", projectID, userID).Find(&conversations).Error
}

func lockStoryboardBrainstormConversation(tx *gorm.DB, projectID, conversationID, userID string) (model.StoryboardBrainstormConversation, error) {
	var conversation model.StoryboardBrainstormConversation
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND project_id = ? AND user_id = ?", conversationID, projectID, userID).First(&conversation).Error
	return conversation, err
}

func findAssistantByClientRequest(tx *gorm.DB, projectID, conversationID, userID, clientRequestID string) (model.StoryboardBrainstormMessage, string, error) {
	var message model.StoryboardBrainstormMessage
	err := tx.Where("project_id = ? AND conversation_id = ? AND user_id = ? AND role = ? AND (client_request_id = ? OR continue_request_id = ?)", projectID, conversationID, userID, model.BrainstormRoleAssistant, clientRequestID, clientRequestID).First(&message).Error
	if err != nil {
		return model.StoryboardBrainstormMessage{}, "", err
	}
	if message.ClientRequestID == clientRequestID {
		return message, message.RequestHash, nil
	}
	return message, message.ContinueRequestHash, nil
}

func findActiveAssistant(tx *gorm.DB, projectID, conversationID, userID string, activeStatuses []string) (model.StoryboardBrainstormMessage, error) {
	var message model.StoryboardBrainstormMessage
	err := tx.Where("project_id = ? AND conversation_id = ? AND user_id = ? AND role = ? AND status IN ?", projectID, conversationID, userID, model.BrainstormRoleAssistant, activeStatuses).First(&message).Error
	return message, err
}

func brainstormInsertError(err error) error {
	if !isUniqueViolation(err) {
		return err
	}
	switch uniqueConstraint(err) {
	case "idx_brainstorm_active_assistant":
		return &BrainstormConflictError{Kind: BrainstormConflictActiveTurn}
	case "idx_brainstorm_client_request", "idx_brainstorm_continue_request":
		return &BrainstormConflictError{Kind: BrainstormConflictIdempotency}
	default:
		return &BrainstormConflictError{Kind: BrainstormConflictID}
	}
}

func sameStoryboardMemory(left, right model.StoryboardMemory) bool {
	if left.ID != right.ID || left.Kind != right.Kind || left.Scope != right.Scope || left.Path != right.Path || left.Content != right.Content || left.SourceMessageID != right.SourceMessageID || len(left.Tags) != len(right.Tags) {
		return false
	}
	for index := range left.Tags {
		if left.Tags[index] != right.Tags[index] {
			return false
		}
	}
	return true
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func uniqueConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}
