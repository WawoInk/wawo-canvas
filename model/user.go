package model

type UserRole string

const (
	UserRoleGuest UserRole = "guest"
	UserRoleUser  UserRole = "user"
	UserRoleAdmin UserRole = "admin"
)

type UserStatus string

const (
	UserStatusActive UserStatus = "active"
	UserStatusBan    UserStatus = "ban"
)

// User 系统用户。
type User struct {
	ID             string          `json:"id" gorm:"primaryKey"`
	Username       string          `json:"username" gorm:"uniqueIndex"`
	Password       string          `json:"password,omitempty"`
	Email          string          `json:"email"`
	DisplayName    string          `json:"displayName"`
	AvatarURL      string          `json:"avatarUrl"`
	Role           UserRole        `json:"role"`
	Credits        Decimal         `json:"credits" gorm:"type:numeric;not null;default:0;check:chk_users_credits_nonnegative,credits >= 0"`
	AffCode        string          `json:"affCode" gorm:"uniqueIndex"`
	AffCount       int             `json:"affCount"`
	InviterID      string          `json:"inviterId"`
	GithubID       string          `json:"githubId"`
	LinuxDoID      string          `json:"linuxDoId" gorm:"index"`
	WechatID       string          `json:"wechatId"`
	Status         UserStatus      `json:"status"`
	EnterpriseID   *string         `json:"enterpriseId,omitempty" gorm:"index;uniqueIndex:idx_users_enterprise_owner,where:enterprise_role = 'owner';check:chk_users_enterprise_identity,(enterprise_id IS NULL AND enterprise_role IS NULL) OR (enterprise_id IS NOT NULL AND enterprise_role IS NOT NULL)"`
	EnterpriseName string          `json:"enterpriseName,omitempty" gorm:"->;-:migration"`
	EnterpriseRole *EnterpriseRole `json:"enterpriseRole,omitempty" gorm:"check:enterprise_role IS NULL OR enterprise_role IN ('owner','member')"`
	SessionVersion int             `json:"-" gorm:"not null;default:1"`
	LastLoginAt    string          `json:"lastLoginAt"`
	Extra          string          `json:"extra" gorm:"type:text"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

// UserList 用户分页结果。
type UserList struct {
	Items []User `json:"items"`
	Total int    `json:"total"`
}

// AuthUser 用户公开信息。
type AuthUser struct {
	ID               string           `json:"id"`
	Username         string           `json:"username"`
	Email            string           `json:"email"`
	DisplayName      string           `json:"displayName"`
	AvatarURL        string           `json:"avatarUrl"`
	Role             UserRole         `json:"role"`
	Credits          Decimal          `json:"credits"`
	EnterpriseID     string           `json:"enterpriseId,omitempty"`
	EnterpriseName   string           `json:"enterpriseName,omitempty"`
	EnterpriseRole   EnterpriseRole   `json:"enterpriseRole,omitempty"`
	EnterpriseStatus EnterpriseStatus `json:"enterpriseStatus,omitempty"`
	CreatedAt        string           `json:"createdAt"`
	UpdatedAt        string           `json:"updatedAt"`
}

// AuthSession 登录会话信息。
type AuthSession struct {
	Token string   `json:"token"`
	User  AuthUser `json:"user"`
}

func PublicUser(user User) AuthUser {
	result := AuthUser{
		ID:          user.ID,
		Username:    user.Username,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Role:        user.Role,
		Credits:     user.Credits,
		CreatedAt:   user.CreatedAt,
		UpdatedAt:   user.UpdatedAt,
	}
	if user.EnterpriseID != nil {
		result.EnterpriseID = *user.EnterpriseID
	}
	if user.EnterpriseRole != nil {
		result.EnterpriseRole = *user.EnterpriseRole
	}
	return result
}

type CreditLogType string

const (
	CreditLogTypeAdminAdjust        CreditLogType = "admin_adjust"
	CreditLogTypeAIConsume          CreditLogType = "ai_consume"
	CreditLogTypeAIRefund           CreditLogType = "ai_refund"
	CreditLogTypeEnterpriseAllocate CreditLogType = "enterprise_allocate"
	CreditLogTypeEnterpriseReclaim  CreditLogType = "enterprise_reclaim"
)

// CreditLog 用户算力点变更流水。
type CreditLog struct {
	ID             string        `json:"id" gorm:"primaryKey"`
	UserID         string        `json:"userId" gorm:"index"`
	TaskID         string        `json:"taskId" gorm:"index"`
	RequestID      string        `json:"-" gorm:"not null;default:''"`
	Type           CreditLogType `json:"type"`
	Amount         Decimal       `json:"amount" gorm:"type:numeric;not null;default:0"`
	Balance        Decimal       `json:"balance" gorm:"type:numeric;not null;default:0"`
	RelatedID      string        `json:"relatedId"`
	CounterpartyID string        `json:"counterpartyId" gorm:"index"`
	Remark         string        `json:"remark"`
	Extra          string        `json:"extra" gorm:"type:text"`
	CreatedAt      string        `json:"createdAt"`
}

type CreditLogList struct {
	Items []CreditLog `json:"items"`
	Total int         `json:"total"`
}
