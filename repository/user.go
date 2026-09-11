package repository

import (
	"errors"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListUsers 分页查询用户。
func ListUsers(q model.Query) ([]model.User, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("users AS users").Select("users.*, enterprise.name AS enterprise_name").
		Joins("LEFT JOIN enterprises AS enterprise ON enterprise.id = users.enterprise_id")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("users.username LIKE ? OR users.display_name LIKE ? OR users.email LIKE ? OR users.linux_do_id LIKE ? OR enterprise.name LIKE ?", like, like, like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var users []model.User
	err = tx.Order("users.created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&users).Error
	return users, total, err
}

// CountUsers 返回用户总数。
func CountUsers() (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	return total, db.Model(&model.User{}).Count(&total).Error
}

// HasAdmin 判断系统中是否存在管理员。
func HasAdmin() (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var total int64
	err = db.Model(&model.User{}).Where("role = ?", model.UserRoleAdmin).Count(&total).Error
	return total > 0, err
}

// GetUserByID 根据 ID 查询用户。
func GetUserByID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "id = ?", id)
}

// GetUserByUsername 根据用户名查询用户。
func GetUserByUsername(username string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "username = ?", username)
}

// SaveUser 保存用户信息。
func SaveUser(user model.User) (model.User, error) {
	db, err := DB()
	if err != nil {
		return user, err
	}
	var total int64
	if err := db.Model(&model.User{}).Where("id = ?", user.ID).Count(&total).Error; err != nil {
		return user, err
	}
	if total == 0 {
		return user, db.Create(&user).Error
	}
	if err := db.Model(&model.User{}).Where("id = ?", user.ID).Select("*").Omit("credits").Updates(&user).Error; err != nil {
		return user, err
	}
	user, _, err = findUser(db, "id = ?", user.ID)
	return user, err
}

func UpdateUserCredits(id string, credits model.Decimal, updatedAt string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	result := db.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"credits": credits, "updated_at": updatedAt})
	if result.Error != nil {
		return model.User{}, false, result.Error
	}
	user, ok, err := findUser(db, "id = ?", id)
	return user, ok && result.RowsAffected > 0, err
}

func ConsumeUserCredits(id string, credits model.Decimal, now string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	if !credits.IsPositive() {
		user, ok, err := GetUserByID(id)
		return user, ok, err
	}
	tx := db.Model(&model.User{}).Where("id = ? AND credits >= ?", id, credits).Updates(map[string]any{
		"credits":    gorm.Expr("credits - ?", credits),
		"updated_at": now,
	})
	if tx.Error != nil {
		return model.User{}, false, tx.Error
	}
	user, ok, err := GetUserByID(id)
	return user, ok && tx.RowsAffected > 0, err
}

func RefundUserCredits(id string, credits model.Decimal, now string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	if !credits.IsPositive() {
		user, ok, err := GetUserByID(id)
		return user, ok, err
	}
	tx := db.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{
		"credits":    gorm.Expr("credits + ?", credits),
		"updated_at": now,
	})
	if tx.Error != nil {
		return model.User{}, false, tx.Error
	}
	user, ok, err := GetUserByID(id)
	return user, ok && tx.RowsAffected > 0, err
}

func ApplyUserCreditLog(userID string, amount model.Decimal, log model.CreditLog, updatedAt string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	var user model.User
	applied := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).Take(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if log.TaskID != "" {
			var existing model.CreditLog
			err := tx.Where("task_id = ? AND type = ?", log.TaskID, log.Type).Take(&existing).Error
			if err == nil {
				applied = true
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if log.Type == model.CreditLogTypeAIRefund && log.TaskID != "" {
			var consume model.CreditLog
			if err := tx.Where("user_id = ? AND task_id = ? AND type = ?", userID, log.TaskID, model.CreditLogTypeAIConsume).Take(&consume).Error; err != nil {
				return err
			}
			amount = consume.Amount.Neg()
		}
		if log.Type == model.CreditLogTypeAIConsume && amount.IsNegative() {
			credits, err := discountedUserCredits(tx, user, amount.Neg())
			if err != nil {
				return err
			}
			amount = credits.Neg()
		}
		if user.Credits.Add(amount).IsNegative() {
			return nil
		}
		user.Credits = user.Credits.Add(amount)
		if err := tx.Model(&model.User{}).Where("id = ?", userID).Updates(map[string]any{"credits": user.Credits, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		log.UserID, log.Amount, log.Balance, log.CreatedAt = userID, amount, user.Credits, updatedAt
		if err := tx.Create(&log).Error; err != nil {
			return err
		}
		if log.TaskID != "" && log.Type == model.CreditLogTypeAIConsume {
			if err := tx.Model(&model.GenerationTask{}).Where("id = ?", log.TaskID).Update("credits", amount.Neg()).Error; err != nil {
				return err
			}
		}
		applied = true
		return nil
	})
	return user, applied, err
}

// HasTaskCreditLog 判断任务是否已有指定类型的积分流水。
func HasTaskCreditLog(taskID string, logType model.CreditLogType) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var total int64
	err = db.Model(&model.CreditLog{}).Where("task_id = ? AND type = ?", taskID, logType).Count(&total).Error
	return total > 0, err
}

func discountedUserCredits(tx *gorm.DB, user model.User, credits model.Decimal) (model.Decimal, error) {
	if !credits.IsPositive() || user.EnterpriseID == nil {
		return credits, nil
	}
	var enterprise model.Enterprise
	if err := tx.Select("discount_rate").Where("id = ?", *user.EnterpriseID).Take(&enterprise).Error; err != nil {
		return model.DecimalZero, err
	}
	return credits.Mul(enterprise.DiscountRate), nil
}

// SaveCreditLog 保存算力点变更流水。
func SaveCreditLog(log model.CreditLog) (model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return log, err
	}
	return log, db.Save(&log).Error
}

type AdminCreditLogWithUser struct {
	model.CreditLog
	Username       string `json:"username"`
	EnterpriseName string `json:"enterpriseName"`
}

func ListCreditLogs(q model.Query) ([]AdminCreditLogWithUser, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("credit_logs AS log").
		Joins("LEFT JOIN users AS account ON account.id = log.user_id").
		Joins("LEFT JOIN enterprises AS enterprise ON enterprise.id = account.enterprise_id")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("log.user_id LIKE ? OR log.type LIKE ? OR log.remark LIKE ? OR log.related_id LIKE ?", like, like, like, like)
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
	var logs []AdminCreditLogWithUser
	err = tx.Select("log.*, account.username AS username, enterprise.name AS enterprise_name").
		Order("log.created_at DESC").
		Offset(q.Offset()).
		Limit(q.PageSize).
		Scan(&logs).Error
	return logs, total, err
}

// ListCreditLogsByUserID 按用户 ID 强制过滤积分流水。
func ListCreditLogsByUserID(userID string, q model.Query) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{}).Where("user_id = ?", userID)
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("type LIKE ? OR remark LIKE ? OR related_id LIKE ?", like, like, like)
	}
	if q.Type != "" {
		tx = tx.Where("type = ?", q.Type)
	}
	if q.StartTime != "" {
		tx = tx.Where("created_at::timestamptz >= ?::timestamptz", q.StartTime)
	}
	if q.EndTime != "" {
		tx = tx.Where("created_at::timestamptz <= ?::timestamptz", q.EndTime)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []model.CreditLog
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&logs).Error
	return logs, total, err
}

func DeleteCreditLog(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.CreditLog{}, "id = ?", id).Error
}

// DeleteUser 删除指定用户。
func DeleteUser(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.User{}, "id = ?", id).Error
}

// GetUserByLinuxDoID 根据 Linux.do ID 查询用户。
func GetUserByLinuxDoID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "linux_do_id = ?", id)
}

// findUser 查询单个用户，并将未命中转换为 ok=false。
func findUser(db *gorm.DB, query string, args ...any) (model.User, bool, error) {
	user := model.User{}
	err := db.Where(query, args...).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, false, nil
	}
	return user, err == nil, err
}
