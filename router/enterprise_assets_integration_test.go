package router_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/google/uuid"
)

type enterpriseAssetView struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	EnterpriseID string          `json:"enterpriseId"`
	CreatorName  string          `json:"creatorName"`
	Title        string          `json:"title"`
	Type         model.AssetType `json:"type"`
	Tags         []string        `json:"tags"`
	Description  string          `json:"description"`
	Content      string          `json:"content"`
	URL          string          `json:"url"`
	FileID       string          `json:"fileId"`
	Width        int             `json:"width"`
	Height       int             `json:"height"`
	Bytes        int64           `json:"bytes"`
	MimeType     string          `json:"mimeType"`
}

type enterpriseAssetList struct {
	Items []enterpriseAssetView `json:"items"`
	Tags  []string              `json:"tags"`
	Total int                   `json:"total"`
}

type enterpriseAssetSync struct {
	Assets struct {
		Updates []enterpriseAssetView `json:"updates"`
	} `json:"assets"`
}

func TestEnterpriseTextAssetsAreSharedWithinEnterpriseThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-assets-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerUsername := "asset-owner-" + uuid.NewString()
	enterprise, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "素材测试企业", OwnerUsername: ownerUsername, OwnerPassword: "owner-password"})
	if err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	server := httptest.NewServer(router.New())
	defer server.Close()
	owner := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerUsername, "password": "owner-password"})
	memberUsername := "asset-member-" + uuid.NewString()
	doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", owner.Data.Token, map[string]string{"username": memberUsername, "password": "member-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})

	syncCursor := time.Now().Add(-time.Second).Format(time.RFC3339)
	created := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", owner.Data.Token, map[string]any{
		"enterpriseId": "forged-enterprise", "userId": "forged-user", "type": "text", "title": "品牌介绍", "tags": []string{"品牌", "常用"},
		"description": "团队统一介绍", "content": "这是企业共享文本素材。",
	})
	if created.Code != 0 || created.Data.ID == "" || created.Data.EnterpriseID != enterprise.ID || created.Data.UserID != owner.Data.User.ID || created.Data.CreatorName != ownerUsername {
		t.Fatalf("created enterprise asset = %#v", created)
	}
	second := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", owner.Data.Token, map[string]any{
		"type": "text", "title": "品牌口号", "tags": []string{"常用"}, "content": "第二条企业共享文本。",
	})
	if second.Code != 0 || second.Data.ID == created.Data.ID {
		t.Fatalf("second enterprise asset = %#v", second)
	}

	personal := doJSON[model.AssetList](t, http.MethodGet, server.URL+"/api/v1/assets?pageSize=100", owner.Data.Token, nil)
	for _, item := range personal.Data.Items {
		if item.EnterpriseID != nil || item.ID == created.Data.ID || item.ID == second.Data.ID {
			t.Fatalf("enterprise asset leaked into personal assets = %#v", personal.Data)
		}
	}
	sync := doJSON[enterpriseAssetSync](t, http.MethodGet, server.URL+"/api/v1/sync?domains=assets&cursor="+url.QueryEscape(syncCursor), owner.Data.Token, nil)
	for _, item := range sync.Data.Assets.Updates {
		if item.EnterpriseID != "" || item.ID == created.Data.ID || item.ID == second.Data.ID {
			t.Fatalf("enterprise asset leaked into personal sync = %#v", sync.Data.Assets.Updates)
		}
	}

	listed := doJSON[enterpriseAssetList](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets?keyword="+url.QueryEscape("品牌")+"&type=text&tag="+url.QueryEscape("常用")+"&page=1&pageSize=1", member.Data.Token, nil)
	if listed.Code != 0 || listed.Data.Total != 2 || len(listed.Data.Items) != 1 || len(listed.Data.Tags) != 2 {
		t.Fatalf("member enterprise asset list = %#v", listed)
	}
	secondPage := doJSON[enterpriseAssetList](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets?keyword="+url.QueryEscape("品牌")+"&type=text&tag="+url.QueryEscape("常用")+"&page=2&pageSize=1", member.Data.Token, nil)
	if secondPage.Code != 0 || secondPage.Data.Total != 2 || len(secondPage.Data.Items) != 1 || secondPage.Data.Items[0].ID == listed.Data.Items[0].ID {
		t.Fatalf("member enterprise asset second page = %#v", secondPage)
	}

	updated := doJSON[enterpriseAssetView](t, http.MethodPut, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, owner.Data.Token, map[string]any{
		"id": "forged-id", "enterpriseId": "forged-enterprise", "userId": "forged-user", "type": "text", "title": "品牌介绍（新版）", "tags": []string{"品牌"},
		"description": "已更新", "content": "更新后的共享文本。",
	})
	if updated.Code != 0 || updated.Data.ID != created.Data.ID || updated.Data.EnterpriseID != enterprise.ID || updated.Data.UserID != owner.Data.User.ID || updated.Data.Content != "更新后的共享文本。" {
		t.Fatalf("updated enterprise asset = %#v", updated)
	}
	viewed := doJSON[enterpriseAssetView](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, member.Data.Token, nil)
	if viewed.Code != 0 || viewed.Data.Title != "品牌介绍（新版）" || viewed.Data.Content != "更新后的共享文本。" {
		t.Fatalf("member enterprise asset detail = %#v", viewed)
	}

	copied := doJSON[model.Asset](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID+"/copy", member.Data.Token, nil)
	if copied.Code != 0 || copied.Data.ID == "" || copied.Data.ID == created.Data.ID || copied.Data.UserID != member.Data.User.ID || copied.Data.EnterpriseID != nil || copied.Data.Type != model.AssetTypeText || copied.Data.Content != "更新后的共享文本。" {
		t.Fatalf("member copied enterprise text asset = %#v", copied)
	}

	deleted := doJSON[map[string]string](t, http.MethodDelete, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, owner.Data.Token, nil)
	if deleted.Code != 0 || deleted.Data["id"] != created.Data.ID {
		t.Fatalf("deleted enterprise asset = %#v", deleted)
	}
	missing := doJSON[enterpriseAssetView](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, member.Data.Token, nil)
	if missing.Code != 1 || missing.Msg != "素材不存在或无权访问" {
		t.Fatalf("deleted enterprise asset remained readable = %#v", missing)
	}
	personalAfterDelete := doJSON[model.AssetList](t, http.MethodGet, server.URL+"/api/v1/assets?pageSize=100", member.Data.Token, nil)
	if personalAfterDelete.Code != 0 || len(personalAfterDelete.Data.Items) != 1 || personalAfterDelete.Data.Items[0].ID != copied.Data.ID || personalAfterDelete.Data.Items[0].Content != copied.Data.Content {
		t.Fatalf("copied personal text asset disappeared with source = %#v", personalAfterDelete)
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", member.Data.User.ID).Updates(map[string]any{"enterprise_id": nil, "enterprise_role": nil}).Error; err != nil {
		t.Fatalf("leave enterprise: %v", err)
	}
	personalAfterLeave := doJSON[model.AssetList](t, http.MethodGet, server.URL+"/api/v1/assets?pageSize=100", member.Data.Token, nil)
	if personalAfterLeave.Code != 0 || len(personalAfterLeave.Data.Items) != 1 || personalAfterLeave.Data.Items[0].ID != copied.Data.ID {
		t.Fatalf("copied personal text asset disappeared after leaving enterprise = %#v", personalAfterLeave)
	}
}

func TestEnterpriseAssetRolesAndScopeAreEnforcedThroughHTTP(t *testing.T) {
	previousJWTSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "enterprise-assets-scope-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

	ownerAUsername := "asset-scope-owner-a-" + uuid.NewString()
	ownerBUsername := "asset-scope-owner-b-" + uuid.NewString()
	enterpriseA, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "素材企业 A", OwnerUsername: ownerAUsername, OwnerPassword: "owner-password", OwnerDisplayName: "企业 A 负责人"})
	if err != nil {
		t.Fatalf("create enterprise A: %v", err)
	}
	if _, err := service.CreateEnterprise(service.CreateEnterpriseInput{Name: "素材企业 B", OwnerUsername: ownerBUsername, OwnerPassword: "owner-password"}); err != nil {
		t.Fatalf("create enterprise B: %v", err)
	}
	personalUsername := "asset-scope-personal-" + uuid.NewString()
	if _, err := service.SaveUser(model.User{Username: personalUsername}, "personal-password"); err != nil {
		t.Fatalf("create personal user: %v", err)
	}

	server := httptest.NewServer(router.New())
	defer server.Close()
	ownerA := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerAUsername, "password": "owner-password"})
	ownerB := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": ownerBUsername, "password": "owner-password"})
	personal := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": personalUsername, "password": "personal-password"})
	memberUsername := "asset-scope-member-" + uuid.NewString()
	doJSON[enterpriseMember](t, http.MethodPost, server.URL+"/api/v1/enterprise/members", ownerA.Data.Token, map[string]string{"username": memberUsername, "password": "member-password"})
	member := doJSON[model.AuthSession](t, http.MethodPost, server.URL+"/api/auth/login", "", map[string]string{"username": memberUsername, "password": "member-password"})

	created := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", ownerA.Data.Token, map[string]any{"type": "text", "title": "企业 A 素材", "content": "仅企业 A 可读"})
	if created.Code != 0 || created.Data.EnterpriseID != enterpriseA.ID || created.Data.CreatorName != "企业 A 负责人" {
		t.Fatalf("enterprise asset creator = %#v", created)
	}
	for label, response := range map[string]apiResponse[model.Asset]{
		"cross-enterprise copy": doJSON[model.Asset](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID+"/copy", ownerB.Data.Token, nil),
		"personal copy":         doJSON[model.Asset](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID+"/copy", personal.Data.Token, nil),
	} {
		if response.Code != 1 || response.Msg != "素材不存在或无权访问" && response.Msg != "无权限访问企业素材库" {
			t.Fatalf("%s = %#v", label, response)
		}
	}

	for label, response := range map[string]apiResponse[enterpriseAssetView]{
		"member create": doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", member.Data.Token, map[string]string{"title": "越权创建", "content": "不应创建"}),
		"member update": doJSON[enterpriseAssetView](t, http.MethodPut, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, member.Data.Token, map[string]string{"title": "越权更新", "content": "不应更新"}),
	} {
		if response.Code != 1 || response.Msg != "仅企业主账号可管理企业素材" {
			t.Fatalf("%s = %#v", label, response)
		}
	}
	memberDelete := doJSON[map[string]string](t, http.MethodDelete, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, member.Data.Token, nil)
	if memberDelete.Code != 1 || memberDelete.Msg != "仅企业主账号可管理企业素材" {
		t.Fatalf("member deleted enterprise asset = %#v", memberDelete)
	}

	crossList := doJSON[enterpriseAssetList](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets?enterpriseId="+url.QueryEscape(enterpriseA.ID), ownerB.Data.Token, nil)
	if crossList.Code != 0 || crossList.Data.Total != 0 || len(crossList.Data.Items) != 0 {
		t.Fatalf("cross-enterprise list = %#v", crossList)
	}
	crossDetail := doJSON[enterpriseAssetView](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, ownerB.Data.Token, nil)
	if crossDetail.Code != 1 || crossDetail.Msg != "素材不存在或无权访问" {
		t.Fatalf("cross-enterprise detail = %#v", crossDetail)
	}
	crossUpdate := doJSON[enterpriseAssetView](t, http.MethodPut, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, ownerB.Data.Token, map[string]string{"title": "越权更新", "content": "不应更新"})
	if crossUpdate.Code != 1 || crossUpdate.Msg != "素材不存在或无权操作" {
		t.Fatalf("cross-enterprise update = %#v", crossUpdate)
	}
	crossDelete := doJSON[map[string]string](t, http.MethodDelete, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, ownerB.Data.Token, nil)
	if crossDelete.Code != 1 || crossDelete.Msg != "素材不存在或无权操作" {
		t.Fatalf("cross-enterprise delete = %#v", crossDelete)
	}

	personalList := doJSON[enterpriseAssetList](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets?enterpriseId="+url.QueryEscape(enterpriseA.ID), personal.Data.Token, nil)
	if personalList.Code != 1 || personalList.Msg != "无权限访问企业素材库" {
		t.Fatalf("personal user listed enterprise assets = %#v", personalList)
	}
	media := doJSON[enterpriseAssetView](t, http.MethodPost, server.URL+"/api/v1/enterprise/assets", ownerA.Data.Token, map[string]string{"type": "image", "title": "越界媒体", "content": "不应创建"})
	if media.Code != 1 || media.Msg != "请先上传企业媒体文件" {
		t.Fatalf("media enterprise asset = %#v", media)
	}

	unchanged := doJSON[enterpriseAssetView](t, http.MethodGet, server.URL+"/api/v1/enterprise/assets/"+created.Data.ID, ownerA.Data.Token, nil)
	if unchanged.Code != 0 || unchanged.Data.Title != "企业 A 素材" || unchanged.Data.Content != "仅企业 A 可读" {
		t.Fatalf("rejected requests changed asset = %#v", unchanged)
	}
}
