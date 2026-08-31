package router_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

type concurrencyBrainstormConversationView struct {
	ID               string `json:"id"`
	CurrentMessageID string `json:"currentMessageId"`
}

type concurrencyBrainstormMessageView struct {
	ID        string          `json:"id"`
	ParentID  string          `json:"parentId"`
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Output    json.RawMessage `json:"output"`
	Status    string          `json:"status"`
	Revision  uint64          `json:"revision"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type concurrencyBrainstormMessagesPage struct {
	Conversation concurrencyBrainstormConversationView `json:"conversation"`
	Items        []concurrencyBrainstormMessageView    `json:"items"`
	Total        int64                                 `json:"total"`
}

type concurrencyBrainstormHarness struct {
	Server    *httptest.Server
	Token     string
	ProjectID string
}

func TestStoryboardBrainstormReplayPrecedesActiveTurnConflict(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	assistantID := "assistant-" + uuid.NewString()
	payload := concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), assistantID, "分析开场节奏")

	harness.mustTurn(t, conversationID, payload)
	harness.mustTurn(t, conversationID, payload)

	page := harness.messages(t, conversationID)
	if page.Total != 2 || len(page.Items) != 2 || page.Conversation.CurrentMessageID != assistantID {
		t.Fatalf("idempotent replay created duplicate turn: %#v", page)
	}
	assistant := concurrencyMessageByID(t, page, assistantID)
	if assistant.Status != "pending" || assistant.Revision != 1 {
		t.Fatalf("replayed assistant = %#v", assistant)
	}
}

func TestStoryboardBrainstormMessageIDReplayIsIdempotent(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	userID := "user-" + uuid.NewString()
	assistantID := "assistant-" + uuid.NewString()
	harness.mustTurn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "稳定消息 ID"))
	harness.mustUpdateAssistant(t, conversationID, assistantID, 1, "completed", []any{map[string]any{"type": "text", "text": "已完成"}})

	status, response := harness.turn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "稳定消息 ID"))
	if status != http.StatusOK || response.Code != 0 {
		t.Fatalf("message ID replay status=%d response=%#v", status, response)
	}
	page := harness.messages(t, conversationID)
	if page.Total != 2 || len(page.Items) != 2 || page.Conversation.CurrentMessageID != assistantID {
		t.Fatalf("message ID replay created duplicate turn: %#v", page)
	}
}

func TestStoryboardBrainstormClientRequestReuseWithDifferentSemanticInputConflicts(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	requestID := "request-" + uuid.NewString()
	assistantID := "assistant-" + uuid.NewString()
	harness.mustTurn(t, conversationID, concurrencyAppendPayload(requestID, "user-"+uuid.NewString(), assistantID, "分析第一版"))
	harness.mustUpdateAssistant(t, conversationID, assistantID, 1, "completed", []any{map[string]any{"type": "text", "text": "第一版完成"}})

	status, response := harness.turn(t, conversationID, concurrencyAppendPayload(requestID, "user-"+uuid.NewString(), "assistant-"+uuid.NewString(), "语义不同的第二版"))
	if status != http.StatusConflict || response.Code != -1 {
		t.Fatalf("clientRequestId semantic reuse status=%d response=%#v", status, response)
	}
	page := harness.messages(t, conversationID)
	if page.Total != 2 || len(page.Items) != 2 || page.Conversation.CurrentMessageID != assistantID {
		t.Fatalf("semantic conflict changed conversation: %#v", page)
	}
}

func TestStoryboardBrainstormSameConversationConcurrentAppendsAllowExactlyOneActiveTurn(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	gate := newConcurrencyAssistantInsertGate(t)
	firstAssistantID := "assistant-" + uuid.NewString()
	secondAssistantID := "assistant-" + uuid.NewString()

	first := asyncJSONRequest(http.MethodPost, harness.turnURL(conversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), firstAssistantID, "并发请求一"))
	firstPID := gate.waitForWaiters(t, 1)[0]
	second := asyncJSONRequest(http.MethodPost, harness.turnURL(conversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), secondAssistantID, "并发请求二"))
	gate.waitForBlockedBy(t, firstPID)
	gate.release(t)

	results := []asyncRequestResult{waitForAsyncRequest(t, first), waitForAsyncRequest(t, second)}
	successes, conflicts := 0, 0
	for _, result := range results {
		response := decodeConcurrencyResponse[json.RawMessage](t, result.body)
		switch {
		case result.status == http.StatusOK && response.Code == 0:
			successes++
		case result.status == http.StatusConflict && response.Code == -1:
			conflicts++
		default:
			t.Fatalf("concurrent append status=%d response=%#v", result.status, response)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent append successes=%d conflicts=%d", successes, conflicts)
	}
	page := harness.messages(t, conversationID)
	if page.Total != 2 || len(page.Items) != 2 {
		t.Fatalf("losing concurrent append was not atomic: %#v", page)
	}
	if current := page.Conversation.CurrentMessageID; current != firstAssistantID && current != secondAssistantID {
		t.Fatalf("current message after concurrent append = %q", current)
	}
}

func TestStoryboardBrainstormDifferentConversationsAppendIndependently(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	firstConversationID := harness.createConversation(t)
	secondConversationID := harness.createConversation(t)
	gate := newConcurrencyAssistantInsertGate(t)

	first := asyncJSONRequest(http.MethodPost, harness.turnURL(firstConversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), "assistant-"+uuid.NewString(), "第一条对话"))
	second := asyncJSONRequest(http.MethodPost, harness.turnURL(secondConversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), "assistant-"+uuid.NewString(), "第二条对话"))
	gate.waitForWaiters(t, 2)
	gate.release(t)

	for _, result := range []asyncRequestResult{waitForAsyncRequest(t, first), waitForAsyncRequest(t, second)} {
		response := decodeConcurrencyResponse[json.RawMessage](t, result.body)
		if result.status != http.StatusOK || response.Code != 0 {
			t.Fatalf("independent conversation append status=%d response=%#v", result.status, response)
		}
	}
	for _, conversationID := range []string{firstConversationID, secondConversationID} {
		page := harness.messages(t, conversationID)
		if page.Total != 2 || len(page.Items) != 2 || page.Conversation.CurrentMessageID == "" {
			t.Fatalf("independent conversation %s = %#v", conversationID, page)
		}
	}
}

func TestStoryboardBrainstormAssistantInsertFailureRollsBackWholeTurn(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	rejectConcurrencyAssistantInserts(t)

	status, response := harness.turn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), "assistant-"+uuid.NewString(), "必须整体回滚"))
	if status != http.StatusOK || response.Code == 0 {
		t.Fatalf("forced assistant insert failure status=%d response=%#v", status, response)
	}
	page := harness.messages(t, conversationID)
	if page.Total != 0 || len(page.Items) != 0 || page.Conversation.CurrentMessageID != "" {
		t.Fatalf("assistant failure left partial turn: %#v", page)
	}
}

func TestStoryboardBrainstormStaleCompletionCannotOverwriteTerminalRevision(t *testing.T) {
	for _, terminalStatus := range []string{"cancelled", "interrupted"} {
		t.Run(terminalStatus, func(t *testing.T) {
			harness := newConcurrencyBrainstormHarness(t)
			conversationID := harness.createConversation(t)
			assistantID := "assistant-" + uuid.NewString()
			harness.mustTurn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), "user-"+uuid.NewString(), assistantID, "开始流式生成"))
			harness.mustUpdateAssistant(t, conversationID, assistantID, 1, "streaming", []any{map[string]any{"type": "text", "text": "部分结果"}})
			harness.mustUpdateAssistant(t, conversationID, assistantID, 2, terminalStatus, []any{map[string]any{"type": "text", "text": "部分结果"}})

			status, response := harness.updateAssistant(t, conversationID, assistantID, 2, "completed", []any{map[string]any{"type": "text", "text": "过期完成结果"}})
			if status != http.StatusConflict || response.Code != -1 || response.Data.Current.ID != assistantID || response.Data.Current.Status != terminalStatus || response.Data.Current.Revision != 3 {
				t.Fatalf("stale completion status=%d response=%#v", status, response)
			}
			current := concurrencyMessageByID(t, harness.messages(t, conversationID), assistantID)
			if current.Status != terminalStatus || current.Revision != 3 {
				t.Fatalf("stale completion overwrote terminal message: %#v", current)
			}
		})
	}
}

func TestStoryboardBrainstormContinueReplayDoesNotIncrementRevisionTwice(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	originalRequestID := "request-" + uuid.NewString()
	userID := "user-" + uuid.NewString()
	assistantID := "assistant-" + uuid.NewString()
	original := concurrencyAppendPayload(originalRequestID, userID, assistantID, "完成后继续")
	harness.mustTurn(t, conversationID, original)
	harness.mustUpdateAssistant(t, conversationID, assistantID, 1, "completed", []any{map[string]any{"type": "text", "text": "已完成内容"}})
	payload := map[string]any{"clientRequestId": "continue-" + uuid.NewString(), "expectedRevision": 2}

	harness.mustContinue(t, conversationID, assistantID, payload)
	first := concurrencyMessageByID(t, harness.messages(t, conversationID), assistantID)
	if first.Status != "pending" || first.Revision != 3 {
		t.Fatalf("first continue = %#v", first)
	}
	harness.mustContinue(t, conversationID, assistantID, payload)
	status, replay := harness.turn(t, conversationID, original)
	if status != http.StatusOK || replay.Code != 0 {
		t.Fatalf("original turn replay after continue status=%d response=%#v", status, replay)
	}
	status, conflict := harness.turn(t, conversationID, concurrencyAppendPayload(originalRequestID, "user-"+uuid.NewString(), "assistant-"+uuid.NewString(), "不得复用原始 key"))
	if status != http.StatusConflict || conflict.Code != -1 {
		t.Fatalf("original clientRequestId was released by continue status=%d response=%#v", status, conflict)
	}
	page := harness.messages(t, conversationID)
	replayed := concurrencyMessageByID(t, page, assistantID)
	if page.Total != 2 || len(page.Items) != 2 || page.Conversation.CurrentMessageID != assistantID || replayed.Status != "pending" || replayed.Revision != 3 {
		t.Fatalf("continued request replay changed message twice: page=%#v assistant=%#v", page, replayed)
	}
}

func TestStoryboardBrainstormConversationDeleteWaitsForActiveTurnCleanup(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	userID := "user-" + uuid.NewString()
	assistantID := "assistant-" + uuid.NewString()
	gate := newConcurrencyAssistantInsertGate(t)
	turn := asyncJSONRequest(http.MethodPost, harness.turnURL(conversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "删除前消息"))
	turnPID := gate.waitForWaiters(t, 1)[0]
	deleteURL := harness.Server.URL + "/api/v1/storyboards/" + harness.ProjectID + "/conversations/" + conversationID
	deleted := asyncJSONRequest(http.MethodDelete, deleteURL, harness.Token, nil)
	gate.waitForBlockedBy(t, turnPID)
	gate.release(t)
	if response := waitForAsyncRequest(t, turn); response.status != http.StatusOK {
		t.Fatalf("blocked turn status=%d body=%s", response.status, response.body)
	}
	if response := waitForAsyncRequest(t, deleted); response.status != http.StatusOK {
		t.Fatalf("conversation delete status=%d body=%s", response.status, response.body)
	}

	created := doJSON[concurrencyBrainstormConversationView](t, http.MethodPost, harness.Server.URL+"/api/v1/storyboards/"+harness.ProjectID+"/conversations", harness.Token, map[string]any{"id": conversationID})
	if created.Code != 0 {
		t.Fatalf("recreate conversation = %#v", created)
	}
	harness.mustTurn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "删除后重建"))
	page := harness.messages(t, conversationID)
	if page.Total != 2 || concurrencyMessageByID(t, page, userID).Content != "删除后重建" {
		t.Fatalf("conversation delete left orphan messages: %#v", page)
	}
}

func TestStoryboardBrainstormProjectDeleteWaitsForActiveTurnCleanup(t *testing.T) {
	harness := newConcurrencyBrainstormHarness(t)
	conversationID := harness.createConversation(t)
	userID := "user-" + uuid.NewString()
	assistantID := "assistant-" + uuid.NewString()
	gate := newConcurrencyAssistantInsertGate(t)
	turn := asyncJSONRequest(http.MethodPost, harness.turnURL(conversationID), harness.Token, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "删除项目前消息"))
	turnPID := gate.waitForWaiters(t, 1)[0]
	deleted := asyncJSONRequest(http.MethodDelete, harness.Server.URL+"/api/v1/storyboards/"+harness.ProjectID, harness.Token, nil)
	gate.waitForBlockedBy(t, turnPID)
	gate.release(t)
	if response := waitForAsyncRequest(t, turn); response.status != http.StatusOK {
		t.Fatalf("blocked project turn status=%d body=%s", response.status, response.body)
	}
	if response := waitForAsyncRequest(t, deleted); response.status != http.StatusOK {
		t.Fatalf("project delete status=%d body=%s", response.status, response.body)
	}

	createStoryboardBrainstormProject(t, harness.Server.URL, harness.Token, harness.ProjectID)
	created := doJSON[concurrencyBrainstormConversationView](t, http.MethodPost, harness.Server.URL+"/api/v1/storyboards/"+harness.ProjectID+"/conversations", harness.Token, map[string]any{"id": conversationID})
	if created.Code != 0 {
		t.Fatalf("recreate project conversation = %#v", created)
	}
	harness.mustTurn(t, conversationID, concurrencyAppendPayload("request-"+uuid.NewString(), userID, assistantID, "删除项目后重建"))
	page := harness.messages(t, conversationID)
	if page.Total != 2 || concurrencyMessageByID(t, page, userID).Content != "删除项目后重建" {
		t.Fatalf("project delete left orphan messages: %#v", page)
	}
}

func newConcurrencyBrainstormHarness(t *testing.T) concurrencyBrainstormHarness {
	t.Helper()
	setupStudioPersistence(t)
	server, owner, _ := studioPersistenceServer(t)
	t.Cleanup(server.Close)
	projectID := "storyboard-" + uuid.NewString()
	created := doJSON[storyboardDetailView](t, http.MethodPost, server.URL+"/api/v1/storyboards", owner.Data.Token, map[string]any{
		"id": projectID, "title": "并发分镜", "source": "雨夜开场", "options": map[string]any{"aspectRatio": "9:16"}, "model": "test-model", "sourceHash": uuid.NewString(),
	})
	if created.Code != 0 || created.Data.ID != projectID {
		t.Fatalf("create storyboard for brainstorm concurrency: %#v", created)
	}
	return concurrencyBrainstormHarness{Server: server, Token: owner.Data.Token, ProjectID: projectID}
}

func (h concurrencyBrainstormHarness) createConversation(t *testing.T) string {
	t.Helper()
	conversationID := "conversation-" + uuid.NewString()
	response := doJSON[concurrencyBrainstormConversationView](t, http.MethodPost, h.Server.URL+"/api/v1/storyboards/"+h.ProjectID+"/conversations", h.Token, map[string]any{"id": conversationID})
	if response.Code != 0 || response.Data.ID != conversationID || response.Data.CurrentMessageID != "" {
		t.Fatalf("create brainstorm conversation = %#v", response)
	}
	return conversationID
}

func (h concurrencyBrainstormHarness) turnURL(conversationID string) string {
	return h.Server.URL + "/api/v1/storyboards/" + h.ProjectID + "/conversations/" + conversationID + "/turns"
}

func (h concurrencyBrainstormHarness) turn(t *testing.T, conversationID string, payload any) (int, apiResponse[json.RawMessage]) {
	t.Helper()
	status, body := doRawRequest(t, http.MethodPost, h.turnURL(conversationID), h.Token, "application/json", bytes.NewReader(mustJSON(t, payload)))
	return status, decodeConcurrencyResponse[json.RawMessage](t, body)
}

func (h concurrencyBrainstormHarness) mustTurn(t *testing.T, conversationID string, payload any) {
	t.Helper()
	status, response := h.turn(t, conversationID, payload)
	if status != http.StatusOK || response.Code != 0 {
		t.Fatalf("append brainstorm turn status=%d response=%#v", status, response)
	}
}

func (h concurrencyBrainstormHarness) updateAssistant(t *testing.T, conversationID, assistantID string, expectedRevision uint64, status string, output []any) (int, apiResponse[persistenceConflictView[concurrencyBrainstormMessageView]]) {
	t.Helper()
	payload := map[string]any{"expectedRevision": expectedRevision, "status": status, "output": output}
	endpoint := h.Server.URL + "/api/v1/storyboards/" + h.ProjectID + "/conversations/" + conversationID + "/messages/" + assistantID + "/assistant"
	httpStatus, body := doRawRequest(t, http.MethodPut, endpoint, h.Token, "application/json", bytes.NewReader(mustJSON(t, payload)))
	return httpStatus, decodeConcurrencyResponse[persistenceConflictView[concurrencyBrainstormMessageView]](t, body)
}

func (h concurrencyBrainstormHarness) mustUpdateAssistant(t *testing.T, conversationID, assistantID string, expectedRevision uint64, status string, output []any) {
	t.Helper()
	httpStatus, response := h.updateAssistant(t, conversationID, assistantID, expectedRevision, status, output)
	if httpStatus != http.StatusOK || response.Code != 0 {
		t.Fatalf("update assistant status=%d response=%#v", httpStatus, response)
	}
}

func (h concurrencyBrainstormHarness) mustContinue(t *testing.T, conversationID, assistantID string, payload any) {
	t.Helper()
	endpoint := h.Server.URL + "/api/v1/storyboards/" + h.ProjectID + "/conversations/" + conversationID + "/messages/" + assistantID + "/continue"
	status, body := doRawRequest(t, http.MethodPost, endpoint, h.Token, "application/json", bytes.NewReader(mustJSON(t, payload)))
	response := decodeConcurrencyResponse[json.RawMessage](t, body)
	if status != http.StatusOK || response.Code != 0 {
		t.Fatalf("continue assistant status=%d response=%#v", status, response)
	}
}

func (h concurrencyBrainstormHarness) messages(t *testing.T, conversationID string) concurrencyBrainstormMessagesPage {
	t.Helper()
	response := doJSON[concurrencyBrainstormMessagesPage](t, http.MethodGet, h.Server.URL+"/api/v1/storyboards/"+h.ProjectID+"/conversations/"+conversationID+"/messages?page=1&pageSize=100", h.Token, nil)
	if response.Code != 0 {
		t.Fatalf("list brainstorm messages = %#v", response)
	}
	return response.Data
}

func concurrencyAppendPayload(requestID, userMessageID, assistantMessageID, content string) map[string]any {
	return map[string]any{
		"mode": "append", "clientRequestId": requestID, "userMessage": map[string]any{"id": userMessageID, "content": content}, "assistantMessageId": assistantMessageID,
	}
}

func concurrencyMessageByID(t *testing.T, page concurrencyBrainstormMessagesPage, id string) concurrencyBrainstormMessageView {
	t.Helper()
	for _, message := range page.Items {
		if message.ID == id {
			return message
		}
	}
	t.Fatalf("message %s not found in %#v", id, page)
	return concurrencyBrainstormMessageView{}
}

func decodeConcurrencyResponse[T any](t *testing.T, body []byte) apiResponse[T] {
	t.Helper()
	var response apiResponse[T]
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode response: %v: %s", err, body)
	}
	return response
}

type concurrencyAssistantInsertGate struct {
	pool     *sql.DB
	conn     *sql.Conn
	key1     int32
	key2     int32
	function string
	trigger  string
	released bool
}

func newConcurrencyAssistantInsertGate(t *testing.T) *concurrencyAssistantInsertGate {
	t.Helper()
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatalf("get sql database: %v", err)
	}
	conn, err := pool.Conn(context.Background())
	if err != nil {
		t.Fatalf("reserve advisory lock connection: %v", err)
	}
	seed := uuid.New()
	key1 := int32(binary.BigEndian.Uint32(seed[0:4]) & 0x7fffffff)
	key2 := int32(binary.BigEndian.Uint32(seed[4:8]) & 0x7fffffff)
	if key1 == 0 {
		key1 = 1
	}
	if key2 == 0 {
		key2 = 1
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	gate := &concurrencyAssistantInsertGate{pool: pool, conn: conn, key1: key1, key2: key2, function: "bs_gate_fn_" + suffix, trigger: "bs_gate_tr_" + suffix}
	if err := db.Exec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger AS $$ BEGIN IF NEW.role = 'assistant' THEN PERFORM pg_advisory_xact_lock(%d, %d); END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`, gate.function, key1, key2)).Error; err != nil {
		_ = conn.Close()
		t.Fatalf("create assistant insert gate function: %v", err)
	}
	if err := db.Exec(fmt.Sprintf(`CREATE TRIGGER %s BEFORE INSERT ON storyboard_brainstorm_messages FOR EACH ROW EXECUTE FUNCTION %s()`, gate.trigger, gate.function)).Error; err != nil {
		_ = db.Exec("DROP FUNCTION IF EXISTS " + gate.function + "()").Error
		_ = conn.Close()
		t.Fatalf("create assistant insert gate trigger: %v", err)
	}
	if _, err := conn.ExecContext(context.Background(), `SELECT pg_advisory_lock($1, $2)`, key1, key2); err != nil {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + gate.trigger + " ON storyboard_brainstorm_messages").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + gate.function + "()").Error
		_ = conn.Close()
		t.Fatalf("acquire assistant insert gate: %v", err)
	}
	t.Cleanup(gate.close)
	return gate
}

func (gate *concurrencyAssistantInsertGate) waitForWaiters(t *testing.T, want int) []int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var pids []int
	for time.Now().Before(deadline) {
		rows, err := gate.pool.QueryContext(context.Background(), `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = CAST($1 AS oid) AND objid = CAST($2 AS oid) AND NOT granted ORDER BY pid`, gate.key1, gate.key2)
		if err != nil {
			t.Fatalf("query assistant insert gate waiters: %v", err)
		}
		pids = pids[:0]
		for rows.Next() {
			var pid int
			if err := rows.Scan(&pid); err != nil {
				_ = rows.Close()
				t.Fatalf("scan assistant insert gate waiter: %v", err)
			}
			pids = append(pids, pid)
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("close assistant insert gate waiter rows: %v", err)
		}
		if len(pids) >= want {
			return append([]int(nil), pids...)
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("assistant insert gate waiters=%v, want %d", pids, want)
	return nil
}

func (gate *concurrencyAssistantInsertGate) waitForBlockedBy(t *testing.T, blockerPID int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var blocked int
	for time.Now().Before(deadline) {
		if err := gate.pool.QueryRowContext(context.Background(), `SELECT count(*) FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, blockerPID).Scan(&blocked); err != nil {
			t.Fatalf("query blocked brainstorm append: %v", err)
		}
		if blocked > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("no brainstorm append blocked by backend %d", blockerPID)
}

func (gate *concurrencyAssistantInsertGate) release(t *testing.T) {
	t.Helper()
	if gate.released {
		return
	}
	if _, err := gate.conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1, $2)`, gate.key1, gate.key2); err != nil {
		t.Fatalf("release assistant insert gate: %v", err)
	}
	gate.released = true
}

func (gate *concurrencyAssistantInsertGate) close() {
	if !gate.released {
		_, _ = gate.conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1, $2)`, gate.key1, gate.key2)
	}
	db, err := repository.DB()
	if err == nil {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + gate.trigger + " ON storyboard_brainstorm_messages").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + gate.function + "()").Error
	}
	_ = gate.conn.Close()
}

func rejectConcurrencyAssistantInserts(t *testing.T) {
	t.Helper()
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	functionName := "bs_fail_fn_" + suffix
	triggerName := "bs_fail_tr_" + suffix
	if err := db.Exec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced assistant insert failure'; END; $$ LANGUAGE plpgsql`, functionName)).Error; err != nil {
		t.Fatalf("create assistant rejection function: %v", err)
	}
	if err := db.Exec(fmt.Sprintf(`CREATE TRIGGER %s BEFORE INSERT ON storyboard_brainstorm_messages FOR EACH ROW WHEN (NEW.role = 'assistant') EXECUTE FUNCTION %s()`, triggerName, functionName)).Error; err != nil {
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
		t.Fatalf("create assistant rejection trigger: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Exec("DROP TRIGGER IF EXISTS " + triggerName + " ON storyboard_brainstorm_messages").Error
		_ = db.Exec("DROP FUNCTION IF EXISTS " + functionName + "()").Error
	})
}
