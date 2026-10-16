package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func AdminExternalEnterprises(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListEnterprises(parseQuery(r))
	respondAdminExternal(w, result, err)
}

func AdminExternalCreateEnterprise(w http.ResponseWriter, r *http.Request) {
	var input model.AdminExternalEnterpriseCreate
	if !decodeAdminExternal(w, r, &input) {
		return
	}
	result, err := service.AdminExternalCreateEnterprise(input)
	respondAdminExternal(w, result, err)
}

func AdminExternalEnterprise(w http.ResponseWriter, r *http.Request, id string) {
	result, err := service.AdminExternalEnterprise(id)
	respondAdminExternal(w, result, err)
}

func AdminExternalUpdateEnterprise(w http.ResponseWriter, r *http.Request, id string) {
	var input model.AdminExternalEnterpriseUpdate
	if !decodeAdminExternal(w, r, &input) {
		return
	}
	result, err := service.AdminExternalUpdateEnterprise(id, input)
	respondAdminExternal(w, result, err)
}

func AdminExternalDeleteEnterprise(w http.ResponseWriter, r *http.Request, id string) {
	err := service.AdminExternalDeleteEnterprise(id)
	respondAdminExternal(w, true, err)
}

func AdminExternalUsers(w http.ResponseWriter, r *http.Request) {
	result, err := service.AdminExternalUsers(parseQuery(r))
	respondAdminExternal(w, result, err)
}

func AdminExternalCreateUser(w http.ResponseWriter, r *http.Request) {
	var input model.AdminExternalUserCreate
	if !decodeAdminExternal(w, r, &input) {
		return
	}
	result, err := service.AdminExternalCreateUser(input)
	respondAdminExternal(w, result, err)
}

func AdminExternalUser(w http.ResponseWriter, r *http.Request, id string) {
	result, err := service.AdminExternalUser(id)
	respondAdminExternal(w, result, err)
}

func AdminExternalUpdateUser(w http.ResponseWriter, r *http.Request, id string) {
	var input model.AdminExternalUserUpdate
	if !decodeAdminExternal(w, r, &input) {
		return
	}
	result, err := service.AdminExternalUpdateUser(id, input)
	respondAdminExternal(w, result, err)
}

func AdminExternalDeleteUser(w http.ResponseWriter, r *http.Request, id string) {
	err := service.AdminExternalDeleteUser(id)
	respondAdminExternal(w, true, err)
}

func AdminExternalAdjustEnterpriseCredits(w http.ResponseWriter, r *http.Request, id string) {
	adminExternalAdjustCredits(w, r, "enterprise", id)
}

func AdminExternalAdjustUserCredits(w http.ResponseWriter, r *http.Request, id string) {
	adminExternalAdjustCredits(w, r, "user", id)
}

func adminExternalAdjustCredits(w http.ResponseWriter, r *http.Request, targetType, id string) {
	var input model.AdminCreditAdjustmentInput
	if !decodeAdminExternal(w, r, &input) {
		return
	}
	actor, _ := service.UserFromContext(r.Context())
	result, err := service.AdminExternalAdjustCredits(targetType, id, actor.ID, input)
	respondAdminExternal(w, result, err)
}

func decodeAdminExternal(w http.ResponseWriter, r *http.Request, input any) bool {
	w.Header().Set("Content-Type", "application/json")
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		Fail(w, "请求 JSON 无效或包含不支持的字段")
		return false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		w.WriteHeader(http.StatusBadRequest)
		Fail(w, "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}

func respondAdminExternal(w http.ResponseWriter, result any, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err == nil {
		OK(w, result)
		return
	}
	var external *service.AdminExternalError
	if errors.As(err, &external) {
		w.WriteHeader(external.Status)
		Fail(w, external.Message)
		return
	}
	w.WriteHeader(http.StatusInternalServerError)
	FailError(w, err)
}
