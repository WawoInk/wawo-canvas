package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ErrConflict 表示乐观锁冲突：expectedUpdatedAt 与当前 updated_at 不匹配。
var ErrConflict = errors.New("record modified by another session")

// ListAssets 按查询条件返回用户素材分页列表。
func ListAssets(userID string, q model.Query) ([]model.Asset, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := applyAssetFilters(db.Model(&model.Asset{}).Where("user_id = ?", userID), q)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Asset
	err = tx.Order("updated_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// ListAssetTags 返回当前素材查询条件下的全部标签。
func ListAssetTags(userID string, q model.Query) ([]string, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	q.Normalize()
	q.Tags = nil
	tx := applyAssetFilters(db.Model(&model.Asset{}).Where("user_id = ?", userID), q)

	var items []model.Asset
	if err := tx.Select("tags").Find(&items).Error; err != nil {
		return nil, err
	}
	return assetTagsFromItems(items), nil
}

// SaveAsset 保存素材，并在更新时保留原创建时间。
func SaveAsset(item model.Asset) (model.Asset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	if saved, ok, err := findAsset(db, item.ID); err != nil {
		return item, err
	} else if ok && item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	return item, db.Save(&item).Error
}

// SaveAssetWithLock 使用乐观锁保存素材。expectedUpdatedAt 必须匹配当前 updated_at，
// 否则返回 ErrConflict。INSERT 时 expectedUpdatedAt 为空，无条件创建。
func SaveAssetWithLock(item model.Asset, expectedUpdatedAt string) (model.Asset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}

	saved, exists, err := findAsset(db, item.ID)
	if err != nil {
		return item, err
	}

	if !exists {
		return item, db.Create(&item).Error
	}

	// UPDATE: 条件检查 updated_at 是否匹配
	if item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	result := db.Model(&model.Asset{}).
		Where("id = ? AND user_id = ? AND updated_at = ?", item.ID, item.UserID, expectedUpdatedAt).
		Select("user_id", "title", "type", "cover_url", "tags", "category", "description", "content", "file_id", "width", "height", "bytes", "mime_type", "updated_at", "created_at").
		Updates(item)
	if result.Error != nil {
		return item, result.Error
	}
	if result.RowsAffected == 0 {
		// re-read current row so Conflict handler can return the real server version
		updated, _, err := findAsset(db, item.ID)
		if err != nil {
			return item, err
		}
		return updated, ErrConflict
	}
	updated, _, err := findAsset(db, item.ID)
	return updated, err
}

// DeleteAsset 删除指定素材。
func DeleteAsset(userID, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.Asset{}).Error
}

// applyAssetFilters 应用素材列表的搜索条件。
func applyAssetFilters(tx *gorm.DB, q model.Query) *gorm.DB {
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ? OR content LIKE ?", like, like, like)
	}
	if isActiveAssetOption(q.Type) {
		tx = tx.Where("type = ?", q.Type)
	}
	return applyAssetTagsFilter(tx, q.Tags)
}

// findAsset 根据 ID 查询素材。
func findAsset(db *gorm.DB, id string) (model.Asset, bool, error) {
	item := model.Asset{}
	err := db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Asset{}, false, nil
	}
	return item, err == nil, err
}

// applyAssetTagsFilter 应用 JSON 标签条件。
func applyAssetTagsFilter(tx *gorm.DB, tags []string) *gorm.DB {
	if len(tags) == 0 {
		return tx
	}
	condition := tx.Session(&gorm.Session{NewDB: true})
	for _, tag := range tags {
		condition = condition.Or(assetJSONTagsContains(tx), tag)
	}
	return tx.Where(condition)
}

func assetTagsFromItems(items []model.Asset) []string {
	seen := map[string]bool{}
	tags := []string{}
	for _, item := range items {
		for _, tag := range item.Tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

// assetJSONTagsContains 返回素材 tags 的 JSON 包含条件（PostgreSQL）。
func assetJSONTagsContains(tx *gorm.DB) string {
	return "jsonb_exists(tags::jsonb, ?)"
}

// isActiveAssetOption 判断素材筛选项有效状态。
func isActiveAssetOption(value string) bool {
	return value != "" && value != "全部" && value != "all"
}
