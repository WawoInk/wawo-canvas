package model

type AssetType string

const (
	AssetTypeText  AssetType = "text"
	AssetTypeImage AssetType = "image"
	AssetTypeVideo AssetType = "video"
)

// Asset 素材记录。
type Asset struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	UserID      string    `json:"userId" gorm:"index"`
	Title       string    `json:"title"`
	Type        AssetType `json:"type"`
	CoverURL    string    `json:"coverUrl"`
	Tags        []string  `json:"tags" gorm:"serializer:json"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	Content     string    `json:"content,omitempty"`
	URL         string    `json:"url,omitempty"`    // computed: presigned download URL populated on read
	FileID      string    `json:"fileId,omitempty"` // references user_files.id for image/video assets
	Width       int       `json:"width,omitempty"`
	Height      int       `json:"height,omitempty"`
	Bytes       int64     `json:"bytes,omitempty"`
	MimeType    string    `json:"mimeType,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
}

// AssetList 素材分页结果。
type AssetList struct {
	Items []Asset  `json:"items"`
	Tags  []string `json:"tags"`
	Total int      `json:"total"`
}
