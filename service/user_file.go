package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	canvasConfig "github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

var validFileTypes = map[string]bool{
	"images":  true,
	"videos":  true,
	"audios":  true,
	"prompts": true,
}

// UserFileSizeLimit 返回指定文件类型的上传大小上限（管理端可配）。
func UserFileSizeLimit(fileType string) int64 {
	settings, err := repository.GetSettings()
	if err != nil {
		return 0
	}
	limits := normalizeFileSizeLimits(normalizePrivateSetting(settings.Private).FileSizeLimits)
	switch fileType {
	case "images":
		return limits.Image
	case "videos":
		return limits.Video
	case "audios":
		return limits.Audio
	case "prompts":
		return limits.Prompt
	}
	return 0
}

// UploadUserFile 上传文件到 S3 并写入数据库记录。
func UploadUserFile(ctx context.Context, userID, fileType, originalName, mimeType string, reader io.Reader, size int64) (*model.UserFile, error) {
	if !validFileTypes[fileType] {
		return nil, errors.New("不支持的文件类型")
	}
	limit := UserFileSizeLimit(fileType)
	if limit > 0 && size > limit {
		return nil, fmt.Errorf("文件大小超过限制（上限 %d MB）", limit/(1<<20))
	}
	id := uuid.NewString()
	ext := strings.ToLower(filepath.Ext(originalName))
	s3Key := fmt.Sprintf("%s/%s/%s%s", fileType, userID, id, ext)
	url, err := S3Upload(ctx, s3Key, reader, mimeType)
	if err != nil {
		return nil, err
	}
	item := model.UserFile{
		ID:           id,
		UserID:       userID,
		FileType:     fileType,
		S3Key:        s3Key,
		OriginalName: originalName,
		MimeType:     mimeType,
		Bytes:        size,
	}
	if err := repository.CreateUserFile(item); err != nil {
		// ponytail: best-effort cleanup, orphaned S3 object beats lost DB record
		_ = S3Delete(context.Background(), s3Key)
		return nil, err
	}
	// ponytail: return public S3 URL directly, no presigned dance needed
	item.S3Key = url
	return &item, nil
}

// GetUserFile 返回文件的 S3 公开 URL。
func GetUserFile(id, userID string) (*model.UserFile, error) {
	item, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("文件不存在")
	}
	item.S3Key = s3PublicURL(item.S3Key)
	return &item, nil
}

// ListUserFiles 按类型分页列出用户文件（返回公开 URL）。
func ListUserFiles(userID, fileType string, page, pageSize int) ([]model.UserFile, int64, error) {
	items, total, err := repository.ListUserFiles(userID, fileType, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].S3Key = s3PublicURL(items[i].S3Key)
	}
	return items, total, nil
}

// DeleteUserFile 删除 S3 对象和数据库记录。
func DeleteUserFile(ctx context.Context, id, userID string) error {
	item, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("文件不存在")
	}
	if err := S3Delete(ctx, item.S3Key); err != nil {
		return err
	}
	_, err = repository.DeleteUserFile(id, userID)
	return err
}

func s3PublicURL(s3Key string) string {
	return fmt.Sprintf("%s/%s", strings.TrimRight(canvasConfig.Cfg.AmazonS3URL, "/"), s3Key)
}
