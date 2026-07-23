package model

// UserFile 用户或企业上传的文件记录。
type UserFile struct {
	ID           string  `json:"id" gorm:"primaryKey"`
	UserID       string  `json:"userId" gorm:"index"`
	EnterpriseID *string `json:"enterpriseId,omitempty" gorm:"index"`
	FileType     string  `json:"fileType" gorm:"index"` // "images" | "videos" | "audios" | "prompts"
	S3Key        string  `json:"-"`
	URL          string  `json:"url,omitempty" gorm:"-"`
	OriginalName string  `json:"originalName"`
	MimeType     string  `json:"mimeType"`
	Bytes        int64   `json:"bytes"`
	CreatedAt    string  `json:"createdAt"`
}

type UserFileList struct {
	Items []UserFile `json:"items"`
	Total int64      `json:"total"`
}
