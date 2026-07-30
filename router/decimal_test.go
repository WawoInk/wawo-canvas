package router_test

import (
	"encoding/json"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func credit(value int64) model.Decimal {
	return model.NewDecimal(value)
}

func fractionalCredit(value string) model.Decimal {
	return model.MustDecimal(value)
}

func hasCredit(value model.Decimal, want int64) bool {
	return value.Equal(credit(want))
}

func TestBillingDecimalsSerializeAsJSONStrings(t *testing.T) {
	body, err := json.Marshal(struct {
		Credits model.Decimal `json:"credits"`
	}{Credits: fractionalCredit("2.5")})
	if err != nil || string(body) != `{"credits":"2.5"}` {
		t.Fatalf("billing decimal JSON = %s err=%v", body, err)
	}
}
