package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

var validFileTypes = map[string]bool{
	"images":         true,
	"videos":         true,
	"audios":         true,
	"prompts":        true,
	"results/images": true,
	"results/videos": true,
}

var presignExpiry = 1 * time.Hour

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

type uploadURLResult struct {
	UploadURL string `json:"uploadUrl"`
	ConfirmID string `json:"confirmId"`
}

// CreateUploadURL 生成预签名上传 URL + 确认 token。
func CreateUploadURL(ctx context.Context, userID, fileType, fileName, mimeType string) (*uploadURLResult, error) {
	if !validFileTypes[fileType] {
		return nil, errors.New("不支持的文件类型")
	}
	id := uuid.NewString()
	ext := strings.ToLower(filepath.Ext(fileName))
	// ponytail: user-uploaded files → uploads/ prefix; AI results keep results/ prefix
	s3Key := fmt.Sprintf("%s/%s/%s%s", fileType, userID, id, ext)
	if !strings.HasPrefix(fileType, "results/") {
		s3Key = fmt.Sprintf("uploads/%s/%s/%s%s", fileType, userID, id, ext)
	}
	uploadURL, err := S3PresignPut(ctx, s3Key, mimeType, presignExpiry)
	if err != nil {
		return nil, err
	}
	// 存储 pending 记录，上传完成后 ConfirmUpload 激活
	item := model.UserFile{
		ID:           id,
		UserID:       userID,
		FileType:     fileType,
		S3Key:        s3Key,
		OriginalName: fileName,
		MimeType:     mimeType,
		Bytes:        0,
	}
	if err := repository.CreateUserFile(item); err != nil {
		return nil, err
	}
	return &uploadURLResult{UploadURL: uploadURL, ConfirmID: id}, nil
}

// ConfirmUpload 确认上传完成，更新字节数。
func ConfirmUpload(userID, body string) (*model.UserFile, error) {
	var payload struct {
		ConfirmID string `json:"confirmId"`
		Bytes     int64  `json:"bytes"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return nil, errors.New("请求参数错误")
	}
	item, ok, err := repository.GetUserFileByID(payload.ConfirmID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("上传会话不存在")
	}
	if payload.Bytes > 0 {
		item.Bytes = payload.Bytes
		if err := repository.UpdateUserFile(item); err != nil {
			return nil, err
		}
	}
	item.S3Key, _ = S3PresignGet(context.Background(), item.S3Key, presignExpiry)
	return &item, nil
}

// GetUserFile 返回文件的预签名下载 URL。
func GetUserFile(id, userID string) (*model.UserFile, error) {
	item, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("文件不存在")
	}
	item.S3Key, _ = S3PresignGet(context.Background(), item.S3Key, presignExpiry)
	return &item, nil
}

// ListUserFiles 按类型分页列出用户文件（返回预签名 URL）。
func ListUserFiles(userID, fileType string, page, pageSize int) ([]model.UserFile, int64, error) {
	items, total, err := repository.ListUserFiles(userID, fileType, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].S3Key, _ = S3PresignGet(context.Background(), items[i].S3Key, presignExpiry)
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

// UploadUserFile 保留服务端直传（管理端素材图片等场景）。
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
	// ponytail: user-uploaded files go under uploads/ prefix; AI results keep results/ prefix
	s3Key := fmt.Sprintf("%s/%s/%s%s", fileType, userID, id, ext)
	if !strings.HasPrefix(fileType, "results/") {
		s3Key = fmt.Sprintf("uploads/%s/%s/%s%s", fileType, userID, id, ext)
	}
	_, err := S3Upload(ctx, s3Key, reader, mimeType)
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
		_ = S3Delete(context.Background(), s3Key)
		return nil, err
	}
	item.S3Key, _ = S3PresignGet(context.Background(), item.S3Key, presignExpiry)
	return &item, nil
}
