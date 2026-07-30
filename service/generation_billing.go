package service

import (
	"encoding/json"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type generationBillingPlan struct {
	Mode    model.GenerationBillingMode
	Rate    model.Decimal
	Credits model.Decimal
}

func generationBillingPlanFor(profile model.GenerationProfile, intent model.GenerationIntent) (generationBillingPlan, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return generationBillingPlan{}, err
	}
	settings = normalizeSettings(settings)
	for _, binding := range settings.Private.GenerationProfiles {
		if binding.ID != profile.ID {
			continue
		}
		cost := modelCostConfig(settings.Public, binding.ID)
		if cost.Model == "" {
			cost = modelCostConfig(settings.Public, profile.UpstreamModel)
		}
		if binding.BillingMode == model.BillingModePerSecond {
			resolution, _ := intent.Settings["resolution"].(string)
			rate := cost.ResolutionCredits[resolution]
			if rate.IsNegative() {
				rate = model.DecimalZero
			}
			duration, ok := scalarInteger(intent.Settings["durationSeconds"])
			if !ok || duration <= 0 {
				if definition, exists := profile.Capabilities.Settings["durationSeconds"]; exists && definition.Max != nil {
					duration = *definition.Max
				} else {
					duration = 0
				}
			}
			return generationBillingPlan{Mode: binding.BillingMode, Rate: rate, Credits: rate.Mul(model.NewDecimal(int64(duration)))}, nil
		}
		if binding.BillingMode == model.BillingModePerCredit {
			return generationBillingPlan{Mode: binding.BillingMode, Rate: nonNegativeDecimal(cost.Credits)}, nil
		}
		credits := nonNegativeDecimal(cost.Credits)
		return generationBillingPlan{Mode: model.BillingModePerCall, Rate: credits, Credits: credits}, nil
	}
	credits, err := generationCost(profile.UpstreamModel)
	return generationBillingPlan{Mode: model.BillingModePerCall, Rate: credits, Credits: credits}, err
}

func compatibilityGenerationBillingPlanFor(profile model.GenerationProfile, body []byte) (generationBillingPlan, error) {
	var request struct {
		Resolution string `json:"resolution"`
		Duration   int    `json:"duration"`
	}
	_ = json.Unmarshal(body, &request)
	return generationBillingPlanFor(profile, model.GenerationIntent{Settings: model.ScalarSettings{
		"resolution": request.Resolution, "durationSeconds": request.Duration,
	}})
}

func modelCostConfig(public model.PublicSetting, key string) model.ModelCost {
	for _, cost := range public.ModelChannel.ModelCosts {
		if cost.Model == key {
			return cost
		}
	}
	return model.ModelCost{}
}

func chargeGenerationByUpstreamCredits(task model.GenerationTask, ref ProviderTaskRef, path string) (model.GenerationTask, error) {
	if task.BillingMode != model.BillingModePerCredit {
		return task, nil
	}
	upstreamCredits := model.DecimalZero
	if ref.Credits != nil {
		upstreamCredits = nonNegativeDecimal(*ref.Credits)
	}
	return repository.ChargeGenerationTask(task.ID, upstreamCredits.Mul(nonNegativeDecimal(task.BillingRate)), ref.Credits, path, DisplayModelName(task.ModelProfileID, task.Model))
}

func nonNegativeDecimal(value model.Decimal) model.Decimal {
	if value.IsNegative() {
		return model.DecimalZero
	}
	return value
}
