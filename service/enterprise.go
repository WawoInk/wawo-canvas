package service

import (
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type CreateEnterpriseInput struct {
	Name             string
	OwnerUsername    string
	OwnerPassword    string
	OwnerDisplayName string
}

type CreateEnterpriseMemberInput struct {
	Username    string
	Password    string
	DisplayName string
	Email       string
}

func CreateEnterprise(input CreateEnterpriseInput) (model.EnterpriseView, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.OwnerUsername = strings.TrimSpace(input.OwnerUsername)
	if input.Name == "" || input.OwnerUsername == "" || input.OwnerPassword == "" {
		return model.EnterpriseView{}, safeMessageError{message: "企业名称、主账号用户名和密码不能为空"}
	}
	if strings.ContainsAny(input.OwnerUsername, " \t\r\n") {
		return model.EnterpriseView{}, safeMessageError{message: "用户名不能包含空格"}
	}
	if _, exists, err := repository.GetUserByUsername(input.OwnerUsername); err != nil {
		return model.EnterpriseView{}, err
	} else if exists {
		return model.EnterpriseView{}, safeMessageError{message: "用户名已存在"}
	}
	hash, err := hashPassword(input.OwnerPassword)
	if err != nil {
		return model.EnterpriseView{}, err
	}
	now := now()
	enterpriseID := newID("enterprise")
	ownerID := newID("user")
	ownerRole := model.EnterpriseRoleOwner
	enterprise := model.Enterprise{ID: enterpriseID, Name: input.Name, Status: model.EnterpriseStatusActive, OwnerID: ownerID, CreatedAt: now, UpdatedAt: now}
	owner := model.User{
		ID: ownerID, Username: input.OwnerUsername, Password: hash, DisplayName: strings.TrimSpace(input.OwnerDisplayName), Role: model.UserRoleUser,
		AffCode: newAffCode(), Status: model.UserStatusActive, EnterpriseID: &enterpriseID, EnterpriseRole: &ownerRole, SessionVersion: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateEnterpriseWithOwner(&enterprise, &owner); err != nil {
		return model.EnterpriseView{}, err
	}
	return model.EnterpriseView{Enterprise: enterprise, OwnerName: owner.Username, OwnerStatus: owner.Status, OwnerCredits: owner.Credits}, nil
}

func ListEnterpriseMembers(current model.AuthUser, q model.Query) (model.EnterpriseMemberList, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseMemberList{}, err
	}
	users, total, err := repository.ListEnterpriseMembers(enterpriseID, q)
	if err != nil {
		return model.EnterpriseMemberList{}, err
	}
	items := make([]model.EnterpriseMember, len(users))
	for i := range users {
		items[i] = enterpriseMember(users[i])
	}
	return model.EnterpriseMemberList{Items: items, Total: int(total)}, nil
}

func CreateEnterpriseMember(current model.AuthUser, input CreateEnterpriseMemberInput) (model.EnterpriseMember, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	memberRole := model.EnterpriseRoleMember
	user, err := SaveUser(model.User{
		Username: input.Username, DisplayName: input.DisplayName, Email: input.Email, Role: model.UserRoleUser,
		Status: model.UserStatusActive, EnterpriseID: &enterpriseID, EnterpriseRole: &memberRole,
	}, input.Password)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	return enterpriseMember(user), nil
}

func SetEnterpriseMemberStatus(current model.AuthUser, id string, status model.UserStatus) (model.EnterpriseMember, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	if status != model.UserStatusActive && status != model.UserStatusBan {
		return model.EnterpriseMember{}, safeMessageError{message: "账号状态无效"}
	}
	member, ok, err := repository.GetEnterpriseMember(enterpriseID, id)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	if !ok {
		return model.EnterpriseMember{}, safeMessageError{message: "成员不存在或无权操作"}
	}
	member.Status = status
	member.UpdatedAt = now()
	member, err = repository.SaveUser(member)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	return enterpriseMember(member), nil
}

func ResetEnterpriseMemberPassword(current model.AuthUser, id, password string) (model.EnterpriseMember, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	if password == "" {
		return model.EnterpriseMember{}, safeMessageError{message: "密码不能为空"}
	}
	member, ok, err := repository.GetEnterpriseMember(enterpriseID, id)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	if !ok {
		return model.EnterpriseMember{}, safeMessageError{message: "成员不存在或无权操作"}
	}
	member, err = SaveUser(member, password)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	return enterpriseMember(member), nil
}

func enterpriseOwnerID(current model.AuthUser) (string, error) {
	if current.EnterpriseID == "" || current.EnterpriseRole != model.EnterpriseRoleOwner {
		return "", safeMessageError{message: "仅企业主账号可管理成员"}
	}
	return current.EnterpriseID, nil
}

func enterpriseMember(user model.User) model.EnterpriseMember {
	member := model.EnterpriseMember{
		ID: user.ID, Username: user.Username, Email: user.Email, DisplayName: user.DisplayName, Status: user.Status,
		Credits: user.Credits, Role: user.Role, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt,
	}
	if user.EnterpriseID != nil {
		member.EnterpriseID = *user.EnterpriseID
	}
	if user.EnterpriseRole != nil {
		member.EnterpriseRole = *user.EnterpriseRole
	}
	return member
}

func ListEnterprises(q model.Query) (model.EnterpriseList, error) {
	items, total, err := repository.ListEnterprises(q)
	return model.EnterpriseList{Items: items, Total: int(total)}, err
}

func SetEnterpriseStatus(id string, status model.EnterpriseStatus) (model.EnterpriseView, error) {
	if status != model.EnterpriseStatusActive && status != model.EnterpriseStatusDisabled {
		return model.EnterpriseView{}, safeMessageError{message: "企业状态无效"}
	}
	if err := repository.UpdateEnterpriseStatus(id, status, now()); err != nil {
		return model.EnterpriseView{}, err
	}
	return repository.GetEnterpriseView(id)
}

func SetEnterpriseOwnerStatus(id string, status model.UserStatus) (model.EnterpriseView, error) {
	if status != model.UserStatusActive && status != model.UserStatusBan {
		return model.EnterpriseView{}, safeMessageError{message: "账号状态无效"}
	}
	if err := repository.UpdateEnterpriseOwnerStatus(id, status, now()); err != nil {
		return model.EnterpriseView{}, err
	}
	return repository.GetEnterpriseView(id)
}

func ResetEnterpriseOwnerPassword(id, password string) (model.EnterpriseView, error) {
	if password == "" {
		return model.EnterpriseView{}, safeMessageError{message: "密码不能为空"}
	}
	hash, err := hashPassword(password)
	if err != nil {
		return model.EnterpriseView{}, err
	}
	if err := repository.UpdateEnterpriseOwnerPassword(id, hash, now()); err != nil {
		return model.EnterpriseView{}, err
	}
	return repository.GetEnterpriseView(id)
}
