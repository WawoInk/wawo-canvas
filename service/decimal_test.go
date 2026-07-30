package service

import "github.com/basketikun/infinite-canvas/model"

func credit(value int64) model.Decimal {
	return model.NewDecimal(value)
}
