package service

import (
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestAdminCreditAdjustmentValidatesExactDecimalInput(t *testing.T) {
	for _, amount := range []string{"0.0000000000000000001", "-100.25", "12345678901234567890.125"} {
		input := model.AdminCreditAdjustmentInput{Delta: amount, Reason: " 充值 ", RequestID: " request-1 "}
		delta, err := validateAdminCreditAdjustment(&input)
		if err != nil || !delta.Equal(model.MustDecimal(amount)) || input.Reason != "充值" || input.RequestID != "request-1" {
			t.Fatalf("exact amount %q: delta=%s, input=%+v, err=%v", amount, delta, input, err)
		}
	}
	for _, amount := range []string{"", "0", "-0.00", "NaN", "Infinity", "1e2147483647", "1e-2147483647", strings.Repeat("9", 129)} {
		input := model.AdminCreditAdjustmentInput{Delta: amount, Reason: "充值", RequestID: "request-1"}
		if _, err := validateAdminCreditAdjustment(&input); err == nil {
			t.Fatalf("accepted invalid amount %q", amount)
		}
	}
	for _, input := range []model.AdminCreditAdjustmentInput{
		{Delta: "1", Reason: "充值"},
		{Delta: "1", Reason: " ", RequestID: "request-1"},
		{Delta: "1", Reason: "充值", RequestID: "request\n1"},
	} {
		if _, err := validateAdminCreditAdjustment(&input); err == nil {
			t.Fatalf("accepted invalid operation %+v", input)
		}
	}
}

func TestAdminExternalUserRejectsInvalidIdentityAndRole(t *testing.T) {
	enterpriseID := "enterprise-test"
	for _, user := range []model.User{
		{Username: "user\u00a0name", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{Username: "user", Role: "root", Status: model.UserStatusActive},
		{Username: "user", Role: model.UserRoleUser, Status: "disabled"},
		{Username: "user", Role: model.UserRoleAdmin, Status: model.UserStatusActive, EnterpriseID: &enterpriseID},
		{Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive, Email: "Name <user@example.com>"},
	} {
		if err := validateAdminExternalUser(&user, "password", true); err == nil {
			t.Fatalf("accepted invalid user %+v", user)
		}
	}
}
