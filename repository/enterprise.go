package repository

import (
	"errors"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrEnterpriseNotFound            = errors.New("enterprise not found")
	ErrEnterpriseMemberNotFound      = errors.New("enterprise member not found")
	ErrInsufficientCredits           = errors.New("insufficient credits")
	ErrCreditTransferRequestConflict = errors.New("credit transfer request conflict")
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

func ListEnterpriseMembers(enterpriseID string, q model.Query) ([]model.User, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.User{}).Where("enterprise_id = ? AND enterprise_role = ?", enterpriseID, model.EnterpriseRoleMember)
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("username LIKE ? OR display_name LIKE ? OR email LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var users []model.User
	err = tx.Order("created_at DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&users).Error
	return users, total, err
}

func ListEnterpriseCreditLogs(enterpriseID, memberID string, q model.Query) ([]model.EnterpriseCreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("credit_logs AS log").Joins("JOIN users AS member ON member.id = log.user_id").
		Where("member.enterprise_id = ? AND member.enterprise_role IN ?", enterpriseID, []model.EnterpriseRole{model.EnterpriseRoleOwner, model.EnterpriseRoleMember}).
		Where("log.type IN ?", []model.CreditLogType{model.CreditLogTypeAdminAdjust, model.CreditLogTypeEnterpriseAllocate, model.CreditLogTypeEnterpriseReclaim, model.CreditLogTypeAIConsume, model.CreditLogTypeAIRefund})
	if memberID = strings.TrimSpace(memberID); memberID != "" {
		tx = tx.Where("log.user_id = ?", memberID)
	}
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("log.type LIKE ? OR log.remark LIKE ? OR log.related_id LIKE ? OR log.counterparty_id LIKE ? OR member.username LIKE ? OR member.display_name LIKE ?", like, like, like, like, like, like)
	}
	if q.Type != "" {
		tx = tx.Where("log.type = ?", q.Type)
	}
	if q.StartTime != "" {
		tx = tx.Where("log.created_at::timestamptz >= ?::timestamptz", q.StartTime)
	}
	if q.EndTime != "" {
		tx = tx.Where("log.created_at::timestamptz <= ?::timestamptz", q.EndTime)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []model.EnterpriseCreditLog
	err = tx.Select("log.*, member.username, member.display_name").Order("log.created_at DESC, log.id DESC").Offset(q.Offset()).Limit(q.PageSize).Scan(&logs).Error
	return logs, total, err
}

func GetEnterpriseMember(enterpriseID, id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "id = ? AND enterprise_id = ? AND enterprise_role = ?", id, enterpriseID, model.EnterpriseRoleMember)
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

func UpdateEnterpriseDiscountRate(id string, discountRate model.Decimal, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.Enterprise{}).Where("id = ?", id).Updates(map[string]any{"discount_rate": discountRate, "updated_at": updatedAt}).Error
}

func UpdateEnterpriseName(id, ownerID, name, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.Enterprise{}).Where("id = ? AND owner_id = ?", id, ownerID).Updates(map[string]any{"name": name, "updated_at": updatedAt}).Error
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

func AdjustEnterpriseOwnerCredits(enterpriseID, actorID string, delta model.Decimal, reason, updatedAt, logID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var owner model.User
		result := tx.Raw(`SELECT owner.* FROM users AS owner JOIN enterprises AS e ON e.owner_id = owner.id
			WHERE e.id = ? AND owner.enterprise_id = e.id AND owner.enterprise_role = ? FOR UPDATE`, enterpriseID, model.EnterpriseRoleOwner).Scan(&owner)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrEnterpriseNotFound
		}
		if owner.Credits.Add(delta).IsNegative() {
			return ErrInsufficientCredits
		}
		owner.Credits = owner.Credits.Add(delta)
		if err := tx.Model(&model.User{}).Where("id = ?", owner.ID).Updates(map[string]any{"credits": owner.Credits, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLog{
			ID: logID, UserID: owner.ID, Type: model.CreditLogTypeAdminAdjust, Amount: delta, Balance: owner.Credits,
			RelatedID: actorID, Remark: reason, CreatedAt: updatedAt,
		}).Error
	})
}

func TransferEnterpriseMemberCredits(enterpriseID, ownerID, memberID string, action model.EnterpriseCreditAction, amount model.Decimal, requestID, updatedAt string) (model.User, model.User, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, model.User{}, err
	}
	var owner, member model.User
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND enterprise_id = ? AND enterprise_role = ?", ownerID, enterpriseID, model.EnterpriseRoleOwner).Take(&owner).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrEnterpriseNotFound
			}
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND enterprise_id = ? AND enterprise_role = ?", memberID, enterpriseID, model.EnterpriseRoleMember).Take(&member).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrEnterpriseMemberNotFound
			}
			return err
		}

		logType, ownerDelta, memberDelta, remark := model.CreditLogTypeEnterpriseAllocate, amount.Neg(), amount, "企业积分分配"
		if action == model.EnterpriseCreditActionReclaim {
			logType, ownerDelta, memberDelta, remark = model.CreditLogTypeEnterpriseReclaim, amount, amount.Neg(), "企业积分收回"
		}
		var existing model.CreditLog
		err := tx.Where("user_id = ? AND type = ? AND related_id = ?", ownerID, logType, requestID).Take(&existing).Error
		if err == nil {
			if existing.CounterpartyID != memberID || !existing.Amount.Equal(ownerDelta) {
				return ErrCreditTransferRequestConflict
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if owner.Credits.Add(ownerDelta).IsNegative() || member.Credits.Add(memberDelta).IsNegative() {
			return ErrInsufficientCredits
		}
		owner.Credits = owner.Credits.Add(ownerDelta)
		member.Credits = member.Credits.Add(memberDelta)
		if err := tx.Model(&model.User{}).Where("id = ?", owner.ID).Updates(map[string]any{"credits": owner.Credits, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id = ?", member.ID).Updates(map[string]any{"credits": member.Credits, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		return tx.Create(&[]model.CreditLog{
			{ID: "credit-" + uuid.NewString(), UserID: owner.ID, Type: logType, Amount: ownerDelta, Balance: owner.Credits, RelatedID: requestID, CounterpartyID: member.ID, Remark: remark, CreatedAt: updatedAt},
			{ID: "credit-" + uuid.NewString(), UserID: member.ID, Type: logType, Amount: memberDelta, Balance: member.Credits, RelatedID: requestID, CounterpartyID: owner.ID, Remark: remark, CreatedAt: updatedAt},
		}).Error
	})
	return owner, member, err
}
