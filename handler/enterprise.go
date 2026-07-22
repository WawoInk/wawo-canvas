package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func AdminCreateEnterprise(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name             string `json:"name"`
		OwnerUsername    string `json:"ownerUsername"`
		OwnerPassword    string `json:"ownerPassword"`
		OwnerDisplayName string `json:"ownerDisplayName"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, err := service.CreateEnterprise(service.CreateEnterpriseInput{
		Name: body.Name, OwnerUsername: body.OwnerUsername, OwnerPassword: body.OwnerPassword, OwnerDisplayName: body.OwnerDisplayName,
	})
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminEnterprises(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListEnterprises(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSetEnterpriseStatus(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, err := service.SetEnterpriseStatus(id, model.EnterpriseStatus(body.Status))
	respondEnterprise(w, result, err)
}

func AdminSetEnterpriseOwnerStatus(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, err := service.SetEnterpriseOwnerStatus(id, model.UserStatus(body.Status))
	respondEnterprise(w, result, err)
}

func AdminResetEnterpriseOwnerPassword(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, err := service.ResetEnterpriseOwnerPassword(id, body.Password)
	respondEnterprise(w, result, err)
}

func AdminAdjustEnterpriseOwnerCredits(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Delta  int    `json:"delta"`
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, err := service.AdjustEnterpriseOwnerCredits(id, user.ID, body.Delta, body.Reason)
	respondEnterprise(w, result, err)
}

func respondEnterprise(w http.ResponseWriter, result model.EnterpriseView, err error) {
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
