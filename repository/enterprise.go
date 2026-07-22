package repository

import (
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func CreateEnterpriseWithOwner(enterprise *model.Enterprise, owner *model.User) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(enterprise).Error; err != nil {
			return err
		}
		return tx.Create(owner).Error
	})
}

func ListEnterprises(q model.Query) ([]model.EnterpriseView, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	base := db.Table("enterprises AS e").Joins("JOIN users AS owner ON owner.id = e.owner_id")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		base = base.Where("e.name LIKE ? OR owner.username LIKE ? OR owner.display_name LIKE ?", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.EnterpriseView
	err = base.Select(`e.*, owner.username AS owner_name, owner.status AS owner_status, owner.credits AS owner_credits,
		COUNT(member.id) AS member_count`).
		Joins("LEFT JOIN users AS member ON member.enterprise_id = e.id AND member.enterprise_role = ?", model.EnterpriseRoleMember).
		Group("e.id, owner.id").Order("e.created_at DESC").Offset(q.Offset()).Limit(q.PageSize).Scan(&items).Error
	return items, total, err
}

func GetEnterpriseByID(id string) (model.Enterprise, error) {
	db, err := DB()
	if err != nil {
		return model.Enterprise{}, err
	}
	var enterprise model.Enterprise
	return enterprise, db.Where("id = ?", id).First(&enterprise).Error
}

func UpdateEnterpriseStatus(id string, status model.EnterpriseStatus, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.Enterprise{}).Where("id = ?", id).Updates(map[string]any{"status": status, "updated_at": updatedAt}).Error
}

func UpdateEnterpriseOwnerStatus(id string, status model.UserStatus, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.User{}).Where("id = (SELECT owner_id FROM enterprises WHERE id = ?)", id).Updates(map[string]any{"status": status, "updated_at": updatedAt}).Error
}

func UpdateEnterpriseOwnerPassword(id, password, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.User{}).Where("id = (SELECT owner_id FROM enterprises WHERE id = ?)", id).Updates(map[string]any{
		"password": password, "session_version": gorm.Expr("session_version + 1"), "updated_at": updatedAt,
	}).Error
}

func GetEnterpriseView(id string) (model.EnterpriseView, error) {
	db, err := DB()
	if err != nil {
		return model.EnterpriseView{}, err
	}
	var item model.EnterpriseView
	err = db.Table("enterprises AS e").Select(`e.*, owner.username AS owner_name, owner.status AS owner_status, owner.credits AS owner_credits,
		COUNT(member.id) AS member_count`).Joins("JOIN users AS owner ON owner.id = e.owner_id").
		Joins("LEFT JOIN users AS member ON member.enterprise_id = e.id AND member.enterprise_role = ?", model.EnterpriseRoleMember).
		Where("e.id = ?", id).Group("e.id, owner.id").Take(&item).Error
	return item, err
}
