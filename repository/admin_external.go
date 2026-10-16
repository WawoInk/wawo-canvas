package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrAdminExternalOwnerDelete   = errors.New("enterprise owner cannot be deleted separately")
	ErrAdminExternalSharedContent = errors.New("enterprise shared content must be removed first")
	ErrAdminCreditLogImmutable    = errors.New("external credit adjustment ledger is immutable")
)

func CreateAdminExternalUser(user model.User) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if user.EnterpriseID != nil {
			var enterprise model.Enterprise
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", *user.EnterpriseID).Take(&enterprise).Error; err != nil {
				return err
			}
		}
		return tx.Create(&user).Error
	})
}

func UpdateAdminExternalUser(id string, updates map[string]any) (model.User, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, err
	}
	var user model.User
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&user).Error; err != nil {
			return err
		}
		if _, ok := updates["password"]; ok {
			updates["session_version"] = gorm.Expr("session_version + 1")
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Take(&user).Error
	})
	return user, err
}

func DeleteAdminExternalUser(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&user).Error; err != nil {
			return err
		}
		if user.EnterpriseRole != nil && *user.EnterpriseRole == model.EnterpriseRoleOwner {
			return ErrAdminExternalOwnerDelete
		}
		var shared bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM assets WHERE user_id = ? AND enterprise_id IS NOT NULL
			UNION ALL SELECT 1 FROM user_files WHERE user_id = ? AND enterprise_id IS NOT NULL)`, id, id).Scan(&shared).Error; err != nil {
			return err
		}
		if shared {
			return ErrAdminExternalSharedContent
		}
		return tx.Delete(&user).Error
	})
}

func UpdateAdminExternalEnterprise(id string, updates map[string]any) error {
	db, err := DB()
	if err != nil {
		return err
	}
	result := db.Model(&model.Enterprise{}).Where("id = ?", id).Updates(updates)
	if result.Error == nil && result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

func DeleteAdminExternalEnterprise(id, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var enterprise model.Enterprise
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&enterprise).Error; err != nil {
			return err
		}
		var shared bool
		if err := tx.Raw(`SELECT EXISTS(SELECT 1 FROM assets WHERE enterprise_id = ?
			UNION ALL SELECT 1 FROM user_files WHERE enterprise_id = ?)`, id, id).Scan(&shared).Error; err != nil {
			return err
		}
		if shared {
			return ErrAdminExternalSharedContent
		}
		// Member transfers lock the owner first; keep the same order while detaching accounts.
		var owner model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", enterprise.OwnerID).Take(&owner).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("enterprise_id = ?", id).Updates(map[string]any{
			"enterprise_id": nil, "enterprise_role": nil, "session_version": gorm.Expr("session_version + 1"), "updated_at": updatedAt,
		}).Error; err != nil {
			return err
		}
		return tx.Delete(&enterprise).Error
	})
}

func AdjustAdminExternalCredits(targetType, id string, delta model.Decimal, input model.CreditLog) (model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return model.CreditLog{}, err
	}
	var result model.CreditLog
	err = db.Transaction(func(tx *gorm.DB) error {
		replay := func() (bool, error) {
			var existing model.CreditLog
			err := tx.Where("request_id = ? AND type = ?", input.RequestID, model.CreditLogTypeAdminAdjust).Take(&existing).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return false, nil
			}
			if err != nil {
				return false, err
			}
			if !existing.Amount.Equal(delta) || existing.Remark != input.Remark || existing.Extra != input.Extra {
				return false, ErrCreditTransferRequestConflict
			}
			result = existing
			return true, nil
		}
		if found, err := replay(); found || err != nil {
			return err
		}
		userID := id
		if targetType == "enterprise" {
			var enterprise model.Enterprise
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&enterprise).Error; err != nil {
				return err
			}
			userID = enterprise.OwnerID
		}
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).Take(&user).Error; err != nil {
			return err
		}
		// Recheck after the balance lock so concurrent retries observe the committed receipt.
		if found, err := replay(); found || err != nil {
			return err
		}
		balance := user.Credits.Add(delta)
		if balance.IsNegative() {
			return ErrInsufficientCredits
		}
		if err := tx.Model(&model.User{}).Where("id = ?", userID).Updates(map[string]any{"credits": balance, "updated_at": input.CreatedAt}).Error; err != nil {
			return err
		}
		input.UserID, input.Amount, input.Balance = userID, delta, balance
		if err := tx.Create(&input).Error; err != nil {
			return err
		}
		result = input
		return nil
	})
	return result, err
}
