package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

type storyboardBrainstormTitleRequest struct {
	Title string `json:"title"`
}

func ListStoryboardBrainstormConversations(w http.ResponseWriter, r *http.Request, projectID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	conversations, err := service.ListStoryboardBrainstormConversations(projectID, userID)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, conversations)
}

func CreateStoryboardBrainstormConversation(w http.ResponseWriter, r *http.Request, projectID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardBrainstormConversationInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	conversation, err := service.CreateStoryboardBrainstormConversation(projectID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, conversation)
}

func RenameStoryboardBrainstormConversation(w http.ResponseWriter, r *http.Request, projectID, conversationID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input storyboardBrainstormTitleRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	conversation, err := service.RenameStoryboardBrainstormConversation(projectID, conversationID, userID, input.Title)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, conversation)
}

func DeleteStoryboardBrainstormConversation(w http.ResponseWriter, r *http.Request, projectID, conversationID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	if _, err := service.DeleteStoryboardBrainstormConversation(projectID, conversationID, userID); err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, map[string]string{"id": conversationID, "deletedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}

func ListStoryboardBrainstormMessages(w http.ResponseWriter, r *http.Request, projectID, conversationID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	page, err := service.ListStoryboardBrainstormMessages(projectID, conversationID, userID, parseQuery(r))
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, page)
}

func CreateStoryboardBrainstormTurn(w http.ResponseWriter, r *http.Request, projectID, conversationID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardBrainstormTurnInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	turn, err := service.CreateStoryboardBrainstormTurn(projectID, conversationID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, turn)
}

func UpdateStoryboardBrainstormAssistant(w http.ResponseWriter, r *http.Request, projectID, conversationID, messageID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardBrainstormAssistantInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	message, err := service.UpdateStoryboardBrainstormAssistant(projectID, conversationID, messageID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, message)
}

func ContinueStoryboardBrainstormAssistant(w http.ResponseWriter, r *http.Request, projectID, conversationID, messageID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardBrainstormContinueInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	turn, err := service.ContinueStoryboardBrainstormAssistant(projectID, conversationID, messageID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, turn)
}

func ListStoryboardMemories(w http.ResponseWriter, r *http.Request, projectID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	memories, err := service.ListStoryboardMemories(projectID, userID)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, memories)
}

func CreateStoryboardMemory(w http.ResponseWriter, r *http.Request, projectID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardMemoryInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	memory, err := service.CreateStoryboardMemory(projectID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, memory)
}

func UpdateStoryboardMemory(w http.ResponseWriter, r *http.Request, projectID, memoryID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	var input service.StoryboardMemoryInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "请求格式无效")
		return
	}
	memory, err := service.UpdateStoryboardMemory(projectID, memoryID, userID, input)
	if err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, memory)
}

func DeleteStoryboardMemory(w http.ResponseWriter, r *http.Request, projectID, memoryID string) {
	userID, ok := storyboardBrainstormUser(w, r)
	if !ok {
		return
	}
	if _, err := service.DeleteStoryboardMemory(projectID, memoryID, userID); err != nil {
		writeStoryboardBrainstormError(w, err)
		return
	}
	OK(w, map[string]string{"id": memoryID, "deletedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}

func storyboardBrainstormUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return "", false
	}
	return user.ID, true
}

func writeStoryboardBrainstormError(w http.ResponseWriter, err error) {
	if service.IsStoryboardBrainstormNotFound(err) {
		NotFound(w, "资源不存在或无权操作")
		return
	}
	if message, current, ok := service.StoryboardBrainstormConflict(err); ok {
		Conflict(w, message, current)
		return
	}
	FailError(w, err)
}
