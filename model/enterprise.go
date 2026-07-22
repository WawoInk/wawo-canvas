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

type Enterprise struct {
	ID        string           `json:"id" gorm:"primaryKey"`
	Name      string           `json:"name"`
	Status    EnterpriseStatus `json:"status" gorm:"not null;check:status IN ('active','disabled')"`
	OwnerID   string           `json:"ownerId" gorm:"not null;uniqueIndex"`
	CreatedAt string           `json:"createdAt"`
	UpdatedAt string           `json:"updatedAt"`
}

type EnterpriseView struct {
	Enterprise
	OwnerName    string     `json:"ownerName"`
	OwnerStatus  UserStatus `json:"ownerStatus"`
	OwnerCredits int        `json:"ownerCredits"`
	MemberCount  int        `json:"memberCount"`
}

type EnterpriseList struct {
	Items []EnterpriseView `json:"items"`
	Total int              `json:"total"`
}
