package model

type EnterpriseStatus string

const (
	EnterpriseStatusActive   EnterpriseStatus = "active"
	EnterpriseStatusDisabled EnterpriseStatus = "disabled"
)

type EnterpriseRole string

const (
	EnterpriseRoleOwner  EnterpriseRole = "owner"
	EnterpriseRoleMember EnterpriseRole = "member"
)

type EnterpriseCreditAction string

const (
	EnterpriseCreditActionAllocate EnterpriseCreditAction = "allocate"
	EnterpriseCreditActionReclaim  EnterpriseCreditAction = "reclaim"
)

type Enterprise struct {
	ID           string           `json:"id" gorm:"primaryKey"`
	Name         string           `json:"name"`
	Status       EnterpriseStatus `json:"status" gorm:"not null;check:status IN ('active','disabled')"`
	OwnerID      string           `json:"ownerId" gorm:"not null;uniqueIndex"`
	DiscountRate Decimal          `json:"discountRate" gorm:"type:numeric;not null;default:1;check:chk_enterprises_discount_rate,discount_rate >= 0.1 AND discount_rate <= 1"`
	CreatedAt    string           `json:"createdAt"`
	UpdatedAt    string           `json:"updatedAt"`
}

type EnterpriseView struct {
	Enterprise
	OwnerName    string     `json:"ownerName"`
	OwnerStatus  UserStatus `json:"ownerStatus"`
	OwnerCredits Decimal    `json:"ownerCredits"`
	MemberCount  int        `json:"memberCount"`
}

type EnterpriseList struct {
	Items []EnterpriseView `json:"items"`
	Total int              `json:"total"`
}

type EnterpriseAccountSummary struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Status       EnterpriseStatus `json:"status"`
	Role         EnterpriseRole   `json:"role"`
	MemberCount  int              `json:"memberCount"`
	DiscountRate Decimal          `json:"discountRate"`
}

// EnterpriseMember 企业成员管理视图。
type EnterpriseMember struct {
	ID             string         `json:"id"`
	Username       string         `json:"username"`
	Email          string         `json:"email"`
	DisplayName    string         `json:"displayName"`
	Status         UserStatus     `json:"status"`
	Credits        Decimal        `json:"credits"`
	Role           UserRole       `json:"role"`
	EnterpriseID   string         `json:"enterpriseId"`
	EnterpriseRole EnterpriseRole `json:"enterpriseRole"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
}

type EnterpriseMemberList struct {
	Items []EnterpriseMember `json:"items"`
	Total int                `json:"total"`
}

type EnterpriseCreditTransfer struct {
	RequestID    string                 `json:"requestId"`
	Action       EnterpriseCreditAction `json:"action"`
	Amount       Decimal                `json:"amount"`
	OwnerCredits Decimal                `json:"ownerCredits"`
	Member       EnterpriseMember       `json:"member"`
}

// EnterpriseCreditLog 企业范围的积分流水，附带流水所属账号信息。
type EnterpriseCreditLog struct {
	CreditLog
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type EnterpriseCreditLogList struct {
	Items []EnterpriseCreditLog `json:"items"`
	Total int                   `json:"total"`
}
