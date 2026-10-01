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
	"results/audios": true,
}

var presignExpiry = 12 * time.Hour

const enterpriseFilePresignExpiry = 15 * time.Minute

// UserFileSizeLimit 返回指定文件类型的上传大小上限（管理端可配）。
func UserFileSizeLimit(fileType string) int64 {
	settings, err := repository.GetSettings()
	if err != nil {
		return 0
	}
	limits := normalizeFileSizeLimits(normalizePrivateSetting(settings.Private).FileSizeLimits)
	switch fileType {
	case "images", "results/images":
		return limits.Image
	case "videos", "results/videos":
		return limits.Video
	case "audios", "results/audios":
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

// CreateUploadURL 生成个人文件预签名上传 URL + 确认 token。
func CreateUploadURL(ctx context.Context, userID, fileType, fileName, mimeType string) (*uploadURLResult, error) {
	if !validFileTypes[fileType] {
		return nil, errors.New("不支持的文件类型")
	}
	id := uuid.NewString()
	s3Key := userFileKey(id, userID, nil, fileType, fileName)
	uploadURL, err := S3PresignPut(ctx, s3Key, mimeType, presignExpiry)
	if err != nil {
		return nil, err
	}
	item := model.UserFile{ID: id, UserID: userID, FileType: fileType, S3Key: s3Key, OriginalName: fileName, MimeType: mimeType}
	if err := repository.CreateUserFile(item); err != nil {
		return nil, err
	}
	return &uploadURLResult{UploadURL: uploadURL, ConfirmID: id}, nil
}

// ConfirmUpload 确认个人文件上传完成，更新字节数。
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
	presignFile(&item, presignExpiry)
	return &item, nil
}

// GetUserFile 返回个人文件的预签名下载 URL。
func GetUserFile(id, userID string) (*model.UserFile, error) {
	item, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("文件不存在")
	}
	presignFile(&item, presignExpiry)
	return &item, nil
}

// DownloadUserFile 返回用户所属个人文件的内容流。
func DownloadUserFile(ctx context.Context, id, userID string) (io.ReadCloser, model.UserFile, error) {
	item, ok, err := repository.GetUserFileByID(id, userID)
	if err != nil {
		return nil, model.UserFile{}, err
	}
	if !ok {
		return nil, model.UserFile{}, errors.New("文件不存在")
	}
	body, err := S3Download(ctx, item.S3Key)
	return body, item, err
}

// ListUserFiles 按类型分页列出个人文件（返回预签名 URL）。
func ListUserFiles(userID, fileType string, page, pageSize int) ([]model.UserFile, int64, error) {
	items, total, err := repository.ListUserFiles(userID, fileType, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		presignFile(&items[i], presignExpiry)
	}
	return items, total, nil
}

// DeleteUserFile 删除个人文件的 S3 对象和数据库记录。
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

// UploadUserFile 保留个人文件服务端直传（管理端素材图片等场景）。
func UploadUserFile(ctx context.Context, userID, fileType, originalName, mimeType string, reader io.Reader, size int64) (*model.UserFile, error) {
	return uploadFile(ctx, userID, nil, fileType, originalName, mimeType, reader, size, presignExpiry)
}

func UploadEnterpriseFile(ctx context.Context, current model.AuthUser, fileType, originalName, mimeType string, reader io.Reader, size int64) (*model.UserFile, error) {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return nil, err
	}
	if fileType != "images" && fileType != "videos" {
		return nil, safeMessageError{message: "企业素材仅支持图片和视频文件"}
	}
	return uploadFile(ctx, current.ID, &enterpriseID, fileType, originalName, mimeType, reader, size, enterpriseFilePresignExpiry)
}

func GetEnterpriseFile(current model.AuthUser, id string) (*model.UserFile, error) {
	enterpriseID, err := enterpriseAssetEnterpriseID(current)
	if err != nil {
		return nil, err
	}
	item, ok, err := repository.GetEnterpriseFileByID(id, enterpriseID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, safeMessageError{message: "文件不存在或无权访问"}
	}
	presignFile(&item, enterpriseFilePresignExpiry)
	return &item, nil
}

func DownloadEnterpriseFile(ctx context.Context, current model.AuthUser, id string) (io.ReadCloser, model.UserFile, error) {
	enterpriseID, err := enterpriseAssetEnterpriseID(current)
	if err != nil {
		return nil, model.UserFile{}, err
	}
	item, ok, err := repository.GetEnterpriseFileByID(id, enterpriseID)
	if err != nil {
		return nil, model.UserFile{}, err
	}
	if !ok {
		return nil, model.UserFile{}, safeMessageError{message: "文件不存在或无权访问"}
	}
	body, err := S3Download(ctx, item.S3Key)
	return body, item, err
}

func UpdateEnterpriseFile(ctx context.Context, current model.AuthUser, id, fileType, originalName, mimeType string, reader io.Reader, size int64) (*model.UserFile, error) {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return nil, err
	}
	if fileType != "images" && fileType != "videos" {
		return nil, safeMessageError{message: "企业素材仅支持图片和视频文件"}
	}
	item, ok, err := repository.GetEnterpriseFileByID(id, enterpriseID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, safeMessageError{message: "文件不存在或无权操作"}
	}
	if err := validateFileSize(fileType, size); err != nil {
		return nil, err
	}
	if _, err := S3Upload(ctx, item.S3Key, reader, mimeType); err != nil {
		return nil, err
	}
	item.FileType, item.OriginalName, item.MimeType, item.Bytes = fileType, originalName, mimeType, size
	updated, err := repository.UpdateEnterpriseFile(item)
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, safeMessageError{message: "文件不存在或无权操作"}
	}
	presignFile(&item, enterpriseFilePresignExpiry)
	return &item, nil
}

func DeleteEnterpriseFile(ctx context.Context, current model.AuthUser, id string) error {
	enterpriseID, err := enterpriseAssetOwnerID(current)
	if err != nil {
		return err
	}
	item, ok, err := repository.GetEnterpriseFileByID(id, enterpriseID)
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "文件不存在或无权操作"}
	}
	deleted, err := repository.DeleteEnterpriseFile(id, enterpriseID)
	if err != nil {
		return err
	}
	if !deleted {
		return safeMessageError{message: "文件不存在或无权操作"}
	}
	// ponytail: DB authorization is removed first; orphan cleanup can be retried if S3 failures become measurable.
	_ = S3Delete(ctx, item.S3Key)
	return nil
}

func uploadFile(ctx context.Context, userID string, enterpriseID *string, fileType, originalName, mimeType string, reader io.Reader, size int64, expiry time.Duration) (*model.UserFile, error) {
	if !validFileTypes[fileType] {
		return nil, errors.New("不支持的文件类型")
	}
	if err := validateFileSize(fileType, size); err != nil {
		return nil, err
	}
	id := uuid.NewString()
	s3Key := userFileKey(id, userID, enterpriseID, fileType, originalName)
	if _, err := S3Upload(ctx, s3Key, reader, mimeType); err != nil {
		return nil, err
	}
	item := model.UserFile{ID: id, UserID: userID, EnterpriseID: enterpriseID, FileType: fileType, S3Key: s3Key, OriginalName: originalName, MimeType: mimeType, Bytes: size}
	if err := repository.CreateUserFile(item); err != nil {
		_ = S3Delete(context.Background(), s3Key)
		return nil, err
	}
	presignFile(&item, expiry)
	return &item, nil
}

func validateFileSize(fileType string, size int64) error {
	limit := UserFileSizeLimit(fileType)
	if limit > 0 && size > limit {
		return fmt.Errorf("文件大小超过限制（上限 %d MB）", limit/(1<<20))
	}
	return nil
}

func userFileKey(id, userID string, enterpriseID *string, fileType, originalName string) string {
	ext := strings.ToLower(filepath.Ext(originalName))
	if enterpriseID != nil {
		return fmt.Sprintf("enterprises/%s/%s/%s%s", *enterpriseID, fileType, id, ext)
	}
	if strings.HasPrefix(fileType, "results/") {
		return fmt.Sprintf("%s/%s/%s%s", fileType, userID, id, ext)
	}
	return fmt.Sprintf("uploads/%s/%s/%s%s", fileType, userID, id, ext)
}

func presignFile(item *model.UserFile, expiry time.Duration) {
	item.URL, _ = S3PresignGet(context.Background(), item.S3Key, expiry)
}
