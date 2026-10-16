package model

// AdminKeyRecord 只保存密钥摘要，独立于 public/private 设置。
type AdminKeyRecord struct {
	Hash      string `json:"hash"`
	UserID    string `json:"userId"`
	CreatedAt string `json:"createdAt"`
}

type AdminKeyStatus struct {
	Enabled   bool   `json:"enabled"`
	CreatedAt string `json:"createdAt,omitempty"`
	Key       string `json:"key,omitempty"`
}
