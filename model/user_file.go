package model

// UserFile 用户上传文件记录，S3 Key 路径为 {type}/{userID}/{id}。
type UserFile struct {
	ID           string `json:"id" gorm:"primaryKey"`
	UserID       string `json:"userId" gorm:"index"`
	FileType     string `json:"fileType" gorm:"index"` // "images" | "videos" | "audios" | "prompts"
	S3Key        string `json:"s3Key"`
	OriginalName string `json:"originalName"`
	MimeType     string `json:"mimeType"`
	Bytes        int64  `json:"bytes"`
	CreatedAt    string `json:"createdAt"`
}

type UserFileList struct {
	Items []UserFile `json:"items"`
	Total int64      `json:"total"`
}
