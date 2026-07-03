package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
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

// AdminUploadAssetImage POST /api/admin/assets/upload-image — 上传素材图片到 S3，返回 URL。
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
