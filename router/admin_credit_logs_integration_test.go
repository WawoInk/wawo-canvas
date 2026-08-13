package router_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type adminCreditLogHTTPItem struct {
	model.CreditLog
	Username string `json:"username"`
}

type adminCreditLogHTTPList struct {
	Items []adminCreditLogHTTPItem `json:"items"`
	Total int                      `json:"total"`
}

func TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "admin-credit-log-contract-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	adminUsername := "admin-credit-log-contract-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: adminUsername, Role: model.UserRoleAdmin}, "admin-password"); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()

	admin := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/admin/login", "", map[string]string{
		"username": adminUsername,
		"password": "admin-password",
	})
	if admin.Code != 0 || admin.Data.Token == "" {
		t.Fatalf("admin login = %#v", admin)
	}

	targetUsername := "admin-credit-log-user-" + uuid.NewString()
	target := doJSON[model.User](t, http.MethodPost, server.URL+"/api/admin/users", admin.Data.Token, map[string]string{
		"username": targetUsername,
		"password": "user-password",
	})
	if target.Code != 0 || target.Data.ID == "" {
		t.Fatalf("create target user = %#v", target)
	}

	atStartID := "admin-credit-at-start-" + uuid.NewString()
	atEndID := "admin-credit-at-end-" + uuid.NewString()
	fixtures := []model.CreditLog{
		{
			ID: "admin-credit-before-" + uuid.NewString(), UserID: target.Data.ID,
			Type: model.CreditLogTypeAdminAdjust, Amount: credit(1),
			Balance: credit(1), CreatedAt: "2026-07-01T23:59:59.999+08:00",
		},
		{
			ID: atStartID, UserID: target.Data.ID,
			Type: model.CreditLogTypeAdminAdjust, Amount: credit(1),
			Balance: credit(2), CreatedAt: "2026-07-02T00:00:00+08:00",
		},
		{
			ID: atEndID, UserID: target.Data.ID,
			Type: model.CreditLogTypeAdminAdjust, Amount: credit(1),
			Balance: credit(3), CreatedAt: "2026-07-02T23:59:59.999+08:00",
		},
		{
			ID: "admin-credit-after-" + uuid.NewString(), UserID: target.Data.ID,
			Type: model.CreditLogTypeAdminAdjust, Amount: credit(1),
			Balance: credit(4), CreatedAt: "2026-07-03T00:00:00+08:00",
		},
	}
	for _, fixture := range fixtures {
		created := doJSON[model.CreditLog](t, http.MethodPost, server.URL+"/api/admin/credit-logs", admin.Data.Token, fixture)
		if created.Code != 0 {
			t.Fatalf("create credit log = %#v", created)
		}
	}

	logs := doJSON[adminCreditLogHTTPList](t, http.MethodGet, server.URL+"/api/admin/credit-logs?keyword="+target.Data.ID+"&start_time=2026-07-01T16:00:00.000Z&end_time=2026-07-02T15:59:59.999Z&page=1&pageSize=20", admin.Data.Token, nil)
	if logs.Code != 0 || logs.Data.Total != 2 || len(logs.Data.Items) != 2 {
		t.Fatalf("date filtered admin credit logs = %#v", logs)
	}

	expected := map[string]bool{atStartID: true, atEndID: true}
	for _, item := range logs.Data.Items {
		if !expected[item.ID] {
			t.Fatalf("out-of-range credit log returned = %#v", item)
		}
		if item.Username != targetUsername {
			t.Fatalf("credit log username = %q, want %q", item.Username, targetUsername)
		}
		delete(expected, item.ID)
	}
	if len(expected) != 0 {
		t.Fatalf("inclusive boundary logs missing = %#v", expected)
	}
}
