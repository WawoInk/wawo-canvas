package handler

import (
	"bytes"
	"io"
	"net/http"
	"strconv"

	"github.com/basketikun/infinite-canvas/service"
)

const userFileMaxBody = 80 << 20

// UploadUserFile POST /api/v1/files — 上传文件。
func UploadUserFile(w http.ResponseWriter, r *http.Request) {
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

// ListUserFiles GET /api/v1/files — 列出用户文件。
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

// GetUserFileByID GET /api/v1/files/:id — 获取单个文件。
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
