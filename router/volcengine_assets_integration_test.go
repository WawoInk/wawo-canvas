package router_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type volcAssetConfigHTTP struct {
	Config string `json:"config"`
}

type volcAssetOutboundHTTP struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Format string `json:"format"`
}

type volcAssetTestGroup struct {
	ID          string
	Name        string
	ProjectName string
	GroupType   string
}

type volcAssetTestItem struct {
	ID          string
	GroupID     string
	ProjectName string
	Name        string
}

type volcAssetTestCall struct {
	Action        string
	Body          map[string]any
	Authorization string
}

type volcAssetTestUpstream struct {
	mu     sync.Mutex
	groups map[string]volcAssetTestGroup
	assets map[string]volcAssetTestItem
	calls  []volcAssetTestCall
	nextID int
}

func newVolcAssetTestUpstream() *volcAssetTestUpstream {
	return &volcAssetTestUpstream{groups: map[string]volcAssetTestGroup{}, assets: map[string]volcAssetTestItem{}}
}

func (upstream *volcAssetTestUpstream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	action := strings.Trim(r.URL.Path, "/")
	upstream.mu.Lock()
	defer upstream.mu.Unlock()
	upstream.calls = append(upstream.calls, volcAssetTestCall{Action: action, Body: body, Authorization: r.Header.Get("Authorization")})
	upstream.writeAction(w, action, body)
}

func (upstream *volcAssetTestUpstream) writeAction(w http.ResponseWriter, action string, body map[string]any) {
	write := func(value any) { _ = json.NewEncoder(w).Encode(value) }
	switch action {
	case "ListAssetGroups":
		name := volcAssetString(volcAssetObject(body, "Filter"), "Name")
		items := make([]map[string]any, 0)
		for _, group := range upstream.groups {
			if name == "" || group.Name == name {
				items = append(items, map[string]any{"Id": group.ID, "Name": group.Name, "ProjectName": group.ProjectName, "GroupType": group.GroupType})
			}
		}
		write(map[string]any{"Items": items, "TotalCount": len(items), "PageNumber": 1, "PageSize": 50})
	case "CreateAssetGroup":
		upstream.nextID++
		group := volcAssetTestGroup{
			ID:          fmt.Sprintf("group-%d", upstream.nextID),
			Name:        volcAssetString(body, "Name"),
			ProjectName: volcAssetString(body, "ProjectName"),
			GroupType:   volcAssetString(body, "GroupType"),
		}
		upstream.groups[group.Name] = group
		write(map[string]any{"Id": group.ID, "Name": group.Name, "GroupId": group.ID})
	case "ListAssets":
		groupID := volcAssetFirstString(volcAssetObject(body, "Filter"), "GroupIds")
		items := make([]map[string]any, 0)
		for _, item := range upstream.assets {
			if item.GroupID == groupID {
				items = append(items, map[string]any{"Id": item.ID, "GroupId": item.GroupID, "ProjectName": item.ProjectName, "Name": item.Name, "AssetType": "Image", "URL": "https://example.test/asset.png"})
			}
		}
		write(map[string]any{"Items": items, "TotalCount": len(items), "PageNumber": 1, "PageSize": 20})
	case "CreateAsset":
		upstream.nextID++
		item := volcAssetTestItem{ID: fmt.Sprintf("asset-%d", upstream.nextID), GroupID: volcAssetString(body, "GroupId"), ProjectName: volcAssetString(body, "ProjectName"), Name: volcAssetString(body, "Name")}
		upstream.assets[item.ID] = item
		write(map[string]any{"Id": item.ID, "GroupId": item.GroupID, "ProjectName": item.ProjectName, "Name": item.Name})
	case "GetAsset":
		item, ok := upstream.assets[volcAssetString(body, "Id")]
		if !ok {
			write(map[string]any{"Code": "NotFound", "Message": "not found"})
			return
		}
		write(map[string]any{"Id": item.ID, "GroupId": item.GroupID, "ProjectName": item.ProjectName, "Name": item.Name, "AssetType": "Image", "URL": "https://example.test/asset.png"})
	case "UpdateAsset", "DeleteAsset", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup":
		write(map[string]any{"Id": volcAssetString(body, "Id"), "ProjectName": volcAssetString(body, "ProjectName")})
	default:
		http.Error(w, "unknown action", http.StatusNotFound)
	}
}

func (upstream *volcAssetTestUpstream) latest(t *testing.T, action string) volcAssetTestCall {
	t.Helper()
	upstream.mu.Lock()
	defer upstream.mu.Unlock()
	for i := len(upstream.calls) - 1; i >= 0; i-- {
		if upstream.calls[i].Action == action {
			return upstream.calls[i]
		}
	}
	t.Fatalf("missing upstream action %s: %#v", action, upstream.calls)
	return volcAssetTestCall{}
}

func (upstream *volcAssetTestUpstream) count(action string) int {
	upstream.mu.Lock()
	defer upstream.mu.Unlock()
	count := 0
	for _, call := range upstream.calls {
		if call.Action == action {
			count++
		}
	}
	return count
}

func volcAssetObject(value map[string]any, key string) map[string]any {
	result, _ := value[key].(map[string]any)
	return result
}

func volcAssetString(value map[string]any, key string) string {
	result, _ := value[key].(string)
	return result
}

func volcAssetFirstString(value map[string]any, key string) string {
	values, _ := value[key].([]any)
	if len(values) == 0 {
		return ""
	}
	result, _ := values[0].(string)
	return result
}

func volcAssetTestSession(t *testing.T, serverURL, prefix string, role model.UserRole) model.AuthSession {
	t.Helper()
	username := prefix + "-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: username, Role: role}, "test-password"); err != nil {
		t.Fatalf("create %s: %v", prefix, err)
	}
	session := doJSON[model.AuthSession](t, http.MethodPost, serverURL+"/api/auth/login", "", map[string]string{"username": username, "password": "test-password"})
	if session.Code != 0 {
		t.Fatalf("login %s = %#v", prefix, session)
	}
	return session.Data
}

func volcAssetConfigJSON(t *testing.T, config map[string]any) string {
	t.Helper()
	value, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	return string(value)
}

func TestVolcengineAssetsAdminConfigRedactsAndRetainsSecretsThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "volc-asset-config-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := volcAssetTestSession(t, server.URL, "volc-asset-admin", model.UserRoleAdmin)

	invalid := doJSON[volcAssetConfigHTTP](t, http.MethodPost, server.URL+"/api/admin/volcengine-assets/config", admin.Token, map[string]string{"config": "{invalid"})
	if invalid.Code != 1 {
		t.Fatalf("invalid config accepted: %#v", invalid)
	}

	configured := map[string]any{
		"outbounds": []map[string]any{
			{"id": "nested", "name": "嵌套素材库", "format": "newapi", "base_url": "http://127.0.0.1:9999", "access_token": "nested-secret-token", "project_name": "canvas-assets", "group_type": "AIGC"},
			{"id": "signed", "name": "签名素材库", "format": "volcengine-custom", "base_url": "http://127.0.0.1:9998", "access_key": "access-key", "secret_key": "signing-secret-key"},
		},
		"default_outbound":            "nested",
		"outbound_selector_header":    "X-Canvas-Asset-Outbound",
		"failover":                    true,
		"custom_formats":              []any{},
		"action_prices":               map[string]int{"ListAssets": 7},
		"rate_limit_count":            2,
		"rate_limit_duration_seconds": 30,
	}
	saved := doJSON[volcAssetConfigHTTP](t, http.MethodPost, server.URL+"/api/admin/volcengine-assets/config", admin.Token, map[string]string{"config": volcAssetConfigJSON(t, configured)})
	if saved.Code != 0 {
		t.Fatalf("save config = %#v", saved)
	}

	redacted := doJSON[volcAssetConfigHTTP](t, http.MethodGet, server.URL+"/api/admin/volcengine-assets/config", admin.Token, nil)
	if redacted.Code != 0 || strings.Contains(redacted.Data.Config, "nested-secret-token") || strings.Contains(redacted.Data.Config, "signing-secret-key") || strings.Contains(redacted.Data.Config, "access-key") || strings.Contains(redacted.Data.Config, "127.0.0.1:9999") {
		t.Fatalf("redacted config = %#v", redacted)
	}
	var redactedValue map[string]any
	if err := json.Unmarshal([]byte(redacted.Data.Config), &redactedValue); err != nil {
		t.Fatalf("decode redacted config: %v", err)
	}
	for _, outbound := range redactedValue["outbounds"].([]any) {
		item := outbound.(map[string]any)
		if value, ok := item["secret_key"]; ok && value != "" {
			t.Fatalf("secret leaked in redacted outbound: %#v", item)
		}
		if value, ok := item["access_token"]; ok && value != "" {
			t.Fatalf("token leaked in redacted outbound: %#v", item)
		}
	}

	retained := doJSON[volcAssetConfigHTTP](t, http.MethodPost, server.URL+"/api/admin/volcengine-assets/config", admin.Token, map[string]string{"config": redacted.Data.Config})
	if retained.Code != 0 {
		t.Fatalf("save redacted config = %#v", retained)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("database: %v", err)
	}
	var stored model.Setting
	if err := db.First(&stored, "key = ?", "volc_asset_config").Error; err != nil {
		t.Fatalf("load stored config: %v", err)
	}
	if !strings.Contains(string(stored.Value), "nested-secret-token") || !strings.Contains(string(stored.Value), "signing-secret-key") {
		t.Fatalf("empty values overwrote stored secrets: %s", stored.Value)
	}
}

func TestVolcengineAssetsGatewayEnforcesScopesThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "volc-asset-scope-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	upstream := newVolcAssetTestUpstream()
	upstreamServer := httptest.NewServer(upstream)
	defer upstreamServer.Close()
	server := httptest.NewServer(router.New())
	defer server.Close()
	admin := volcAssetTestSession(t, server.URL, "volc-asset-scope-admin", model.UserRoleAdmin)
	configured := map[string]any{
		"outbounds":        []map[string]any{{"id": "nested", "name": "可用素材库", "format": "newapi", "base_url": upstreamServer.URL, "access_token": "nested-token", "project_name": "canvas-assets", "group_type": "AIGC"}},
		"default_outbound": "nested",
	}
	if saved := doJSON[volcAssetConfigHTTP](t, http.MethodPost, server.URL+"/api/admin/volcengine-assets/config", admin.Token, map[string]string{"config": volcAssetConfigJSON(t, configured)}); saved.Code != 0 {
		t.Fatalf("save config = %#v", saved)
	}

	personalA := volcAssetTestSession(t, server.URL, "volc-asset-personal-a", model.UserRoleUser)
	personalB := volcAssetTestSession(t, server.URL, "volc-asset-personal-b", model.UserRoleUser)
	ownerAName := "volc-asset-enterprise-a-" + uuid.NewString()
	ownerBName := "volc-asset-enterprise-b-" + uuid.NewString()
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "素材企业 A", OwnerUsername: ownerAName, OwnerPassword: "test-password"}); err != nil {
		t.Fatalf("create enterprise A: %v", err)
	}
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "素材企业 B", OwnerUsername: ownerBName, OwnerPassword: "test-password"}); err != nil {
		t.Fatalf("create enterprise B: %v", err)
	}
	ownerA := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerAName, "password": "test-password"})
	ownerB := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerBName, "password": "test-password"})
	if ownerA.Code != 0 || ownerB.Code != 0 {
		t.Fatalf("enterprise owner login = %#v / %#v", ownerA, ownerB)
	}

	outbounds := doJSON[[]volcAssetOutboundHTTP](t, http.MethodGet, server.URL+"/api/v1/volcengine-assets/outbounds", personalA.Token, nil)
	if outbounds.Code != 0 || len(outbounds.Data) != 1 || outbounds.Data[0] != (volcAssetOutboundHTTP{ID: "nested", Name: "可用素材库", Format: "newapi"}) {
		t.Fatalf("safe outbounds = %#v", outbounds)
	}
	encodedOutbounds, _ := json.Marshal(outbounds.Data)
	if strings.Contains(string(encodedOutbounds), "nested-token") || strings.Contains(string(encodedOutbounds), upstreamServer.URL) {
		t.Fatalf("unsafe outbound metadata = %s", encodedOutbounds)
	}

	list := func(token string) apiResponse[map[string]any] {
		return doJSON[map[string]any](t, http.MethodPost, server.URL+"/api/v1/doubao/open/ListAssets?outbound=nested", token, map[string]any{
			"Filter":      map[string]any{"GroupIds": []string{"forged-group"}, "GroupType": "forged-type"},
			"PageNumber":  1,
			"PageSize":    20,
			"ProjectName": "forged-project",
		})
	}
	if response := list(personalA.Token); response.Code != 0 {
		t.Fatalf("personal A list = %#v", response)
	}
	callA := upstream.latest(t, "ListAssets")
	groupA := volcAssetFirstString(volcAssetObject(callA.Body, "Filter"), "GroupIds")
	if groupA == "" || groupA == "forged-group" || volcAssetString(callA.Body, "ProjectName") != "canvas-assets" || volcAssetString(volcAssetObject(callA.Body, "Filter"), "GroupType") != "AIGC" || callA.Authorization != "Bearer nested-token" {
		t.Fatalf("personal A scope was not forced: %#v", callA)
	}
	if response := list(personalB.Token); response.Code != 0 {
		t.Fatalf("personal B list = %#v", response)
	}
	groupB := volcAssetFirstString(volcAssetObject(upstream.latest(t, "ListAssets").Body, "Filter"), "GroupIds")
	if response := list(ownerA.Data.Token); response.Code != 0 {
		t.Fatalf("enterprise A list = %#v", response)
	}
	groupEnterpriseA := volcAssetFirstString(volcAssetObject(upstream.latest(t, "ListAssets").Body, "Filter"), "GroupIds")
	if response := list(ownerB.Data.Token); response.Code != 0 {
		t.Fatalf("enterprise B list = %#v", response)
	}
	groupEnterpriseB := volcAssetFirstString(volcAssetObject(upstream.latest(t, "ListAssets").Body, "Filter"), "GroupIds")
	groups := map[string]bool{groupA: true, groupB: true, groupEnterpriseA: true, groupEnterpriseB: true}
	if len(groups) != 4 {
		t.Fatalf("personal and enterprise scopes reused one upstream group: %#v", groups)
	}

	created := doJSON[map[string]any](t, http.MethodPost, server.URL+"/api/v1/doubao/open/CreateAsset", personalB.Token, map[string]any{"GroupId": groupA, "ProjectName": "forged-project", "URL": "https://example.test/remote.png", "AssetType": "Image", "Name": "B 的素材"})
	if created.Code != 0 {
		t.Fatalf("personal B create = %#v", created)
	}
	createCall := upstream.latest(t, "CreateAsset")
	if volcAssetString(createCall.Body, "GroupId") != groupB || volcAssetString(createCall.Body, "ProjectName") != "canvas-assets" {
		t.Fatalf("create scope was not forced: %#v", createCall)
	}
	assetB, _ := created.Data["Id"].(string)
	if assetB == "" {
		t.Fatalf("created asset id missing: %#v", created)
	}

	for _, action := range []string{"GetAsset", "UpdateAsset", "DeleteAsset"} {
		response := doJSON[map[string]any](t, http.MethodPost, server.URL+"/api/v1/doubao/open/"+action, personalA.Token, map[string]any{"Id": assetB, "ProjectName": "forged-project"})
		if response.Code != 1 {
			t.Fatalf("personal A %s crossed scope: %#v", action, response)
		}
	}
	if upstream.count("UpdateAsset") != 0 || upstream.count("DeleteAsset") != 0 {
		t.Fatalf("unauthorized mutations reached upstream: update=%d delete=%d", upstream.count("UpdateAsset"), upstream.count("DeleteAsset"))
	}

	forbiddenGroupAction := doJSON[map[string]any](t, http.MethodPost, server.URL+"/api/v1/doubao/open/ListAssetGroups", personalA.Token, map[string]any{"ProjectName": "forged-project"})
	if forbiddenGroupAction.Code != 1 {
		t.Fatalf("ordinary user invoked group management: %#v", forbiddenGroupAction)
	}
	adminGroupAction := doJSON[map[string]any](t, http.MethodPost, server.URL+"/api/v1/doubao/open/ListAssetGroups", admin.Token, map[string]any{})
	if adminGroupAction.Code != 0 {
		t.Fatalf("admin group action = %#v", adminGroupAction)
	}
	adminCall := upstream.latest(t, "ListAssetGroups")
	if volcAssetString(adminCall.Body, "ProjectName") != "canvas-assets" {
		t.Fatalf("admin default project was not applied: %#v", adminCall)
	}
}
