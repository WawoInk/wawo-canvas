package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func AdminVolcengineAssetConfig(w http.ResponseWriter, r *http.Request) {
	config, err := service.AdminVolcengineAssetConfig()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"config": config})
}

func AdminSaveVolcengineAssetConfig(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Config string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "配置 JSON 无效")
		return
	}
	config, err := service.SaveVolcengineAssetConfig(request.Config)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"config": config})
}

func VolcengineAssetOutbounds(w http.ResponseWriter, r *http.Request) {
	result, err := service.VolcengineAssetOutbounds()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func VolcengineAssetLocalUpload(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	limit := service.VolcengineAssetUploadSizeLimit()
	r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
	if err := r.ParseMultipartForm(limit); err != nil {
		Fail(w, "文件过大或上传格式不正确")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请选择本地素材文件")
		return
	}
	defer file.Close()
	result, err := service.VolcengineAssetLocalUpload(r.Context(), user, r.Header, r.URL.Query(), header.Filename, header.Header.Get("Content-Type"), r.FormValue("name"), r.FormValue("assetType"), header.Size, file)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func VolcengineAssetUserAction(w http.ResponseWriter, r *http.Request, action string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, err := readRequestBody(r)
	if err != nil {
		Fail(w, "请求 JSON 无效")
		return
	}
	result, err := service.VolcengineAssetUserAction(r.Context(), user, r.Header, r.URL.Query(), action, body)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func VolcengineAssetAdminGroupAction(w http.ResponseWriter, r *http.Request, action string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, err := readRequestBody(r)
	if err != nil {
		Fail(w, "请求 JSON 无效")
		return
	}
	result, err := service.VolcengineAssetAdminGroupAction(r.Context(), user, r.Header, r.URL.Query(), action, body)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func readRequestBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return []byte("{}"), nil
	}
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, 10<<20))
}
