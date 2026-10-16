package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type AdminExternalError struct {
	Status  int
	Message string
}

func (err *AdminExternalError) Error() string       { return err.Message }
func (err *AdminExternalError) SafeMessage() string { return err.Message }

func AdminExternalCreateEnterprise(input model.AdminExternalEnterpriseCreate) (model.EnterpriseView, error) {
	input.Name = strings.TrimSpace(input.Name)
	owner := model.User{Username: input.OwnerUsername, DisplayName: input.OwnerDisplayName, Role: model.UserRoleUser, Status: model.UserStatusActive}
	if input.Name == "" || len(input.Name) > 255 {
		return model.EnterpriseView{}, adminExternalInvalid("企业名称不能为空且不能超过 255 字节")
	}
	if err := validateAdminExternalUser(&owner, input.OwnerPassword, true); err != nil {
		return model.EnterpriseView{}, err
	}
	result, err := CreateEnterprise(CreateEnterpriseInput{Name: input.Name, OwnerUsername: owner.Username, OwnerPassword: input.OwnerPassword, OwnerDisplayName: owner.DisplayName})
	return result, adminExternalError(err)
}

func AdminExternalEnterprise(id string) (model.EnterpriseView, error) {
	if err := validateAdminExternalID(id); err != nil {
		return model.EnterpriseView{}, err
	}
	result, err := repository.GetEnterpriseView(id)
	return result, adminExternalError(err)
}

func AdminExternalUpdateEnterprise(id string, input model.AdminExternalEnterpriseUpdate) (model.EnterpriseView, error) {
	if err := validateAdminExternalID(id); err != nil {
		return model.EnterpriseView{}, err
	}
	updates := map[string]any{"updated_at": now()}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" || len(name) > 255 {
			return model.EnterpriseView{}, adminExternalInvalid("企业名称不能为空且不能超过 255 字节")
		}
		updates["name"] = name
	}
	if input.Status != nil {
		if *input.Status != model.EnterpriseStatusActive && *input.Status != model.EnterpriseStatusDisabled {
			return model.EnterpriseView{}, adminExternalInvalid("企业状态无效")
		}
		updates["status"] = *input.Status
	}
	if input.DiscountRate != nil {
		if input.DiscountRate.Exponent() < -1000 || input.DiscountRate.Exponent() > 1000 || input.DiscountRate.LessThan(model.MustDecimal("0.1")) || input.DiscountRate.GreaterThan(model.NewDecimal(1)) {
			return model.EnterpriseView{}, adminExternalInvalid("折扣倍率必须在 0.1 到 1 之间")
		}
		updates["discount_rate"] = *input.DiscountRate
	}
	if len(updates) == 1 {
		return model.EnterpriseView{}, adminExternalInvalid("请提供要更新的企业字段")
	}
	if err := repository.UpdateAdminExternalEnterprise(id, updates); err != nil {
		return model.EnterpriseView{}, adminExternalError(err)
	}
	return AdminExternalEnterprise(id)
}

func AdminExternalDeleteEnterprise(id string) error {
	if err := validateAdminExternalID(id); err != nil {
		return err
	}
	return adminExternalError(repository.DeleteAdminExternalEnterprise(id, now()))
}

func AdminExternalUsers(query model.Query) (model.AdminExternalUserList, error) {
	users, err := ListUsers(query)
	if err != nil {
		return model.AdminExternalUserList{}, err
	}
	items := make([]model.AdminExternalUser, len(users.Items))
	for i, user := range users.Items {
		items[i] = adminExternalUser(user)
	}
	return model.AdminExternalUserList{Items: items, Total: users.Total}, nil
}

func AdminExternalCreateUser(input model.AdminExternalUserCreate) (model.AdminExternalUser, error) {
	user := model.User{Username: input.Username, Email: input.Email, DisplayName: input.DisplayName, Role: input.Role, Status: input.Status}
	if user.Role == "" {
		user.Role = model.UserRoleUser
	}
	if user.Status == "" {
		user.Status = model.UserStatusActive
	}
	if err := validateAdminExternalUser(&user, input.Password, true); err != nil {
		return model.AdminExternalUser{}, err
	}
	if input.EnterpriseID != "" {
		if err := validateAdminExternalID(input.EnterpriseID); err != nil {
			return model.AdminExternalUser{}, err
		}
		if user.Role != model.UserRoleUser {
			return model.AdminExternalUser{}, adminExternalInvalid("企业账号的平台角色必须为 user")
		}
		role := model.EnterpriseRoleMember
		user.EnterpriseID, user.EnterpriseRole = &input.EnterpriseID, &role
	}
	var err error
	user.Password, err = hashPassword(input.Password)
	if err != nil {
		return model.AdminExternalUser{}, err
	}
	user.ID, user.AffCode, user.SessionVersion = newID("user"), newAffCode(), 1
	user.CreatedAt, user.UpdatedAt = now(), now()
	err = repository.CreateAdminExternalUser(user)
	return adminExternalUser(user), adminExternalError(err)
}

func AdminExternalUser(id string) (model.AdminExternalUser, error) {
	user, err := getAdminExternalUser(id)
	return adminExternalUser(user), err
}

func AdminExternalUpdateUser(id string, input model.AdminExternalUserUpdate) (model.AdminExternalUser, error) {
	user, err := getAdminExternalUser(id)
	if err != nil {
		return model.AdminExternalUser{}, err
	}
	if input.Username != nil {
		user.Username = *input.Username
	}
	if input.Email != nil {
		user.Email = *input.Email
	}
	if input.DisplayName != nil {
		user.DisplayName = *input.DisplayName
	}
	if input.Role != nil {
		user.Role = *input.Role
	}
	if input.Status != nil {
		user.Status = *input.Status
	}
	password := ""
	if input.Password != nil {
		password = *input.Password
	}
	if err := validateAdminExternalUser(&user, password, input.Password != nil); err != nil {
		return model.AdminExternalUser{}, err
	}
	updates := map[string]any{"updated_at": now()}
	if input.Username != nil {
		updates["username"] = user.Username
	}
	if input.Email != nil {
		updates["email"] = user.Email
	}
	if input.DisplayName != nil {
		updates["display_name"] = user.DisplayName
	}
	if input.Role != nil {
		updates["role"] = user.Role
	}
	if input.Status != nil {
		updates["status"] = user.Status
	}
	if input.Password != nil {
		hash, err := hashPassword(password)
		if err != nil {
			return model.AdminExternalUser{}, err
		}
		updates["password"] = hash
	}
	if len(updates) == 1 {
		return model.AdminExternalUser{}, adminExternalInvalid("请提供要更新的用户字段")
	}
	user, err = repository.UpdateAdminExternalUser(id, updates)
	return adminExternalUser(user), adminExternalError(err)
}

func AdminExternalDeleteUser(id string) error {
	if err := validateAdminExternalID(id); err != nil {
		return err
	}
	return adminExternalError(repository.DeleteAdminExternalUser(id))
}

func AdminExternalAdjustCredits(targetType, id, actorID string, input model.AdminCreditAdjustmentInput) (model.AdminCreditAdjustment, error) {
	if err := validateAdminExternalID(id); err != nil {
		return model.AdminCreditAdjustment{}, err
	}
	if targetType != "enterprise" && targetType != "user" {
		return model.AdminCreditAdjustment{}, adminExternalInvalid("积分调整对象无效")
	}
	delta, err := validateAdminCreditAdjustment(&input)
	if err != nil {
		return model.AdminCreditAdjustment{}, err
	}
	// The target distinguishes an enterprise adjustment from a direct owner-user adjustment.
	extra, _ := json.Marshal(map[string]string{"targetType": targetType, "targetId": id})
	log, err := repository.AdjustAdminExternalCredits(targetType, id, delta, model.CreditLog{
		ID: newID("credit"), Type: model.CreditLogTypeAdminAdjust, RequestID: input.RequestID,
		RelatedID: actorID, Remark: input.Reason, Extra: string(extra), CreatedAt: now(),
	})
	if err != nil {
		return model.AdminCreditAdjustment{}, adminExternalError(err)
	}
	result := model.AdminCreditAdjustment{RequestID: log.RequestID, UserID: log.UserID, Delta: log.Amount, Balance: log.Balance, Reason: log.Remark, CreatedAt: log.CreatedAt}
	if targetType == "enterprise" {
		result.EnterpriseID = id
	}
	return result, nil
}

func validateAdminCreditAdjustment(input *model.AdminCreditAdjustmentInput) (model.Decimal, error) {
	input.RequestID, input.Reason = strings.TrimSpace(input.RequestID), strings.TrimSpace(input.Reason)
	if input.RequestID == "" || len(input.RequestID) > 128 || strings.IndexFunc(input.RequestID, unicode.IsControl) >= 0 {
		return model.DecimalZero, adminExternalInvalid("请求 ID 不能为空且不能超过 128 字节")
	}
	if input.Reason == "" || len(input.Reason) > 1024 {
		return model.DecimalZero, adminExternalInvalid("调整原因不能为空且不能超过 1024 字节")
	}
	if len(input.Delta) > 128 {
		return model.DecimalZero, adminExternalInvalid("积分数量无效")
	}
	delta, err := decimal.NewFromString(input.Delta)
	if err != nil || delta.IsZero() || delta.Exponent() < -1000 || delta.Exponent() > 1000 {
		return model.DecimalZero, adminExternalInvalid("积分数量必须为有效的非零十进制字符串")
	}
	return delta, nil
}

func validateAdminExternalUser(user *model.User, password string, requirePassword bool) error {
	user.Username, user.Email, user.DisplayName = strings.TrimSpace(user.Username), strings.TrimSpace(user.Email), strings.TrimSpace(user.DisplayName)
	if user.Username == "" || len(user.Username) > 128 || strings.IndexFunc(user.Username, unicode.IsSpace) >= 0 || strings.IndexFunc(user.Username, unicode.IsControl) >= 0 {
		return adminExternalInvalid("用户名不能为空、不能包含空白字符且不能超过 128 字节")
	}
	if len(user.DisplayName) > 255 || len(user.Email) > 254 {
		return adminExternalInvalid("显示名称或邮箱过长")
	}
	if user.Email != "" {
		address, err := mail.ParseAddress(user.Email)
		if err != nil || address.Address != user.Email {
			return adminExternalInvalid("邮箱格式不正确")
		}
	}
	if user.Role != model.UserRoleUser && user.Role != model.UserRoleAdmin {
		return adminExternalInvalid("用户角色无效")
	}
	if user.EnterpriseID != nil && user.Role != model.UserRoleUser {
		return adminExternalInvalid("企业账号的平台角色必须为 user")
	}
	if user.Status != model.UserStatusActive && user.Status != model.UserStatusBan {
		return adminExternalInvalid("用户状态无效")
	}
	if (requirePassword && password == "") || len(password) > 72 {
		return adminExternalInvalid("密码不能为空且不能超过 72 字节")
	}
	return nil
}

func validateAdminExternalID(id string) error {
	if id == "" || len(id) > 128 || strings.IndexFunc(id, unicode.IsSpace) >= 0 || strings.IndexFunc(id, unicode.IsControl) >= 0 || strings.ContainsAny(id, "/\\") {
		return adminExternalInvalid("资源 ID 无效")
	}
	return nil
}

func getAdminExternalUser(id string) (model.User, error) {
	if err := validateAdminExternalID(id); err != nil {
		return model.User{}, err
	}
	user, found, err := repository.GetUserByID(id)
	if err == nil && !found {
		err = gorm.ErrRecordNotFound
	}
	return user, adminExternalError(err)
}

func adminExternalUser(user model.User) model.AdminExternalUser {
	return model.AdminExternalUser{
		ID: user.ID, Username: user.Username, Email: user.Email, DisplayName: user.DisplayName, AvatarURL: user.AvatarURL,
		Role: user.Role, Status: user.Status, Credits: user.Credits, EnterpriseID: user.EnterpriseID, EnterpriseRole: user.EnterpriseRole,
		CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt,
	}
}

func adminExternalInvalid(message string) error {
	return &AdminExternalError{Status: http.StatusBadRequest, Message: message}
}

func adminExternalError(err error) error {
	if err == nil {
		return nil
	}
	var external *AdminExternalError
	if errors.As(err, &external) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, repository.ErrEnterpriseNotFound) {
		return &AdminExternalError{Status: http.StatusNotFound, Message: "用户或企业不存在"}
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return adminExternalInvalid("积分余额不足")
	}
	if errors.Is(err, repository.ErrCreditTransferRequestConflict) {
		return &AdminExternalError{Status: http.StatusConflict, Message: "请求 ID 已被其他积分操作使用"}
	}
	if errors.Is(err, repository.ErrAdminExternalOwnerDelete) {
		return &AdminExternalError{Status: http.StatusConflict, Message: "企业主账号不能单独删除，请先删除所属企业"}
	}
	if errors.Is(err, repository.ErrAdminExternalSharedContent) {
		return &AdminExternalError{Status: http.StatusConflict, Message: "仍有企业共享素材或文件，请先清理后删除"}
	}
	if errors.Is(err, repository.ErrAdminCreditLogImmutable) {
		return &AdminExternalError{Status: http.StatusConflict, Message: "外部积分调整流水不能修改或删除"}
	}
	if errors.Is(err, errUsernameExists) {
		return &AdminExternalError{Status: http.StatusConflict, Message: errUsernameExists.SafeMessage()}
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return &AdminExternalError{Status: http.StatusConflict, Message: "用户名、记录或请求 ID 已存在"}
	}
	var safe interface{ SafeMessage() string }
	if errors.As(err, &safe) {
		return adminExternalInvalid(safe.SafeMessage())
	}
	return err
}
