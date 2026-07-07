package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
)

func Assets(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// SaveAsset 用户端保存素材（乐观锁）。body 携带 expectedUpdatedAt，过期返回 409 + current。
func SaveAsset(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	_ = user // model.Asset 暂不含 user_id 字段；鉴权用于后续审计与删除归属
	var body struct {
		model.Asset
		ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	result, err := service.SaveAssetWithLock(body.Asset, body.ExpectedUpdatedAt)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			Conflict(w, "资产已被其他会话修改", result)
			return
		}
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminAssets(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSaveAsset(w http.ResponseWriter, r *http.Request) {
	var item model.Asset
	_ = json.NewDecoder(r.Body).Decode(&item)
	result, err := service.SaveAsset(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteAsset(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAsset(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminUploadAssetImage POST /api/admin/assets/upload-image — 上传素材图片到 S3，返回预签名 URL。
func AdminUploadAssetImage(w http.ResponseWriter, r *http.Request) {
	const maxBytes = 30 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1)
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		Fail(w, "图片过大或上传格式不正确")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请选择图片文件")
		return
	}
	defer file.Close()
	url, err := service.UploadAssetImage(r.Context(), header.Filename, header.Header.Get("Content-Type"), file)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, map[string]string{"url": url})
}
