package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"gorm.io/gorm"
)

func AdminKeyStatus() (model.AdminKeyStatus, error) {
	record, err := repository.GetAdminKey()
	if err != nil || record.Hash == "" {
		return model.AdminKeyStatus{}, err
	}
	_, enabled, err := adminKeyIssuer(record.UserID)
	return model.AdminKeyStatus{Enabled: enabled, CreatedAt: record.CreatedAt}, err
}

func GenerateAdminKey(ctx context.Context) (model.AdminKeyStatus, error) {
	actor, ok := UserFromContext(ctx)
	if !ok || actor.Role != model.UserRoleAdmin {
		return model.AdminKeyStatus{}, safeMessageError{message: "需要管理员权限"}
	}
	_, ok, err := adminKeyIssuer(actor.ID)
	if err != nil {
		return model.AdminKeyStatus{}, err
	}
	if !ok {
		return model.AdminKeyStatus{}, safeMessageError{message: "需要管理员权限"}
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return model.AdminKeyStatus{}, err
	}
	key := "ak_" + base64.RawURLEncoding.EncodeToString(random)
	record := model.AdminKeyRecord{Hash: adminKeyHash(key), UserID: actor.ID, CreatedAt: now()}
	if err := repository.SaveAdminKey(record); err != nil {
		return model.AdminKeyStatus{}, err
	}
	return model.AdminKeyStatus{Enabled: true, CreatedAt: record.CreatedAt, Key: key}, nil
}

func RevokeAdminKey() error {
	return repository.DeleteAdminKey()
}

func CurrentAdminKeyUser(key string) (model.AuthUser, bool, error) {
	if len(key) != 46 || !strings.HasPrefix(key, "ak_") {
		return model.AuthUser{}, false, nil
	}
	record, err := repository.GetAdminKey()
	if err != nil {
		return model.AuthUser{}, false, err
	}
	if subtle.ConstantTimeCompare([]byte(record.Hash), []byte(adminKeyHash(key))) != 1 {
		return model.AuthUser{}, false, nil
	}
	return adminKeyIssuer(record.UserID)
}

func adminKeyHash(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}

func adminKeyIssuer(id string) (model.AuthUser, bool, error) {
	user, ok, err := repository.GetUserByID(id)
	if err != nil || !ok || user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive {
		return model.AuthUser{}, false, err
	}
	public := model.PublicUser(user)
	if user.EnterpriseID != nil {
		enterprise, err := repository.GetEnterpriseByID(*user.EnterpriseID)
		if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && enterprise.Status != model.EnterpriseStatusActive {
			return model.AuthUser{}, false, nil
		}
		if err != nil {
			return model.AuthUser{}, false, err
		}
		public.EnterpriseName, public.EnterpriseStatus = enterprise.Name, enterprise.Status
	}
	return public, true, nil
}
