package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestLoginPreservesConcurrentAdminMutations(t *testing.T) {
	previousSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "login-admin-mutation-test-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = previousSecret })
	previousKey, err := repository.GetAdminKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var err error
		if previousKey.Hash == "" {
			err = repository.DeleteAdminKey()
		} else {
			err = repository.SaveAdminKey(previousKey)
		}
		if err != nil {
			t.Errorf("restore Admin Key: %v", err)
		}
	})
	for _, provider := range []string{"password", "linuxdo"} {
		for _, mutation := range []string{"ban", "demote", "password", "delete"} {
			t.Run(provider+"/"+mutation, func(t *testing.T) {
				username := "login-admin-mutation-" + uuid.NewString()
				user, err := AdminExternalCreateUser(model.AdminExternalUserCreate{Username: username, Password: "old-login-password", Role: model.UserRoleAdmin})
				if err != nil {
					t.Fatal(err)
				}
				previous, err := Login(username, "old-login-password")
				if err != nil {
					t.Fatal(err)
				}
				key, err := GenerateAdminKey(WithUser(context.Background(), previous.User))
				if err != nil {
					t.Fatal(err)
				}
				before, found, err := repository.GetUserByID(user.ID)
				if err != nil || !found {
					t.Fatalf("fixture user: found=%v err=%v", found, err)
				}
				loginAttempt := adminMutationLogin(t, user, provider)
				login := runConcurrentAdminMutation(t, username, loginAttempt, func() error {
					return applyAdminUserMutation(user.ID, mutation)
				})
				after, found, err := repository.GetUserByID(user.ID)
				if err != nil {
					t.Fatal(err)
				}
				if mutation == "delete" {
					if found || login.err == nil || login.session.Token != "" {
						t.Fatal("in-flight login restored a deleted user or returned a session")
					}
				} else if !found {
					t.Fatal("admin update unexpectedly deleted user")
				} else {
					switch mutation {
					case "ban":
						if after.Status != model.UserStatusBan || login.err == nil || login.session.Token != "" {
							t.Fatal("in-flight login undid an account ban or returned a session")
						}
					case "demote":
						if after.Role != model.UserRoleUser || login.err == nil && login.session.User.Role != model.UserRoleUser {
							t.Fatal("in-flight login restored or issued the removed admin role")
						}
					case "password":
						if after.Password == before.Password || after.SessionVersion != before.SessionVersion+1 || login.err == nil || login.session.Token != "" {
							t.Fatal("in-flight login undid password/session invalidation or accepted old password")
						}
						if _, err := Login(username, "new-login-password"); err != nil {
							t.Fatalf("new password stopped working: %v", err)
						}
					}
				}
				current, valid := CurrentAuthUser(previous.Token)
				if mutation == "demote" {
					if valid && current.Role != model.UserRoleUser {
						t.Fatal("existing session retained removed admin permissions")
					}
				} else if valid {
					t.Fatal("old session regained validity after admin mutation")
				}
				if mutation != "password" {
					if _, valid, err := CurrentAdminKeyUser(key.Key); err != nil || valid {
						t.Fatalf("old Admin Key regained permissions: valid=%v err=%v", valid, err)
					}
				}
			})
		}
	}
}

func TestAccountUpdatesPreserveConcurrentAdminMutations(t *testing.T) {
	for _, operation := range []string{"profile", "password"} {
		for _, mutation := range []string{"ban", "demote", "password", "delete"} {
			t.Run(operation+"/"+mutation, func(t *testing.T) {
				username := "account-admin-mutation-" + uuid.NewString()
				user, err := AdminExternalCreateUser(model.AdminExternalUserCreate{Username: username, Password: "old-login-password", Role: model.UserRoleAdmin})
				if err != nil {
					t.Fatal(err)
				}
				previous, err := Login(username, "old-login-password")
				if err != nil {
					t.Fatal(err)
				}
				attempt := func() (model.AuthSession, error) {
					if operation == "password" {
						return model.AuthSession{}, ChangeAccountPassword(user.ID, "old-login-password", "self-changed-password")
					}
					current, err := UpdateAccountProfile(user.ID, "正在修改的资料", "changed@example.com")
					return model.AuthSession{User: current}, err
				}
				result := runConcurrentAdminMutation(t, username, attempt, func() error { return applyAdminUserMutation(user.ID, mutation) })
				after, found, err := repository.GetUserByID(user.ID)
				if err != nil {
					t.Fatal(err)
				}
				if mutation == "delete" {
					if found || result.err == nil {
						t.Fatal("self-service update recreated a deleted account")
					}
				} else if !found {
					t.Fatal("self-service update lost account")
				} else {
					switch mutation {
					case "ban":
						if after.Status != model.UserStatusBan || result.err == nil {
							t.Fatal("self-service update ignored or undid account ban")
						}
					case "demote":
						if after.Role != model.UserRoleUser || result.err == nil && operation == "profile" && result.session.User.Role != model.UserRoleUser {
							t.Fatal("self-service update restored removed admin role")
						}
					case "password":
						if result.err == nil {
							t.Fatal("self-service update ignored concurrent password reset")
						}
						if _, err := Login(username, "new-login-password"); err != nil {
							t.Fatalf("admin password reset was lost: %v", err)
						}
					}
				}
				current, valid := CurrentAuthUser(previous.Token)
				if mutation == "demote" {
					if valid && current.Role != model.UserRoleUser {
						t.Fatal("existing session restored admin role")
					}
				} else if valid {
					t.Fatal("self-service update restored an invalid session")
				}
			})
		}
	}
}

func TestEnterpriseMemberUpdatesPreserveConcurrentDeletion(t *testing.T) {
	for _, operation := range []string{"status", "password"} {
		for _, target := range []string{"member", "enterprise"} {
			t.Run(operation+"/"+target, func(t *testing.T) {
				enterprise, err := CreateEnterprise(CreateEnterpriseInput{Name: "成员并发保护", OwnerUsername: "member-race-owner-" + uuid.NewString(), OwnerPassword: "owner-password"})
				if err != nil {
					t.Fatal(err)
				}
				owner := model.AuthUser{ID: enterprise.OwnerID, Role: model.UserRoleUser, EnterpriseID: enterprise.ID, EnterpriseRole: model.EnterpriseRoleOwner}
				member, err := CreateEnterpriseMember(owner, CreateEnterpriseMemberInput{Username: "member-race-" + uuid.NewString(), Password: "member-password"})
				if err != nil {
					t.Fatal(err)
				}
				attempt := func() (model.AuthSession, error) {
					if operation == "password" {
						_, err := ResetEnterpriseMemberPassword(owner, member.ID, "new-member-password")
						return model.AuthSession{}, err
					}
					_, err := SetEnterpriseMemberStatus(owner, member.ID, model.UserStatusBan)
					return model.AuthSession{}, err
				}
				result := runConcurrentAdminMutation(t, member.Username, attempt, func() error {
					if target == "enterprise" {
						return AdminExternalDeleteEnterprise(enterprise.ID)
					}
					return AdminExternalDeleteUser(member.ID)
				})
				if result.err == nil {
					t.Fatal("member update succeeded after concurrent deletion")
				}
				after, found, err := repository.GetUserByID(member.ID)
				if err != nil {
					t.Fatal(err)
				}
				if target == "member" {
					if found {
						t.Fatal("member update recreated deleted account")
					}
				} else if !found || after.EnterpriseID != nil || after.EnterpriseRole != nil || after.Status != model.UserStatusActive {
					t.Fatal("member update restored removed enterprise identity or changed account")
				}
			})
		}
	}
}

type adminMutationAttemptResult struct {
	session model.AuthSession
	err     error
}

func runConcurrentAdminMutation(t *testing.T, username string, attempt func() (model.AuthSession, error), mutate func() error) adminMutationAttemptResult {
	t.Helper()
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	loaded, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var paused atomic.Bool
	var releaseOnce sync.Once
	releaseAttempt := func() { releaseOnce.Do(func() { close(release) }) }
	callback := "test:user_admin_mutation:" + uuid.NewString()
	if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		candidate, ok := tx.Statement.Dest.(*model.User)
		if ok && candidate.Username == username && paused.CompareAndSwap(false, true) {
			close(loaded)
			<-release
		}
	}); err != nil {
		t.Fatal(err)
	}
	result := make(chan adminMutationAttemptResult, 1)
	go func() {
		defer close(finished)
		session, err := attempt()
		result <- adminMutationAttemptResult{session: session, err: err}
	}()
	t.Cleanup(func() {
		releaseAttempt()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("paused account operation did not finish")
		}
		if err := db.Callback().Query().Remove(callback); err != nil {
			t.Errorf("remove account callback: %v", err)
		}
	})
	select {
	case <-loaded:
	case <-time.After(5 * time.Second):
		t.Fatal("account operation did not reach its initial user read")
	}
	if err := mutate(); err != nil {
		t.Fatalf("concurrent admin mutation: %v", err)
	}
	releaseAttempt()
	select {
	case value := <-result:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("account operation did not complete after admin mutation")
		return adminMutationAttemptResult{}
	}
}

func applyAdminUserMutation(id, mutation string) error {
	var err error
	switch mutation {
	case "ban":
		status := model.UserStatusBan
		_, err = AdminExternalUpdateUser(id, model.AdminExternalUserUpdate{Status: &status})
	case "demote":
		role := model.UserRoleUser
		_, err = AdminExternalUpdateUser(id, model.AdminExternalUserUpdate{Role: &role})
	case "password":
		password := "new-login-password"
		_, err = AdminExternalUpdateUser(id, model.AdminExternalUserUpdate{Password: &password})
	case "delete":
		err = AdminExternalDeleteUser(id)
	}
	return err
}

func adminMutationLogin(t *testing.T, user model.AdminExternalUser, provider string) func() (model.AuthSession, error) {
	t.Helper()
	if provider == "password" {
		return func() (model.AuthSession, error) { return Login(user.Username, "old-login-password") }
	}
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	profileID := time.Now().UnixNano()
	if err := db.Model(&model.User{}).Where("id = ?", user.ID).Update("linux_do_id", strconv.FormatInt(profileID, 10)).Error; err != nil {
		t.Fatal(err)
	}
	return adminMutationLinuxDo(t, user.Username, profileID)
}

func TestLinuxDoFirstLoginCreatesUsableSession(t *testing.T) {
	username := "linuxdo-first-login-" + uuid.NewString()
	session, err := adminMutationLinuxDo(t, username, time.Now().UnixNano())()
	if err != nil || session.User.ID == "" || session.User.Username != username || session.User.Role != model.UserRoleUser {
		t.Fatalf("first Linux.do login: user=%+v err=%v", session.User, err)
	}
	if user, valid := CurrentAuthUser(session.Token); !valid || user.ID != session.User.ID {
		t.Fatal("first Linux.do login token does not authenticate")
	}
}

func adminMutationLinuxDo(t *testing.T, username string, profileID int64) func() (model.AuthSession, error) {
	t.Helper()
	settings, err := repository.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	previousSettings := settings
	settings.Public.Auth.LinuxDo.Enabled = true
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := repository.SaveSettings(previousSettings, now()); err != nil {
			t.Errorf("restore Linux.do settings: %v", err)
		}
	})
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_ = json.NewEncoder(w).Encode(linuxDoTokenResponse{AccessToken: "local-test-token"})
			return
		}
		_ = json.NewEncoder(w).Encode(linuxDoUserResponse{ID: profileID, Username: username, Name: "外部身份资料"})
	}))
	t.Cleanup(providerServer.Close)
	previousTokenURL, previousProfileURL := config.Cfg.LinuxDoTokenURL, config.Cfg.LinuxDoUserInfoURL
	config.Cfg.LinuxDoTokenURL, config.Cfg.LinuxDoUserInfoURL = providerServer.URL+"/token", providerServer.URL+"/profile"
	t.Cleanup(func() {
		config.Cfg.LinuxDoTokenURL, config.Cfg.LinuxDoUserInfoURL = previousTokenURL, previousProfileURL
	})
	return func() (model.AuthSession, error) {
		session, _, err := LoginWithLinuxDo(httptest.NewRequest(http.MethodGet, "/api/auth/linux-do/callback", nil), "test-code", "")
		return session, err
	}
}
