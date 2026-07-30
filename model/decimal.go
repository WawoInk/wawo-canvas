package model

import "github.com/shopspring/decimal"

type Decimal = decimal.Decimal

var DecimalZero = decimal.Zero

func NewDecimal(value int64) Decimal {
	return decimal.NewFromInt(value)
}

func MustDecimal(value string) Decimal {
	return decimal.RequireFromString(value)
}
