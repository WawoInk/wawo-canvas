package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

const userFileMaxBody = 80 << 20

// CreateUploadURL POST /api/v1/files/upload-url — 生成预签名上传 URL。
func CreateUploadURL(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var req struct {
		FileType string `json:"fileType"`
		FileName string `json:"fileName"`
		MimeType string `json:"mimeType"`
	}
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil || req.FileName == "" {
		Fail(w, "请提供文件名")
		return
	}
	result, err := service.CreateUploadURL(r.Context(), user.ID, req.FileType, req.FileName, req.MimeType)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}

// ConfirmUpload POST /api/v1/files/confirm — 确认上传完成，写入数据库。
func ConfirmUpload(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, _ := io.ReadAll(r.Body)
	item, err := service.ConfirmUpload(user.ID, string(body))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, item)
}

// ListUserFiles GET /api/v1/files — 列出用户文件（返回预签名 URL）。
func ListUserFiles(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	fileType := q.Get("fileType")
	items, total, err := service.ListUserFiles(user.ID, fileType, page, pageSize)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"items": items, "total": total})
}

// GetUserFileByID GET /api/v1/files/:id — 获取单个文件（返回预签名 URL）。
func GetUserFileByID(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	item, err := service.GetUserFile(id, user.ID)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, item)
}

// DeleteUserFile DELETE /api/v1/files/:id — 删除文件。
func DeleteUserFileHandler(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteUserFile(r.Context(), id, user.ID); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, true)
}

// UploadUserFileDirect POST /api/v1/files — 服务端直传（管理端素材等场景）。
func UploadUserFileDirect(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, userFileMaxBody+1)
	if err := r.ParseMultipartForm(userFileMaxBody); err != nil {
		Fail(w, "文件过大或上传格式不正确")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	fileType := r.FormValue("fileType")
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请上传文件")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		Fail(w, "文件读取失败")
		return
	}
	item, err := service.UploadUserFile(r.Context(), user.ID, fileType, header.Filename, header.Header.Get("Content-Type"), bytes.NewReader(content), int64(len(content)))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, item)
}

// ProxyUpload POST /api/v1/files/proxy-upload -- backend proxy: download external URL then upload to S3.
func ProxyUpload(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var req struct {
		URL      string `json:"url"`
		FileType string `json:"fileType"`
		FileName string `json:"fileName"`
	}
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil || req.URL == "" || req.FileName == "" {
		Fail(w, "请提供 url 和 fileName")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 4 * time.Minute}
	resp, err := client.Get(req.URL)
	if err != nil {
		log.Printf("proxy download: %v", err)
		Fail(w, "下载文件失败")
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("proxy read: %v", err)
		Fail(w, "读取文件失败")
		return
	}
	item, err := service.UploadUserFile(ctx, user.ID, req.FileType, req.FileName, resp.Header.Get("Content-Type"), bytes.NewReader(data), int64(len(data)))
	if err != nil {
		log.Printf("proxy upload: %v", err)
		Fail(w, err.Error())
		return
	}
	OK(w, item)
}

