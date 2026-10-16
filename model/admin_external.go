package model

type AdminExternalUser struct {
	ID             string          `json:"id"`
	Username       string          `json:"username"`
	Email          string          `json:"email"`
	DisplayName    string          `json:"displayName"`
	AvatarURL      string          `json:"avatarUrl"`
	Role           UserRole        `json:"role"`
	Status         UserStatus      `json:"status"`
	Credits        Decimal         `json:"credits"`
	EnterpriseID   *string         `json:"enterpriseId,omitempty"`
	EnterpriseRole *EnterpriseRole `json:"enterpriseRole,omitempty"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

type AdminExternalUserList struct {
	Items []AdminExternalUser `json:"items"`
	Total int                 `json:"total"`
}

type AdminExternalUserCreate struct {
	Username     string     `json:"username"`
	Password     string     `json:"password"`
	Email        string     `json:"email"`
	DisplayName  string     `json:"displayName"`
	Role         UserRole   `json:"role"`
	Status       UserStatus `json:"status"`
	EnterpriseID string     `json:"enterpriseId"`
}

type AdminExternalUserUpdate struct {
	Username    *string     `json:"username"`
	Password    *string     `json:"password"`
	Email       *string     `json:"email"`
	DisplayName *string     `json:"displayName"`
	Role        *UserRole   `json:"role"`
	Status      *UserStatus `json:"status"`
}

type AdminExternalEnterpriseCreate struct {
	Name             string `json:"name"`
	OwnerUsername    string `json:"ownerUsername"`
	OwnerPassword    string `json:"ownerPassword"`
	OwnerDisplayName string `json:"ownerDisplayName"`
}

type AdminExternalEnterpriseUpdate struct {
	Name         *string           `json:"name"`
	Status       *EnterpriseStatus `json:"status"`
	DiscountRate *Decimal          `json:"discountRate"`
}

type AdminCreditAdjustmentInput struct {
	Delta     string `json:"delta"`
	Reason    string `json:"reason"`
	RequestID string `json:"requestId"`
}

type AdminCreditAdjustment struct {
	RequestID    string  `json:"requestId"`
	UserID       string  `json:"userId"`
	EnterpriseID string  `json:"enterpriseId,omitempty"`
	Delta        Decimal `json:"delta"`
	Balance      Decimal `json:"balance"`
	Reason       string  `json:"reason"`
	CreatedAt    string  `json:"createdAt"`
}
