package router_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type externalAdminCredit struct {
	RequestID    string        `json:"requestId"`
	UserID       string        `json:"userId"`
	EnterpriseID string        `json:"enterpriseId"`
	Delta        model.Decimal `json:"delta"`
	Balance      model.Decimal `json:"balance"`
	Reason       string        `json:"reason"`
	CreatedAt    string        `json:"createdAt"`
}

func externalAdminServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	previousSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "external-admin-http-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousSecret })
	previousKey, err := repository.GetAdminKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var err error
		if previousKey.Hash == "" {
			err = repository.DeleteAdminKey()
		} else {
			err = repository.SaveAdminKey(previousKey)
		}
		if err != nil {
			t.Errorf("restore admin key: %v", err)
		}
	})
	username := "external-admin-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(router.New())
	t.Cleanup(server.Close)
	login := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{"username": username, "password": "admin-password"})
	if login.Code != 0 || login.Data.Token == "" {
		t.Fatalf("admin login = %#v", login)
	}
	generated := doJSON[struct {
		Key string `json:"key"`
	}](t, http.MethodPost, server.URL+"/api/admin/settings/admin-key", login.Data.Token, nil)
	if generated.Code != 0 || generated.Data.Key == "" {
		t.Fatalf("generate admin key = %#v", generated)
	}
	return server, generated.Data.Key, login.Data.Token
}

func externalAdminRequest(method, url, key string, payload any) (int, []byte, error) {
	var encoded []byte
	if payload != nil {
		var err error
		encoded, err = json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(encoded))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("X-Admin-Key", key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	return response.StatusCode, body, err
}

func externalAdminJSON[T any](t *testing.T, method, url, key string, payload any, wantStatus int) apiResponse[T] {
	t.Helper()
	status, raw, err := externalAdminRequest(method, url, key, payload)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	var response apiResponse[T]
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("%s %s: decode %s: %v", method, url, raw, err)
	}
	if status != wantStatus || (status == http.StatusOK && response.Code != 0) || (status != http.StatusOK && response.Code == 0) {
		t.Fatalf("%s %s = HTTP %d %s; want HTTP %d", method, url, status, raw, wantStatus)
	}
	return response
}

func TestAdminExternalRoutesRequireAdminKeyThroughHTTP(t *testing.T) {
	server, key, token := externalAdminServer(t)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/users"}, {http.MethodPost, "/users"},
		{http.MethodGet, "/users/missing"}, {http.MethodPut, "/users/missing"},
		{http.MethodDelete, "/users/missing"}, {http.MethodPost, "/users/missing/credits"},
		{http.MethodGet, "/enterprises"}, {http.MethodPost, "/enterprises"},
		{http.MethodGet, "/enterprises/missing"}, {http.MethodPut, "/enterprises/missing"},
		{http.MethodDelete, "/enterprises/missing"}, {http.MethodPost, "/enterprises/missing/credits"},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			externalAdminJSON[any](t, route.method, server.URL+"/api/v1/admin"+route.path, "", nil, http.StatusUnauthorized)
			externalAdminJSON[any](t, route.method, server.URL+"/api/v1/admin"+route.path, key+"invalid", nil, http.StatusUnauthorized)
		})
	}
	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/admin/users", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("JWT substituted for Admin Key: HTTP %d", response.StatusCode)
	}
}

func TestAdminExternalUserCRUDThroughHTTP(t *testing.T) {
	server, key, _ := externalAdminServer(t)
	base := server.URL + "/api/v1/admin/users"
	username := "external-user-" + uuid.NewString()
	created := externalAdminJSON[model.User](t, http.MethodPost, base, key, map[string]string{
		"username": username, "password": "user-password", "email": "external@example.com", "displayName": "外部用户",
	}, http.StatusOK).Data
	if created.ID == "" || created.Username != username || created.Role != model.UserRoleUser || created.Status != model.UserStatusActive || !created.Credits.IsZero() || created.Password != "" {
		t.Fatalf("created user = %#v", created)
	}
	detailURL := base + "/" + created.ID
	detail := externalAdminJSON[map[string]any](t, http.MethodGet, detailURL, key, nil, http.StatusOK).Data
	for _, field := range []string{"password", "sessionVersion", "extra", "linuxDoId", "githubId", "wechatId"} {
		if _, leaked := detail[field]; leaked {
			t.Fatalf("external user exposes %s: %#v", field, detail)
		}
	}
	listed := externalAdminJSON[model.UserList](t, http.MethodGet, base+"?keyword="+username+"&page=1&pageSize=1", key, nil, http.StatusOK).Data
	if listed.Total != 1 || len(listed.Items) != 1 || listed.Items[0].ID != created.ID {
		t.Fatalf("user list = %#v", listed)
	}
	updated := externalAdminJSON[model.User](t, http.MethodPut, detailURL, key, map[string]string{"displayName": "更新用户"}, http.StatusOK).Data
	if updated.DisplayName != "更新用户" || updated.Username != username || updated.Email != created.Email || updated.Role != created.Role || updated.Status != created.Status {
		t.Fatalf("partial user update discarded values = %#v", updated)
	}
	externalAdminJSON[model.User](t, http.MethodPut, detailURL, key, map[string]string{"password": "changed-password"}, http.StatusOK)
	oldLogin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "user-password"})
	newLogin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": username, "password": "changed-password"})
	if oldLogin.Code == 0 || newLogin.Code != 0 {
		t.Fatalf("password update: old=%#v new=%#v", oldLogin, newLogin)
	}
	externalAdminJSON[bool](t, http.MethodDelete, detailURL, key, nil, http.StatusOK)
	externalAdminJSON[any](t, http.MethodGet, detailURL, key, nil, http.StatusNotFound)
	if deleted, found, err := repository.GetUserByID(created.ID); err != nil || found {
		t.Fatalf("deleted user remains: %#v, found=%v, err=%v", deleted, found, err)
	}
}

func TestAdminExternalEnterpriseCRUDAndDeletionThroughHTTP(t *testing.T) {
	server, key, _ := externalAdminServer(t)
	base := server.URL + "/api/v1/admin"
	ownerUsername := "external-owner-" + uuid.NewString()
	enterprise := externalAdminJSON[model.EnterpriseView](t, http.MethodPost, base+"/enterprises", key, map[string]string{
		"name": "外部企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-password",
	}, http.StatusOK).Data
	externalAdminJSON[any](t, http.MethodPost, base+"/enterprises", key, map[string]string{
		"name": "重复主账号企业", "ownerUsername": ownerUsername, "ownerPassword": "owner-password",
	}, http.StatusConflict)
	if enterprise.ID == "" || enterprise.OwnerID == "" || enterprise.Status != model.EnterpriseStatusActive || !enterprise.OwnerCredits.IsZero() {
		t.Fatalf("created enterprise = %#v", enterprise)
	}
	enterpriseURL := base + "/enterprises/" + enterprise.ID
	listed := externalAdminJSON[model.EnterpriseList](t, http.MethodGet, base+"/enterprises?keyword="+ownerUsername, key, nil, http.StatusOK).Data
	if listed.Total != 1 || len(listed.Items) != 1 || listed.Items[0].ID != enterprise.ID {
		t.Fatalf("enterprise list = %#v", listed)
	}
	updated := externalAdminJSON[model.EnterpriseView](t, http.MethodPut, enterpriseURL, key, map[string]string{"name": "已更新企业", "discountRate": "0.8", "status": "disabled"}, http.StatusOK).Data
	if updated.Name != "已更新企业" || !updated.DiscountRate.Equal(fractionalCredit("0.8")) || updated.OwnerID != enterprise.OwnerID || updated.Status != model.EnterpriseStatusDisabled {
		t.Fatalf("partial enterprise update = %#v", updated)
	}
	externalAdminJSON[model.EnterpriseView](t, http.MethodPut, enterpriseURL, key, map[string]string{"status": "active"}, http.StatusOK)
	memberUsername := "external-member-" + uuid.NewString()
	member := externalAdminJSON[model.User](t, http.MethodPost, base+"/users", key, map[string]string{
		"username": memberUsername, "password": "member-password", "enterpriseId": enterprise.ID,
	}, http.StatusOK).Data
	if member.EnterpriseID == nil || *member.EnterpriseID != enterprise.ID || member.EnterpriseRole == nil || *member.EnterpriseRole != model.EnterpriseRoleMember || member.Role != model.UserRoleUser {
		t.Fatalf("created member = %#v", member)
	}
	ownerSession := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	memberSession := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})
	if ownerSession.Code != 0 || memberSession.Code != 0 {
		t.Fatalf("enterprise logins = %#v, %#v", ownerSession, memberSession)
	}
	for _, operation := range []struct{ path, delta string }{
		{enterpriseURL, "20.5"}, {base + "/users/" + member.ID, "7.25"},
	} {
		payload := map[string]string{
			"delta": operation.delta, "reason": "企业删除前余额", "requestId": uuid.NewString(),
		}
		receipt := externalAdminJSON[externalAdminCredit](t, http.MethodPost, operation.path+"/credits", key, payload, http.StatusOK).Data
		if operation.path == enterpriseURL {
			if receipt.EnterpriseID != enterprise.ID || receipt.UserID != enterprise.OwnerID {
				t.Fatalf("enterprise adjustment scope = %#v", receipt)
			}
			externalAdminJSON[any](t, http.MethodPost, base+"/users/"+enterprise.OwnerID+"/credits", key, payload, http.StatusConflict)
		} else if receipt.UserID != member.ID {
			t.Fatalf("member adjustment scope = %#v", receipt)
		}
	}
	detail := externalAdminJSON[model.EnterpriseView](t, http.MethodGet, enterpriseURL, key, nil, http.StatusOK).Data
	if detail.MemberCount != 1 || !detail.OwnerCredits.Equal(fractionalCredit("20.5")) {
		t.Fatalf("enterprise detail = %#v", detail)
	}
	externalAdminJSON[any](t, http.MethodDelete, base+"/users/"+enterprise.OwnerID, key, nil, http.StatusConflict)
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	asset := model.Asset{ID: "external-shared-" + uuid.NewString(), UserID: member.ID, EnterpriseID: &enterprise.ID, Type: model.AssetTypeText, Title: "共享内容"}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Delete(&asset) })
	externalAdminJSON[any](t, http.MethodDelete, enterpriseURL, key, nil, http.StatusConflict)
	externalAdminJSON[any](t, http.MethodDelete, base+"/users/"+member.ID, key, nil, http.StatusConflict)
	if err := db.Delete(&asset).Error; err != nil {
		t.Fatal(err)
	}
	file := model.UserFile{ID: "external-shared-file-" + uuid.NewString(), UserID: member.ID, EnterpriseID: &enterprise.ID, FileType: "images", S3Key: "external-test/shared.png"}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Delete(&file) })
	externalAdminJSON[any](t, http.MethodDelete, enterpriseURL, key, nil, http.StatusConflict)
	if err := db.Delete(&file).Error; err != nil {
		t.Fatal(err)
	}
	externalAdminJSON[bool](t, http.MethodDelete, enterpriseURL, key, nil, http.StatusOK)
	externalAdminJSON[any](t, http.MethodGet, enterpriseURL, key, nil, http.StatusNotFound)
	for _, retained := range []struct{ id, balance string }{{enterprise.OwnerID, "20.5"}, {member.ID, "7.25"}} {
		user := externalAdminJSON[model.User](t, http.MethodGet, base+"/users/"+retained.id, key, nil, http.StatusOK).Data
		if user.EnterpriseID != nil || user.EnterpriseRole != nil || !user.Credits.Equal(fractionalCredit(retained.balance)) {
			t.Fatalf("enterprise deletion changed retained user: %#v", user)
		}
	}
	assertRejectedSession(t, server.URL, ownerSession.Data.Token)
	assertRejectedSession(t, server.URL, memberSession.Data.Token)
}

func TestAdminExternalCreditsAreAtomicAndIdempotentThroughHTTP(t *testing.T) {
	server, key, token := externalAdminServer(t)
	base := server.URL + "/api/v1/admin/users"
	user := externalAdminJSON[model.User](t, http.MethodPost, base, key, map[string]string{
		"username": "external-credit-user-" + uuid.NewString(), "password": "credit-password",
	}, http.StatusOK).Data
	creditURL := base + "/" + user.ID + "/credits"
	requestID := "external-credit-" + uuid.NewString()
	payload := map[string]string{"delta": "100.25", "reason": "外部充值", "requestId": requestID}
	first := externalAdminJSON[externalAdminCredit](t, http.MethodPost, creditURL, key, payload, http.StatusOK).Data
	if first.RequestID != requestID || first.UserID != user.ID || !first.Delta.Equal(fractionalCredit("100.25")) || !first.Balance.Equal(fractionalCredit("100.25")) || first.Reason != payload["reason"] || first.CreatedAt == "" {
		t.Fatalf("credit receipt = %#v", first)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	var ledger model.CreditLog
	if err := db.Where("request_id = ?", requestID).First(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	ledger.Amount = credit(999)
	ledger.Balance = credit(999)
	saved := doJSON[model.CreditLog](t, http.MethodPost, server.URL+"/api/admin/credit-logs", token, ledger)
	deleted := doJSON[bool](t, http.MethodDelete, server.URL+"/api/admin/credit-logs/"+ledger.ID, token, nil)
	if saved.Code == 0 || deleted.Code == 0 {
		t.Fatalf("legacy admin endpoints mutated idempotency ledger: save=%#v delete=%#v", saved, deleted)
	}
	externalAdminJSON[externalAdminCredit](t, http.MethodPost, creditURL, key, map[string]string{"delta": "-0.25", "reason": "外部扣除", "requestId": uuid.NewString()}, http.StatusOK)
	replay := externalAdminJSON[externalAdminCredit](t, http.MethodPost, creditURL, key, payload, http.StatusOK).Data
	if !replay.Balance.Equal(first.Balance) || replay.CreatedAt != first.CreatedAt {
		t.Fatalf("replay did not return original receipt: first=%#v replay=%#v", first, replay)
	}
	for _, change := range []map[string]string{
		{"delta": "100", "reason": payload["reason"], "requestId": requestID},
		{"delta": payload["delta"], "reason": "不同原因", "requestId": requestID},
	} {
		externalAdminJSON[any](t, http.MethodPost, creditURL, key, change, http.StatusConflict)
	}
	other := externalAdminJSON[model.User](t, http.MethodPost, base, key, map[string]string{
		"username": "external-credit-other-" + uuid.NewString(), "password": "credit-password",
	}, http.StatusOK).Data
	externalAdminJSON[any](t, http.MethodPost, base+"/"+other.ID+"/credits", key, payload, http.StatusConflict)
	externalAdminJSON[any](t, http.MethodPost, creditURL, key, map[string]string{"delta": "-100.01", "reason": "不可负余额", "requestId": uuid.NewString()}, http.StatusBadRequest)
	const concurrent = 8
	var group sync.WaitGroup
	errors := make(chan error, concurrent*2)
	concurrentPayload := map[string]string{"delta": "0.125", "reason": "并发幂等", "requestId": uuid.NewString()}
	for range concurrent {
		group.Add(2)
		go func() {
			defer group.Done()
			status, body, err := externalAdminRequest(http.MethodPost, creditURL, key, concurrentPayload)
			if err != nil {
				errors <- err
			} else if status != http.StatusOK {
				errors <- fmt.Errorf("concurrent replay HTTP %d: %s", status, body)
			} else {
				var receipt apiResponse[externalAdminCredit]
				if err := json.Unmarshal(body, &receipt); err != nil || receipt.Code != 0 || !receipt.Data.Balance.Equal(fractionalCredit("100.125")) {
					errors <- fmt.Errorf("concurrent receipt = %s, err=%v", body, err)
				}
			}
		}()
		go func() {
			defer group.Done()
			status, body, err := externalAdminRequest(http.MethodPut, base+"/"+user.ID, key, map[string]string{"displayName": "并发更新"})
			if err != nil {
				errors <- err
			} else if status != http.StatusOK {
				errors <- fmt.Errorf("concurrent profile update HTTP %d: %s", status, body)
			}
		}()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	final := externalAdminJSON[model.User](t, http.MethodGet, base+"/"+user.ID, key, nil, http.StatusOK).Data
	if !final.Credits.Equal(fractionalCredit("100.125")) || final.DisplayName != "并发更新" {
		t.Fatalf("concurrent adjustment/profile update = %#v", final)
	}
	var logs []model.CreditLog
	if err := db.Where("user_id = ?", user.ID).Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 3 {
		t.Fatalf("want exactly 3 credit ledger entries, got %#v", logs)
	}
	statuses := make(chan int, concurrent)
	errors = make(chan error, concurrent)
	for range concurrent {
		group.Add(1)
		go func() {
			defer group.Done()
			status, body, err := externalAdminRequest(http.MethodPost, creditURL, key, map[string]string{
				"delta": "-20", "reason": "并发扣除", "requestId": uuid.NewString(),
			})
			if err != nil {
				errors <- err
			} else if status != http.StatusOK && status != http.StatusBadRequest {
				errors <- fmt.Errorf("concurrent deduction HTTP %d: %s", status, body)
			}
			statuses <- status
		}()
	}
	group.Wait()
	close(statuses)
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	succeeded := 0
	for status := range statuses {
		if status == http.StatusOK {
			succeeded++
		}
	}
	final = externalAdminJSON[model.User](t, http.MethodGet, base+"/"+user.ID, key, nil, http.StatusOK).Data
	if succeeded != 5 || !final.Credits.Equal(fractionalCredit("0.125")) {
		t.Fatalf("concurrent deductions: succeeded=%d, balance=%s", succeeded, final.Credits)
	}
}

func TestAdminExternalRejectsInvalidWritesAndMissingTargetsThroughHTTP(t *testing.T) {
	server, key, _ := externalAdminServer(t)
	base := server.URL + "/api/v1/admin"
	user := externalAdminJSON[model.User](t, http.MethodPost, base+"/users", key, map[string]string{
		"username": "external-validation-" + uuid.NewString(), "password": "validation-password",
	}, http.StatusOK).Data
	for _, payload := range []any{
		map[string]string{"username": "", "password": "password"},
		map[string]string{"username": "invalid role", "password": "password"},
		map[string]string{"username": uuid.NewString(), "password": "password", "role": "root"},
		map[string]string{"username": uuid.NewString(), "password": "password", "status": "deleted"},
		map[string]string{"username": uuid.NewString(), "password": "password", "enterpriseId": "missing", "role": "admin"},
		map[string]string{"username": uuid.NewString(), "password": "password", "credits": "100"},
		map[string]string{"username": uuid.NewString(), "password": "password", "email": "invalid-email"},
	} {
		externalAdminJSON[any](t, http.MethodPost, base+"/users", key, payload, http.StatusBadRequest)
	}
	for _, payload := range []any{
		map[string]any{}, map[string]string{"credits": "9"}, map[string]string{"enterpriseId": "missing"},
		map[string]string{"id": user.ID}, map[string]string{"role": "root"}, map[string]string{"status": "deleted"},
	} {
		externalAdminJSON[any](t, http.MethodPut, base+"/users/"+user.ID, key, payload, http.StatusBadRequest)
	}
	for _, raw := range []string{`{"displayName":`, `{"displayName":"first"} {"displayName":"second"}`} {
		request, err := http.NewRequest(http.MethodPut, base+"/users/"+user.ID, bytes.NewBufferString(raw))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Admin-Key", key)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("malformed/multiple JSON accepted: %s, HTTP %d", raw, response.StatusCode)
		}
	}
	enterprise := externalAdminJSON[model.EnterpriseView](t, http.MethodPost, base+"/enterprises", key, map[string]string{
		"name": "外部校验企业", "ownerUsername": "external-invalid-owner-" + uuid.NewString(), "ownerPassword": "owner-password",
	}, http.StatusOK).Data
	for _, payload := range []any{
		map[string]any{}, map[string]string{"name": ""}, map[string]string{"status": "deleted"},
		map[string]string{"discountRate": "0.09"}, map[string]string{"ownerId": user.ID},
	} {
		externalAdminJSON[any](t, http.MethodPut, base+"/enterprises/"+enterprise.ID, key, payload, http.StatusBadRequest)
	}
	for _, payload := range []any{
		map[string]string{"delta": "0", "reason": "zero", "requestId": uuid.NewString()},
		map[string]string{"delta": "NaN", "reason": "bad", "requestId": uuid.NewString()},
		map[string]string{"delta": "1", "reason": "", "requestId": uuid.NewString()},
		map[string]string{"delta": "1", "reason": "missing request id"},
	} {
		externalAdminJSON[any](t, http.MethodPost, base+"/users/"+user.ID+"/credits", key, payload, http.StatusBadRequest)
	}
	for _, resource := range []string{"users", "enterprises"} {
		missingURL := base + "/" + resource + "/missing-" + uuid.NewString()
		externalAdminJSON[any](t, http.MethodGet, missingURL, key, nil, http.StatusNotFound)
		payload := map[string]string{"name": "不可新增"}
		if resource == "users" {
			payload = map[string]string{"displayName": "不可新增"}
		}
		externalAdminJSON[any](t, http.MethodPut, missingURL, key, payload, http.StatusNotFound)
		externalAdminJSON[any](t, http.MethodPost, missingURL+"/credits", key, map[string]string{"delta": "1", "reason": "missing target", "requestId": uuid.NewString()}, http.StatusNotFound)
		externalAdminJSON[any](t, http.MethodDelete, missingURL, key, nil, http.StatusNotFound)
	}
}
