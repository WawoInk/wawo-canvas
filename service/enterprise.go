package service

import (
	"errors"
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

func TransferEnterpriseMemberCredits(current model.AuthUser, id string, action model.EnterpriseCreditAction, amount model.Decimal, requestID string) (model.EnterpriseCreditTransfer, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseCreditTransfer{}, err
	}
	requestID = strings.TrimSpace(requestID)
	if action != model.EnterpriseCreditActionAllocate && action != model.EnterpriseCreditActionReclaim {
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: "积分操作无效"}
	}
	if !amount.IsPositive() {
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: "积分数量必须为正数"}
	}
	if requestID == "" || len(requestID) > 128 {
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: "请求 ID 无效"}
	}
	owner, member, err := repository.TransferEnterpriseMemberCredits(enterpriseID, current.ID, id, action, amount, requestID, now())
	if errors.Is(err, repository.ErrEnterpriseMemberNotFound) {
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: "成员不存在或无权操作"}
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		message := "主账号余额不足"
		if action == model.EnterpriseCreditActionReclaim {
			message = "成员余额不足"
		}
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: message}
	}
	if errors.Is(err, repository.ErrCreditTransferRequestConflict) {
		return model.EnterpriseCreditTransfer{}, safeMessageError{message: "请求 ID 已被其他积分操作使用"}
	}
	if err != nil {
		return model.EnterpriseCreditTransfer{}, err
	}
	return model.EnterpriseCreditTransfer{RequestID: requestID, Action: action, Amount: amount, OwnerCredits: owner.Credits, Member: enterpriseMember(member)}, nil
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
		return model.EnterpriseView{}, errUsernameExists
	}
	hash, err := hashPassword(input.OwnerPassword)
	if err != nil {
		return model.EnterpriseView{}, err
	}
	now := now()
	enterpriseID := newID("enterprise")
	ownerID := newID("user")
	ownerRole := model.EnterpriseRoleOwner
	enterprise := model.Enterprise{ID: enterpriseID, Name: input.Name, Status: model.EnterpriseStatusActive, OwnerID: ownerID, DiscountRate: model.NewDecimal(1), CreatedAt: now, UpdatedAt: now}
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

func ListEnterpriseCreditLogs(current model.AuthUser, memberID string, q model.Query) (model.EnterpriseCreditLogList, error) {
	enterpriseID, err := enterpriseOwnerID(current)
	if err != nil {
		return model.EnterpriseCreditLogList{}, err
	}
	items, total, err := repository.ListEnterpriseCreditLogs(enterpriseID, memberID, q)
	if err != nil {
		return model.EnterpriseCreditLogList{}, err
	}
	return model.EnterpriseCreditLogList{Items: items, Total: int(total)}, nil
}

func ListAdminEnterpriseCreditLogs(q model.AdminEnterpriseCreditLogQuery) (model.AdminEnterpriseCreditLogList, error) {
	items, total, err := repository.ListAdminEnterpriseCreditLogs(q)
	if err != nil {
		return model.AdminEnterpriseCreditLogList{}, err
	}
	return model.AdminEnterpriseCreditLogList{Items: items, Total: int(total)}, nil
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
	member, err = updateExistingUser(member, map[string]any{"status": status, "updated_at": now()})
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
	hash, err := hashPassword(password)
	if err != nil {
		return model.EnterpriseMember{}, err
	}
	member, err = updateExistingUser(member, map[string]any{"password": hash, "updated_at": now()})
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

func SetEnterpriseDiscountRate(id string, discountRate model.Decimal) (model.EnterpriseView, error) {
	if discountRate.LessThan(model.MustDecimal("0.1")) || discountRate.GreaterThan(model.NewDecimal(1)) {
		return model.EnterpriseView{}, safeMessageError{message: "折扣倍率必须在 0.1 到 1 之间"}
	}
	if err := repository.UpdateEnterpriseDiscountRate(id, discountRate, now()); err != nil {
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

func AdjustEnterpriseOwnerCredits(id, actorID string, delta model.Decimal, reason string) (model.EnterpriseView, error) {
	reason = strings.TrimSpace(reason)
	if delta.IsZero() {
		return model.EnterpriseView{}, safeMessageError{message: "调整数量不能为 0"}
	}
	if reason == "" {
		return model.EnterpriseView{}, safeMessageError{message: "调整原因不能为空"}
	}
	err := repository.AdjustEnterpriseOwnerCredits(id, actorID, delta, reason, now(), newID("credit"))
	if errors.Is(err, repository.ErrEnterpriseNotFound) {
		return model.EnterpriseView{}, safeMessageError{message: "企业不存在"}
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return model.EnterpriseView{}, safeMessageError{message: "主账号余额不足"}
	}
	if err != nil {
		return model.EnterpriseView{}, err
	}
	return repository.GetEnterpriseView(id)
}
