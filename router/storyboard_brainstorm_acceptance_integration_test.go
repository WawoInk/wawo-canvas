package router_test

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestStoryboardBrainstormAcceptanceScope(t *testing.T) {
	server, ownerToken, otherToken := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "scope-project-" + suffix
	otherProjectID := "scope-other-project-" + suffix
	conversationID := "scope-conversation-" + suffix
	peerConversationID := "scope-peer-conversation-" + suffix
	userMessageID := "scope-user-" + suffix
	assistantMessageID := "scope-assistant-" + suffix
	memoryID := "scope-memory-" + suffix
	operationID := "scope-operation-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	createStoryboardBrainstormProject(t, server.URL, ownerToken, otherProjectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID, "title": "受保护会话"})
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": peerConversationID, "title": "同项目其他会话"})
	appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "scope-turn-"+suffix, userMessageID, assistantMessageID, "", "受保护消息")
	assistantURL := brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantMessageID + "/assistant"
	protectedOutput := []any{map[string]any{"type": "text", "text": "受保护回复"}}
	updateStoryboardBrainstormAssistant(t, assistantURL, ownerToken, 1, "completed", protectedOutput)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormMemoriesURL(server.URL, projectID), ownerToken, map[string]any{
		"id": memoryID, "kind": "fact", "scope": "project", "path": "", "content": "受保护记忆", "tags": []string{"scope"}, "sourceMessageId": userMessageID, "operationId": operationID,
	})

	beforeConversations := listBrainstormConversations(t, server.URL, ownerToken, projectID)
	beforeMessages := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 100)
	beforeMemories := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID)
	beforeOtherProjectMemories := listStoryboardBrainstormMemories(t, server.URL, ownerToken, otherProjectID)
	continuePayload := map[string]any{"clientRequestId": "scope-continue-" + suffix, "expectedRevision": 2}
	messageUpdate := map[string]any{"expectedRevision": 2, "status": "cancelled", "output": protectedOutput}
	memoryPayload := map[string]any{
		"id": "foreign-memory-" + suffix, "kind": "fact", "scope": "project", "path": "", "content": "不得写入", "tags": []string{"scope"}, "sourceMessageId": userMessageID, "operationId": "foreign-operation-" + suffix,
	}

	for _, test := range []struct {
		name, method, endpoint, token string
		status                        int
		payload                       any
	}{
		{name: "unauthenticated conversation", method: http.MethodGet, endpoint: brainstormConversationsURL(server.URL, projectID), status: http.StatusOK},
		{name: "unauthenticated message", method: http.MethodPut, endpoint: assistantURL, status: http.StatusOK, payload: messageUpdate},
		{name: "unauthenticated continue", method: http.MethodPost, endpoint: brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantMessageID + "/continue", status: http.StatusOK, payload: continuePayload},
		{name: "unauthenticated memory", method: http.MethodGet, endpoint: brainstormMemoriesURL(server.URL, projectID), status: http.StatusOK},
		{name: "cross account conversation", method: http.MethodPost, endpoint: brainstormConversationsURL(server.URL, projectID), token: otherToken, status: http.StatusNotFound, payload: map[string]any{"id": "foreign-conversation-" + suffix}},
		{name: "cross account message", method: http.MethodPut, endpoint: assistantURL, token: otherToken, status: http.StatusNotFound, payload: messageUpdate},
		{name: "cross account continue", method: http.MethodPost, endpoint: brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantMessageID + "/continue", token: otherToken, status: http.StatusNotFound, payload: continuePayload},
		{name: "cross account memory", method: http.MethodPost, endpoint: brainstormMemoriesURL(server.URL, projectID), token: otherToken, status: http.StatusNotFound, payload: memoryPayload},
		{name: "cross project conversation", method: http.MethodPut, endpoint: brainstormConversationsURL(server.URL, otherProjectID) + "/" + conversationID + "/title", token: ownerToken, status: http.StatusNotFound, payload: map[string]any{"title": "不得修改"}},
		{name: "cross project message", method: http.MethodPut, endpoint: brainstormMessagesURL(server.URL, otherProjectID, conversationID) + "/" + assistantMessageID + "/assistant", token: ownerToken, status: http.StatusNotFound, payload: messageUpdate},
		{name: "cross project continue", method: http.MethodPost, endpoint: brainstormMessagesURL(server.URL, otherProjectID, conversationID) + "/" + assistantMessageID + "/continue", token: ownerToken, status: http.StatusNotFound, payload: continuePayload},
		{name: "cross project memory", method: http.MethodPut, endpoint: brainstormMemoriesURL(server.URL, otherProjectID) + "/" + memoryID, token: ownerToken, status: http.StatusNotFound, payload: map[string]any{"kind": "fact", "scope": "project", "path": "", "content": "不得修改", "tags": []string{"scope"}, "operationId": operationID}},
		{name: "cross project memory source", method: http.MethodPost, endpoint: brainstormMemoriesURL(server.URL, otherProjectID), token: ownerToken, status: http.StatusNotFound, payload: memoryPayload},
		{name: "cross conversation message", method: http.MethodPut, endpoint: brainstormMessagesURL(server.URL, projectID, peerConversationID) + "/" + assistantMessageID + "/assistant", token: ownerToken, status: http.StatusNotFound, payload: messageUpdate},
		{name: "cross conversation continue", method: http.MethodPost, endpoint: brainstormMessagesURL(server.URL, projectID, peerConversationID) + "/" + assistantMessageID + "/continue", token: ownerToken, status: http.StatusNotFound, payload: continuePayload},
		{name: "cross conversation parent", method: http.MethodPost, endpoint: brainstormConversationsURL(server.URL, projectID) + "/" + peerConversationID + "/turns", token: ownerToken, status: http.StatusNotFound, payload: map[string]any{
			"mode": "append", "clientRequestId": "cross-conversation-turn-" + suffix, "parentMessageId": assistantMessageID,
			"userMessage": map[string]any{"id": "cross-conversation-user-" + suffix, "content": "不得追加"}, "assistantMessageId": "cross-conversation-assistant-" + suffix,
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			assertBrainstormAcceptanceFailure(t, test.status, test.method, test.endpoint, test.token, test.payload)
		})
	}

	if after := listBrainstormConversations(t, server.URL, ownerToken, projectID); !reflect.DeepEqual(after, beforeConversations) {
		t.Fatalf("scope failures changed conversations: before=%#v after=%#v", beforeConversations, after)
	}
	if after := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 100); !reflect.DeepEqual(after, beforeMessages) {
		t.Fatalf("scope failures changed messages: before=%#v after=%#v", beforeMessages, after)
	}
	if after := listStoryboardBrainstormMemories(t, server.URL, ownerToken, projectID); !reflect.DeepEqual(after, beforeMemories) {
		t.Fatalf("scope failures changed memories: before=%#v after=%#v", beforeMemories, after)
	}
	if after := listStoryboardBrainstormMemories(t, server.URL, ownerToken, otherProjectID); !reflect.DeepEqual(after, beforeOtherProjectMemories) {
		t.Fatalf("scope failures changed other project memories: before=%#v after=%#v", beforeOtherProjectMemories, after)
	}
}

func assertBrainstormAcceptanceFailure(t *testing.T, expectedStatus int, method, endpoint, token string, payload any) {
	t.Helper()
	status, response := brainstormRequest[any](t, method, endpoint, token, payload)
	if status != expectedStatus || response.Code == 0 || response.Data != nil {
		t.Fatalf("%s %s status=%d response=%#v, want status=%d failure without data", method, endpoint, status, response, expectedStatus)
	}
}

func TestStoryboardBrainstormConcurrentCAS(t *testing.T) {
	server, ownerToken, _ := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "cas-project-" + suffix
	conversationID := "cas-conversation-" + suffix
	userMessageID := "cas-user-" + suffix
	assistantMessageID := "cas-assistant-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID})
	appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "cas-turn-"+suffix, userMessageID, assistantMessageID, "", "并发完成")

	assistantURL := brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantMessageID + "/assistant"
	completedOutput := []any{map[string]any{"type": "text", "text": "完成结果"}}
	cancelledOutput := []any{map[string]any{"type": "text", "text": "取消前部分结果"}}
	first := asyncJSONRequest(http.MethodPut, assistantURL, ownerToken, map[string]any{"expectedRevision": 1, "status": "completed", "output": completedOutput})
	second := asyncJSONRequest(http.MethodPut, assistantURL, ownerToken, map[string]any{"expectedRevision": 1, "status": "cancelled", "output": cancelledOutput})

	var winner brainstormMessageView
	var conflict brainstormConflictView[brainstormMessageView]
	successes, conflicts := 0, 0
	for _, result := range []asyncRequestResult{waitForAsyncRequest(t, first), waitForAsyncRequest(t, second)} {
		switch result.status {
		case http.StatusOK:
			response := decodeConcurrencyResponse[brainstormMessageView](t, result.body)
			if response.Code != 0 {
				t.Fatalf("concurrent CAS success response=%#v", response)
			}
			successes++
			winner = response.Data
		case http.StatusConflict:
			response := decodeConcurrencyResponse[brainstormConflictView[brainstormMessageView]](t, result.body)
			if response.Code != -1 {
				t.Fatalf("concurrent CAS conflict response=%#v", response)
			}
			conflicts++
			conflict = response.Data
		default:
			t.Fatalf("concurrent CAS status=%d body=%s", result.status, result.body)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent CAS successes=%d conflicts=%d", successes, conflicts)
	}
	if winner.Revision != 2 || (winner.Status != "completed" && winner.Status != "cancelled") {
		t.Fatalf("concurrent CAS winner=%#v", winner)
	}
	assertBrainstormAcceptanceMessageMatches(t, conflict.Current, winner)
	final := findBrainstormMessage(t, getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 100).Items, assistantMessageID)
	assertBrainstormAcceptanceMessageMatches(t, final, winner)
}

func assertBrainstormAcceptanceMessageMatches(t *testing.T, got, want brainstormMessageView) {
	t.Helper()
	if got.ID != want.ID || got.ProjectID != want.ProjectID || got.ConversationID != want.ConversationID || got.ParentID != want.ParentID || got.Role != want.Role || got.Content != want.Content || got.Status != want.Status || got.Revision != want.Revision {
		t.Fatalf("message=%#v, want %#v", got, want)
	}
	var gotOutput, wantOutput any
	if err := json.Unmarshal(got.Output, &gotOutput); err != nil {
		t.Fatalf("decode message output %s: %v", got.Output, err)
	}
	if err := json.Unmarshal(want.Output, &wantOutput); err != nil {
		t.Fatalf("decode expected message output %s: %v", want.Output, err)
	}
	if !reflect.DeepEqual(gotOutput, wantOutput) {
		t.Fatalf("message output=%#v, want %#v", gotOutput, wantOutput)
	}
}

func TestStoryboardBrainstormCancelRetry(t *testing.T) {
	server, ownerToken, _ := newStoryboardBrainstormServer(t)
	defer server.Close()

	suffix := uuid.NewString()
	projectID := "cancel-retry-project-" + suffix
	conversationID := "cancel-retry-conversation-" + suffix
	userMessageID := "cancel-retry-user-" + suffix
	assistantMessageID := "cancel-retry-assistant-" + suffix
	retryAssistantID := "cancel-retry-sibling-" + suffix
	createStoryboardBrainstormProject(t, server.URL, ownerToken, projectID)
	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID), ownerToken, map[string]any{"id": conversationID})
	appendStoryboardBrainstormTurn(t, server.URL, ownerToken, projectID, conversationID, "cancel-retry-turn-"+suffix, userMessageID, assistantMessageID, "", "生成后取消")

	assistantURL := brainstormMessagesURL(server.URL, projectID, conversationID) + "/" + assistantMessageID + "/assistant"
	partialOutput := []any{map[string]any{"type": "text", "text": "已生成的部分结果"}}
	updateStoryboardBrainstormAssistant(t, assistantURL, ownerToken, 1, "streaming", partialOutput)
	updateStoryboardBrainstormAssistant(t, assistantURL, ownerToken, 2, "cancelled", partialOutput)

	refreshed := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 100)
	cancelled := findBrainstormMessage(t, refreshed.Items, assistantMessageID)
	if refreshed.Total != 2 || refreshed.Conversation.CurrentMessageID != assistantMessageID || cancelled.Status != "cancelled" || cancelled.Revision != 3 {
		t.Fatalf("cancelled refresh=%#v message=%#v", refreshed, cancelled)
	}
	assertBrainstormJSON(t, cancelled.Output, partialOutput)

	brainstormOK[json.RawMessage](t, http.MethodPost, brainstormConversationsURL(server.URL, projectID)+"/"+conversationID+"/turns", ownerToken, map[string]any{
		"mode": "regenerate", "clientRequestId": "cancel-retry-request-" + suffix, "targetMessageId": assistantMessageID, "assistantMessageId": retryAssistantID,
	})
	afterRetry := getStoryboardBrainstormMessages(t, server.URL, ownerToken, projectID, conversationID, 1, 100)
	oldAssistant := findBrainstormMessage(t, afterRetry.Items, assistantMessageID)
	sibling := findBrainstormMessage(t, afterRetry.Items, retryAssistantID)
	if !reflect.DeepEqual(oldAssistant, cancelled) {
		t.Fatalf("retry changed cancelled assistant: before=%#v after=%#v", cancelled, oldAssistant)
	}
	if afterRetry.Total != 3 || afterRetry.Conversation.CurrentMessageID != retryAssistantID || sibling.ParentID != userMessageID || sibling.Role != "assistant" || sibling.Status != "pending" || sibling.Revision != 1 {
		t.Fatalf("retry sibling page=%#v sibling=%#v", afterRetry, sibling)
	}
	assertBrainstormJSON(t, sibling.Output, []any{})
}
