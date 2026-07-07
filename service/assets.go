package service

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

const assetPresignExpiry = 1 * time.Hour

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
	if item.CoverURL == "" {
		item.CoverURL = assetCoverURL(item)
	}
	return repository.SaveAssetWithLock(item, expectedUpdatedAt)
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
