package service

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

const assetPresignExpiry = 12 * time.Hour

func ListAssets(userID string, q model.Query) (model.AssetList, error) {
	items, total, err := repository.ListAssets(userID, q)
	if err != nil {
		return model.AssetList{}, err
	}
	// Resolve presigned download URLs for assets with fileId references.
	enrichAssetURLs(items)
	tags, err := repository.ListAssetTags(userID, q)
	if err != nil {
		return model.AssetList{}, err
	}
	return model.AssetList{Items: items, Tags: tags, Total: int(total)}, nil
}

// enrichAssetURLs resolves presigned URLs for image/video assets by looking up
// the S3 key from user_files and generating a fresh presigned download URL.
func enrichAssetURLs(items []model.Asset) {
	for i := range items {
		if items[i].FileID == "" {
			continue
		}
		// Lookup the S3 key from user_files, scoped to the asset owner.
		userFile, ok, err := repository.GetUserFileByID(items[i].FileID, items[i].UserID)
		if err != nil || !ok {
			continue
		}
		url, _ := S3PresignGet(context.Background(), userFile.S3Key, presignExpiry)
		if url != "" {
			items[i].URL = url
		}
	}
}

func SaveAsset(userID string, item model.Asset) (model.Asset, error) {
	return SaveAssetWithLock(userID, item, "")
}

// SaveAssetWithLock 保存素材。expectedUpdatedAt 用于乐观锁：更新时匹配当前版本，插入时传空。
func SaveAssetWithLock(userID string, item model.Asset, expectedUpdatedAt string) (model.Asset, error) {
	now := time.Now().Format(time.RFC3339)
	if item.Type == "" {
		item.Type = model.AssetTypeText
	}
	if item.ID == "" {
		item.ID = newID("asset")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	item.UserID = userID
	item.EnterpriseID = nil
	if item.CoverURL == "" {
		item.CoverURL = assetCoverURL(item)
	}
	return repository.SaveAssetWithLock(item, expectedUpdatedAt)
}

func ListEnterpriseAssets(current model.AuthUser, q model.Query) (model.AssetList, error) {
	enterpriseID, err := enterpriseAssetEnterpriseID(current)
	if err != nil {
		return model.AssetList{}, err
	}
	items, total, err := repository.ListEnterpriseAssets(enterpriseID, q)
	if err != nil {
		return model.AssetList{}, err
	}
	enrichEnterpriseAssetURLs(items, enterpriseID)
	tags, err := repository.ListEnterpriseAssetTags(enterpriseID, q)
	return model.AssetList{Items: items, Tags: tags, Total: int(total)}, err
}

func GetEnterpriseAsset(current model.AuthUser, id string) (model.Asset, error) {
	enterpriseID, err := enterpriseAssetEnterpriseID(current)
	if err != nil {
		return model.Asset{}, err
	}
	item, ok, err := repository.GetEnterpriseAsset(enterpriseID, id)
	if err != nil {
		return model.Asset{}, err
	}
	if !ok {
		return model.Asset{}, safeMessageError{message: "素材不存在或无权访问"}
	}
	items := []model.Asset{item}
	enrichEnterpriseAssetURLs(items, enterpriseID)
	return items[0], nil
}

func CreateEnterpriseAsset(current model.AuthUser, item model.Asset) (model.Asset, error) {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return model.Asset{}, err
	}
	if err := normalizeEnterpriseAsset(&item); err != nil {
		return model.Asset{}, err
	}
	if err := bindEnterpriseAssetFile(enterpriseID, &item); err != nil {
		return model.Asset{}, err
	}
	now := time.Now().Format(time.RFC3339)
	item.ID = newID("asset")
	item.UserID = current.ID
	item.EnterpriseID = &enterpriseID
	item.CreatedAt = now
	item.UpdatedAt = now
	item.CreatorName = strings.TrimSpace(current.DisplayName)
	if item.CreatorName == "" {
		item.CreatorName = current.Username
	}
	created, err := repository.CreateEnterpriseAsset(item)
	if err != nil {
		return model.Asset{}, err
	}
	items := []model.Asset{created}
	enrichEnterpriseAssetURLs(items, enterpriseID)
	return items[0], nil
}

func UpdateEnterpriseAsset(current model.AuthUser, id string, item model.Asset) (model.Asset, error) {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return model.Asset{}, err
	}
	existing, ok, err := repository.GetEnterpriseAsset(enterpriseID, id)
	if err != nil {
		return model.Asset{}, err
	}
	if !ok {
		return model.Asset{}, safeMessageError{message: "素材不存在或无权操作"}
	}
	if err := normalizeEnterpriseAsset(&item); err != nil {
		return model.Asset{}, err
	}
	if err := bindEnterpriseAssetFile(enterpriseID, &item); err != nil {
		return model.Asset{}, err
	}
	item.ID = id
	item.UserID = existing.UserID
	item.EnterpriseID = &enterpriseID
	item.CreatedAt = existing.CreatedAt
	item.UpdatedAt = time.Now().Format(time.RFC3339)
	updated, ok, err := repository.UpdateEnterpriseAsset(item)
	if err != nil {
		return model.Asset{}, err
	}
	if !ok {
		return model.Asset{}, safeMessageError{message: "素材不存在或无权操作"}
	}
	items := []model.Asset{updated}
	enrichEnterpriseAssetURLs(items, enterpriseID)
	return items[0], nil
}

func DeleteEnterpriseAsset(current model.AuthUser, id string) error {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return err
	}
	file, deleted, err := repository.DeleteEnterpriseAsset(enterpriseID, id)
	if err != nil {
		return err
	}
	if !deleted {
		return safeMessageError{message: "素材不存在或无权操作"}
	}
	if file.S3Key != "" {
		// Authorization is removed transactionally; object cleanup is best effort.
		_ = S3Delete(context.Background(), file.S3Key)
	}
	return nil
}

func enterpriseAssetEnterpriseID(current model.AuthUser) (string, error) {
	if current.EnterpriseID == "" || (current.EnterpriseRole != model.EnterpriseRoleOwner && current.EnterpriseRole != model.EnterpriseRoleMember) {
		return "", safeMessageError{message: "无权限访问企业素材库"}
	}
	return current.EnterpriseID, nil
}

func enterpriseAssetOwnerID(current model.AuthUser) (string, error) {
	enterpriseID, err := enterpriseAssetEnterpriseID(current)
	if err != nil {
		return "", err
	}
	if current.EnterpriseRole != model.EnterpriseRoleOwner {
		return "", safeMessageError{message: "仅企业主账号可管理企业素材"}
	}
	return enterpriseID, nil
}

func normalizeEnterpriseAsset(item *model.Asset) error {
	item.Title = strings.TrimSpace(item.Title)
	if item.Type == "" {
		item.Type = model.AssetTypeText
	}
	if item.Title == "" {
		return safeMessageError{message: "素材标题不能为空"}
	}
	if item.Tags == nil {
		item.Tags = []string{}
	}
	item.URL = ""
	switch item.Type {
	case model.AssetTypeText:
		if strings.TrimSpace(item.Content) == "" {
			return safeMessageError{message: "素材内容不能为空"}
		}
		item.CoverURL, item.FileID = "", ""
		item.Width, item.Height, item.Bytes, item.MimeType = 0, 0, 0, ""
	case model.AssetTypeImage, model.AssetTypeVideo:
		if item.FileID == "" {
			return safeMessageError{message: "请先上传企业媒体文件"}
		}
		item.CoverURL, item.Content = "", ""
	default:
		return safeMessageError{message: "不支持的企业素材类型"}
	}
	return nil
}

func bindEnterpriseAssetFile(enterpriseID string, item *model.Asset) error {
	if item.Type == model.AssetTypeText {
		return nil
	}
	file, ok, err := repository.GetEnterpriseFileByID(item.FileID, enterpriseID)
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "文件不存在或无权操作"}
	}
	if file.FileType != string(item.Type)+"s" {
		return safeMessageError{message: "文件类型与素材类型不匹配"}
	}
	item.Bytes, item.MimeType = file.Bytes, file.MimeType
	return nil
}

func enrichEnterpriseAssetURLs(items []model.Asset, enterpriseID string) {
	for i := range items {
		if items[i].FileID == "" {
			continue
		}
		file, ok, err := repository.GetEnterpriseFileByID(items[i].FileID, enterpriseID)
		if err != nil || !ok {
			continue
		}
		items[i].URL, _ = S3PresignGet(context.Background(), file.S3Key, enterpriseFilePresignExpiry)
	}
}

func DeleteAsset(userID, id string) error {
	if err := repository.DeleteAsset(userID, id); err != nil {
		return err
	}
	// 记录删除日志供 sync API 返回
	_ = repository.RecordDeletion("assets", id, userID, time.Now())
	return nil
}

func assetCoverURL(item model.Asset) string {
	if item.CoverURL != "" {
		return item.CoverURL
	}
	if item.Type == model.AssetTypeImage {
		return item.URL
	}
	return ""
}

// UploadAssetImage 上传素材图片到 S3 images/admin/ 目录，返回预签名下载 URL。
func UploadAssetImage(ctx context.Context, filename, mimeType string, file io.Reader) (string, error) {
	key := fmt.Sprintf("images/admin/%s%s", uuid.NewString(), fileExt(filename))
	if _, err := S3Upload(ctx, key, file, mimeType); err != nil {
		return "", err
	}
	return S3PresignGet(ctx, key, presignExpiry)
}

func fileExt(filename string) string {
	for i := len(filename) - 1; i >= 0; i-- {
		if filename[i] == '.' {
			return filename[i:]
		}
	}
	return ""
}
