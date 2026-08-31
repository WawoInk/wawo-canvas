package router_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

type brainstormConversationView struct {
	ID               string `json:"id"`
	ProjectID        string `json:"projectId"`
	Title            string `json:"title"`
	CurrentMessageID string `json:"currentMessageId"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type brainstormMessageView struct {
	ID             string          `json:"id"`
	ProjectID      string          `json:"projectId"`
	ConversationID string          `json:"conversationId"`
	ParentID       string          `json:"parentId"`
	Role           string          `json:"role"`
	Content        string          `json:"content"`
	Status         string          `json:"status"`
	Output         json.RawMessage `json:"output"`
	Revision       uint64          `json:"revision"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

type brainstormMessagePageView struct {
	Conversation brainstormConversationView `json:"conversation"`
	Items        []brainstormMessageView    `json:"items"`
	Total        int                        `json:"total"`
}

type brainstormMemoryView struct {
	ID              string   `json:"id"`
	ProjectID       string   `json:"projectId"`
	Kind            string   `json:"kind"`
	Scope           string   `json:"scope"`
	Path            string   `json:"path"`
	Content         string   `json:"content"`
	Tags            []string `json:"tags"`
	SourceMessageID string   `json:"sourceMessageId"`
	OperationID     string   `json:"operationId"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type brainstormConflictView[T any] struct {
	Current T `json:"current"`
}

func TestStoryboardBrainstormConversationCRUDOwnershipIdempotencyAndCleanup(t *testing.T) {
	server, ownerToken, otherToken := newStoryboardBrainstormServer(t)
	defer server.Close()

	projectID := "storyboard-brainstorm-conversations-" + uuid.NewString()
	conversationID := "conversation-" + uuid.NewString()
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	conversationsURL := brainstormConversationsURL(server.URL, projectID)

	brainstormOK[json.RawMessage](t, http.MethodPost, conversationsURL, ownerToken, map[string]any{"id": conversationID})
	created := findBrainstormConversation(t, listBrainstormConversations(t, server.URL, ownerToken, projectID), conversationID)
	if created.ProjectID != projectID || created.Title != "新对话" || created.CurrentMessageID != "" || created.CreatedAt == "" || created.UpdatedAt == "" {
		t.Fatalf("created conversation = %#v", created)
	}

	brainstormOK[json.RawMessage](t, http.MethodPost, conversationsURL, ownerToken, map[string]any{"id": conversationID})
	if countBrainstormConversation(listBrainstormConversations(t, server.URL, ownerToken, projectID), conversationID) != 1 {
		t.Fatalf("idempotent conversation %q was duplicated", conversationID)
	}

	renameURL := conversationsURL + "/" + conversationID + "/title"
	brainstormOK[json.RawMessage](t, http.MethodPut, renameURL, ownerToken, map[string]any{"title": "镜头节奏"})
	renamed := findBrainstormConversation(t, listBrainstormConversations(t, server.URL, ownerToken, projectID), conversationID)
	if renamed.Title != "镜头节奏" {
		t.Fatalf("renamed conversation = %#v", renamed)
	}

	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, conversationsURL, otherToken, nil)
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodPut, renameURL, otherToken, map[string]any{"title": "越权修改"})
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodDelete, conversationsURL+"/"+conversationID, otherToken, nil)

	clientRequestID := "request-cleanup-" + conversationID
	userMessageID := "user-cleanup-" + conversationID
	assistantMessageID := "assistant-cleanup-" + conversationID
	turn := appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, clientRequestID, userMessageID, assistantMessageID, "", "删除前消息")
	if turn.Total != 2 || turn.Conversation.CurrentMessageID != assistantMessageID {
		t.Fatalf("turn before conversation delete = %#v", turn)
	}

	brainstormOK[json.RawMessage](t, http.MethodDelete, conversationsURL+"/"+conversationID, ownerToken, nil)
	if countBrainstormConversation(listBrainstormConversations(t, server.URL, ownerToken, projectID), conversationID) != 0 {
		t.Fatalf("deleted conversation %q is still listed", conversationID)
	}
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, brainstormMessagesURL(server.URL, projectID, conversationID), ownerToken, nil)

	brainstormOK[json.RawMessage](t, http.MethodPost, conversationsURL, ownerToken, map[string]any{"id": conversationID, "title": "重建会话"})
	recreated := appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, clientRequestID, userMessageID, assistantMessageID, "", "重建后的消息")
	if recreated.Total != 2 || recreated.Items[0].Content != "重建后的消息" {
		t.Fatalf("conversation child cleanup was incomplete: %#v", recreated)
	}
}

func TestStoryboardBrainstormTurnGraphOutputCASContinueAndPagination(t *testing.T) {
	server, ownerToken, otherToken := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "storyboard-brainstorm-turns-" + suffix
	conversationID := "conversation-" + suffix
	userOneID := "01-user-" + suffix
	assistantOneID := "02-assistant-" + suffix
	userTwoID := "03-user-" + suffix
	assistantTwoID := "04-assistant-" + suffix
	regeneratedID := "05-assistant-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID, "title": "主线"})

	root := appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "append-root-"+suffix, userOneID, assistantOneID, "", "分析雨夜开场")
	if root.Total != 2 || root.Conversation.CurrentMessageID != assistantOneID {
		t.Fatalf("root turn = %#v", root)
	}
	userOne := findBrainstormMessage(t, root.Items, userOneID)
	assistantOne := findBrainstormMessage(t, root.Items, assistantOneID)
	if userOne.Role != "user" || userOne.ParentID != "" || userOne.Content != "分析雨夜开场" || userOne.Revision != 1 {
		t.Fatalf("root user message = %#v", userOne)
	}
	if assistantOne.Role != "assistant" || assistantOne.ParentID != userOneID || assistantOne.Content != "" || assistantOne.Status != "pending" || assistantOne.Revision != 1 {
		t.Fatalf("root assistant placeholder = %#v", assistantOne)
	}
	assertBrainstormJSON(t, assistantOne.Output, []any{})

	messagesURL := brainstormMessagesURL(server.URL, projectID, conversationID)
	assistantOneURL := messagesURL + "/" + assistantOneID + "/assistant"
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, messagesURL, otherToken, nil)
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodPost, brainstormConversationsURL(server.URL, projectID)+"/"+conversationID+"/turns", otherToken, map[string]any{
		"mode": "append", "clientRequestId": "foreign-" + suffix, "userMessage": map[string]any{"id": "foreign-user-" + suffix, "content": "越权"}, "assistantMessageId": "foreign-assistant-" + suffix,
	})
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodPut, assistantOneURL, otherToken, map[string]any{"expectedRevision": 1, "status": "completed", "output": []any{}})

	orderedOutput := []any{
		map[string]any{"type": "text", "text": "先读取当前分镜。"},
		map[string]any{"type": "tool_call", "id": "call-1", "name": "canvas.read", "arguments": map[string]any{"scope": "scene"}},
		map[string]any{"type": "tool_result", "toolCallId": "call-1", "output": map[string]any{"sceneId": "scene-1", "ok": true}},
		map[string]any{"type": "status", "status": "awaiting_approval", "detail": "等待确认"},
		map[string]any{"type": "error", "code": "RECOVERABLE", "message": "保留错误项", "retryable": true},
	}
	updateStoryboardBrainstormAssistant(t, assistantOneURL, ownerToken, 1, "streaming", orderedOutput)
	streaming := findBrainstormMessage(t, getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 20).Items, assistantOneID)
	if streaming.Status != "streaming" || streaming.Revision != 2 || streaming.Content != "" {
		t.Fatalf("streaming assistant = %#v", streaming)
	}
	assertBrainstormJSON(t, streaming.Output, orderedOutput)

	updateStoryboardBrainstormAssistant(t, assistantOneURL, ownerToken, 2, "awaiting_approval", orderedOutput)
	awaiting := findBrainstormMessage(t, getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 20).Items, assistantOneID)
	if awaiting.Status != "awaiting_approval" || awaiting.Revision != 3 {
		t.Fatalf("awaiting assistant = %#v", awaiting)
	}
	assertBrainstormJSON(t, awaiting.Output, orderedOutput)

	updateStoryboardBrainstormAssistant(t, assistantOneURL, ownerToken, 3, "completed", orderedOutput)
	completed := findBrainstormMessage(t, getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 20).Items, assistantOneID)
	if completed.Status != "completed" || completed.Revision != 4 {
		t.Fatalf("completed assistant = %#v", completed)
	}
	assertBrainstormJSON(t, completed.Output, orderedOutput)

	status, stale := brainstormRequest[brainstormConflictView[brainstormMessageView]](t, http.MethodPut, assistantOneURL, ownerToken, map[string]any{
		"expectedRevision": 3,
		"status":           "failed",
		"output":           []any{map[string]any{"type": "error", "message": "late completion"}},
	})
	if status != http.StatusConflict || stale.Code == 0 || stale.Data.Current.ID != assistantOneID || stale.Data.Current.Revision != 4 || stale.Data.Current.Status != "completed" {
		t.Fatalf("stale assistant update status=%d response=%#v", status, stale)
	}

	status, lifecycle := brainstormRequest[brainstormConflictView[brainstormMessageView]](t, http.MethodPut, assistantOneURL, ownerToken, map[string]any{
		"expectedRevision": 4,
		"status":           "streaming",
		"output":           orderedOutput,
	})
	if status != http.StatusConflict || lifecycle.Code == 0 || lifecycle.Data.Current.Revision != 4 || lifecycle.Data.Current.Status != "completed" {
		t.Fatalf("invalid lifecycle update status=%d response=%#v", status, lifecycle)
	}

	second := appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "append-child-"+suffix, userTwoID, assistantTwoID, assistantOneID, "补充分镜动作")
	if second.Total != 4 || second.Conversation.CurrentMessageID != assistantTwoID {
		t.Fatalf("second turn = %#v", second)
	}
	updateStoryboardBrainstormAssistant(t, brainstormMessagesURL(server.URL, projectID, conversationID)+"/"+assistantTwoID+"/assistant", ownerToken, 1, "completed", []any{})

	continueURL := brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantOneID + "/continue"
	brainstormOK[json.RawMessage](t, http.MethodPost, continueURL, ownerToken, map[string]any{"clientRequestId": "continue-old-" + suffix, "expectedRevision": 4})
	continuedPage := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 20)
	continued := findBrainstormMessage(t, continuedPage.Items, assistantOneID)
	if continuedPage.Total != 4 || continuedPage.Conversation.CurrentMessageID != assistantOneID || continued.ID != assistantOneID || continued.Status != "pending" || continued.Revision != 5 {
		t.Fatalf("continued assistant = %#v page=%#v", continued, continuedPage)
	}
	assertBrainstormJSON(t, continued.Output, orderedOutput)
	updateStoryboardBrainstormAssistant(t, assistantOneURL, ownerToken, 5, "completed", orderedOutput)

	turnsURL := brainstormConversationsURL(server.URL, projectID) + "/" + conversationID + "/turns"
	brainstormOK[json.RawMessage](t, http.MethodPost, turnsURL, ownerToken, map[string]any{
		"mode":               "regenerate",
		"clientRequestId":    "regenerate-" + suffix,
		"targetMessageId":    assistantTwoID,
		"assistantMessageId": regeneratedID,
	})

	pageOne := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 2)
	pageTwo := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 2, 2)
	pageThree := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 3, 2)
	if pageOne.Total != 5 || pageTwo.Total != 5 || pageThree.Total != 5 || pageOne.Conversation.CurrentMessageID != regeneratedID {
		t.Fatalf("paginated message graph page1=%#v page2=%#v page3=%#v", pageOne, pageTwo, pageThree)
	}
	messages := append(append(append([]brainstormMessageView{}, pageOne.Items...), pageTwo.Items...), pageThree.Items...)
	if got := brainstormMessageIDs(messages); !reflect.DeepEqual(got, []string{userOneID, assistantOneID, userTwoID, assistantTwoID, regeneratedID}) {
		t.Fatalf("message order = %v", got)
	}
	if findBrainstormMessage(t, messages, userOneID).ParentID != "" ||
		findBrainstormMessage(t, messages, assistantOneID).ParentID != userOneID ||
		findBrainstormMessage(t, messages, userTwoID).ParentID != assistantOneID ||
		findBrainstormMessage(t, messages, assistantTwoID).ParentID != userTwoID ||
		findBrainstormMessage(t, messages, regeneratedID).ParentID != userTwoID {
		t.Fatalf("message parent graph = %#v", messages)
	}
	regenerated := findBrainstormMessage(t, messages, regeneratedID)
	if regenerated.Role != "assistant" || regenerated.Status != "pending" || regenerated.Revision != 1 {
		t.Fatalf("regenerated assistant = %#v", regenerated)
	}
	assertBrainstormJSON(t, regenerated.Output, []any{})
}

func TestStoryboardBrainstormMemoryCRUDFieldsAndOwnership(t *testing.T) {
	server, ownerToken, otherToken := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "storyboard-brainstorm-memories-" + suffix
	conversationID := "conversation-" + suffix
	userMessageID := "memory-user-" + suffix
	assistantMessageID := "memory-assistant-" + suffix
	memoryID := "memory-" + suffix
	operationID := "memory-operation-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID})
	appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "memory-turn-"+suffix, userMessageID, assistantMessageID, "", "记住视觉约束")

	memoriesURL := brainstormMemoriesURL(server.URL, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, memoriesURL, ownerToken, map[string]any{
		"id":              memoryID,
		"kind":            "constraint",
		"scope":           "scene",
		"path":            "scene-1",
		"content":         "雨夜场景保持冷蓝色调",
		"tags":            []string{"tone", "rain"},
		"sourceMessageId": userMessageID,
		"operationId":     operationID,
	})
	memories := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID)
	if len(memories) != 1 {
		t.Fatalf("created memories = %#v", memories)
	}
	created := memories[0]
	if created.ID == "" || created.ProjectID != projectID || created.Kind != "constraint" || created.Scope != "scene" || created.Path != "scene-1" || created.Content != "雨夜场景保持冷蓝色调" || created.SourceMessageID != userMessageID || created.OperationID != operationID || !reflect.DeepEqual(created.Tags, []string{"tone", "rain"}) {
		t.Fatalf("created memory = %#v", created)
	}

	brainstormOK[json.RawMessage](t, http.MethodPut, memoriesURL+"/"+created.ID, ownerToken, map[string]any{
		"kind":            "decision",
		"scope":           "shot",
		"path":            "shot-2",
		"content":         "第二镜使用近景并保留雨丝",
		"tags":            []string{"shot", "continuity"},
		"sourceMessageId": assistantMessageID,
		"operationId":     operationID,
	})
	updated := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID)
	if len(updated) != 1 || updated[0].ID != created.ID || updated[0].Kind != "decision" || updated[0].Scope != "shot" || updated[0].Path != "shot-2" || updated[0].Content != "第二镜使用近景并保留雨丝" || updated[0].SourceMessageID != assistantMessageID || updated[0].OperationID != operationID || !reflect.DeepEqual(updated[0].Tags, []string{"shot", "continuity"}) {
		t.Fatalf("updated memories = %#v", updated)
	}

	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, memoriesURL, otherToken, nil)
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodPut, memoriesURL+"/"+created.ID, otherToken, map[string]any{
		"kind": "decision", "scope": "project", "path": "", "content": "越权修改", "tags": []string{}, "operationId": operationID,
	})
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodDelete, memoriesURL+"/"+created.ID, otherToken, nil)

	brainstormOK[json.RawMessage](t, http.MethodDelete, memoriesURL+"/"+created.ID, ownerToken, nil)
	if remaining := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID); len(remaining) != 0 {
		t.Fatalf("deleted memory remains = %#v", remaining)
	}
}

func TestStoryboardBrainstormStoryboardDeletionCleansAllChildren(t *testing.T) {
	server, ownerToken, _ := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "storyboard-brainstorm-delete-" + suffix
	conversationID := "conversation-delete-" + suffix
	userMessageID := "user-delete-" + suffix
	assistantMessageID := "assistant-delete-" + suffix
	memoryID := "memory-delete-" + suffix
	operationID := "operation-delete-" + suffix
	clientRequestID := "turn-delete-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID})
	appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, clientRequestID, userMessageID, assistantMessageID, "", "删除项目前的消息")
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormMemoriesURL(server.URL, projectID), ownerToken, map[string]any{
		"id": memoryID, "kind": "fact", "scope": "project", "path": "", "content": "删除项目前的记忆", "tags": []string{"cleanup"}, "sourceMessageId": userMessageID, "operationId": operationID,
	})

	brainstormOK[json.RawMessage](t, http.MethodDelete, server.URL+"/api/v1/storyboards/"+projectID, ownerToken, nil)
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, brainstormConversationsURL(server.URL, projectID), ownerToken, nil)
	assertBrainstormStatus(t, http.StatusNotFound, http.MethodGet, brainstormMemoriesURL(server.URL, projectID), ownerToken, nil)

	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID})
	recreatedMessages := appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, clientRequestID, userMessageID, assistantMessageID, "", "重建项目后的消息")
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormMemoriesURL(server.URL, projectID), ownerToken, map[string]any{
		"id": memoryID, "kind": "fact", "scope": "project", "path": "", "content": "重建项目后的记忆", "tags": []string{"cleanup"}, "sourceMessageId": userMessageID, "operationId": operationID,
	})
	if recreatedMessages.Total != 2 || recreatedMessages.Items[0].Content != "重建项目后的消息" {
		t.Fatalf("storyboard message cleanup was incomplete: %#v", recreatedMessages)
	}
	recreatedMemories := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID)
	if len(recreatedMemories) != 1 || recreatedMemories[0].Content != "重建项目后的记忆" || recreatedMemories[0].OperationID != operationID {
		t.Fatalf("storyboard memory cleanup was incomplete: %#v", recreatedMemories)
	}
}

func newStoryboardBrainstormServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	setupStudioPersistence(t)
	server, owner, other := studioPersistenceServer(t)
	return server, owner.Data.Token, other.Data.Token
}

func createStoryboardBrainstormProject(t *testing.T, baseURL, token, projectID string) {
	t.Helper()
	created := doJSON[storyboardDetailView](t, http.MethodPost, baseURL+"/api/v1/storyboards", token, storyboardPayload(projectID))
	if created.Code != 0 || created.Data.ID != projectID {
		t.Fatalf("create storyboard project = %#v", created)
	}
}

func brainstormConversationsURL(baseURL, projectID string) string {
	return baseURL + "/api/v1/storyboards/" + projectID + "/conversations"
}

func brainstormMessagesURL(baseURL, projectID, conversationID string) string {
	return brainstormConversationsURL(baseURL, projectID) + "/" + conversationID + "/messages"
}

func brainstormMemoriesURL(baseURL, projectID string) string {
	return baseURL + "/api/v1/storyboards/" + projectID + "/memories"
}

func appendStoryboardBrainstormTurn(t *testing.T, baseURL, token, projectID, conversationID, clientRequestID, userMessageID, assistantMessageID, parentMessageID, content string) brainstormMessagePageView {
	t.Helper()
	payload := map[string]any{
		"mode":               "append",
		"clientRequestId":    clientRequestID,
		"userMessage":        map[string]any{"id": userMessageID, "content": content},
		"assistantMessageId": assistantMessageID,
	}
	if parentMessageID != "" {
		payload["parentMessageId"] = parentMessageID
	}
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(baseURL, projectID)+"/"+conversationID+"/turns", token, payload)
	return getStoryboardBrainstormMessages(t, baseURL, token, projectID, conversationID, 1, 500)
}

func updateStoryboardBrainstormAssistant(t *testing.T, endpoint, token string, expectedRevision uint64, status string, output any) {
	t.Helper()
	brainstormOK[json.RawMessage](t, http.MethodPut, endpoint, token, map[string]any{"expectedRevision": expectedRevision, "status": status, "output": output})
}

func listBrainstormConversations(t *testing.T, baseURL, token, projectID string) []brainstormConversationView {
	t.Helper()
	return brainstormOK[[]brainstormConversationView](t, http.MethodGet, brainstormConversationsURL(baseURL, projectID), token, nil).Data
}

func getStoryboardBrainstormMessages(t *testing.T, baseURL, token, projectID, conversationID string, page, pageSize int) brainstormMessagePageView {
	t.Helper()
	endpoint := brainstormMessagesURL(baseURL, projectID, conversationID) + "?page=" + strconv.Itoa(page) + "&pageSize=" + strconv.Itoa(pageSize)
	return brainstormOK[brainstormMessagePageView](t, http.MethodGet, endpoint, token, nil).Data
}

func listStoryboardBrainstormMemories(t *testing.T, baseURL, token, projectID string) []brainstormMemoryView {
	t.Helper()
	return brainstormOK[[]brainstormMemoryView](t, http.MethodGet, brainstormMemoriesURL(baseURL, projectID), token, nil).Data
}

func brainstormRequest[T any](t *testing.T, method, endpoint, token string, payload any) (int, apiResponse[T]) {
	t.Helper()
	var body io.Reader
	contentType := ""
	if payload != nil {
		body = bytes.NewReader(mustJSON(t, payload))
		contentType = "application/json"
	}
	status, raw := doRawRequest(t, method, endpoint, token, contentType, body)
	var response apiResponse[T]
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("decode %s %s: %v: %s", method, endpoint, err, raw)
	}
	return status, response
}

func brainstormOK[T any](t *testing.T, method, endpoint, token string, payload any) apiResponse[T] {
	t.Helper()
	status, response := brainstormRequest[T](t, method, endpoint, token, payload)
	if status != http.StatusOK || response.Code != 0 {
		t.Fatalf("%s %s status=%d response=%#v", method, endpoint, status, response)
	}
	return response
}

func assertBrainstormStatus(t *testing.T, expected int, method, endpoint, token string, payload any) {
	t.Helper()
	status, response := brainstormRequest[json.RawMessage](t, method, endpoint, token, payload)
	if status != expected || response.Code == 0 {
		t.Fatalf("%s %s status=%d response=%#v, want status=%d failure", method, endpoint, status, response, expected)
	}
}

func findBrainstormConversation(t *testing.T, conversations []brainstormConversationView, id string) brainstormConversationView {
	t.Helper()
	for _, conversation := range conversations {
		if conversation.ID == id {
			return conversation
		}
	}
	t.Fatalf("conversation %q not found in %#v", id, conversations)
	return brainstormConversationView{}
}

func countBrainstormConversation(conversations []brainstormConversationView, id string) int {
	count := 0
	for _, conversation := range conversations {
		if conversation.ID == id {
			count++
		}
	}
	return count
}

func findBrainstormMessage(t *testing.T, messages []brainstormMessageView, id string) brainstormMessageView {
	t.Helper()
	for _, message := range messages {
		if message.ID == id {
			return message
		}
	}
	t.Fatalf("message %q not found in %#v", id, messages)
	return brainstormMessageView{}
}

func brainstormMessageIDs(messages []brainstormMessageView) []string {
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	return ids
}

func assertBrainstormJSON(t *testing.T, raw json.RawMessage, expected any) {
	t.Helper()
	var actual any
	if err := json.Unmarshal(raw, &actual); err != nil {
		t.Fatalf("decode output JSON: %v: %s", err, raw)
	}
	expectedRaw := mustJSON(t, expected)
	var normalizedExpected any
	if err := json.Unmarshal(expectedRaw, &normalizedExpected); err != nil {
		t.Fatalf("decode expected output JSON: %v", err)
	}
	if !reflect.DeepEqual(actual, normalizedExpected) {
		t.Fatalf("output JSON = %#v, want %#v", actual, normalizedExpected)
	}
}
