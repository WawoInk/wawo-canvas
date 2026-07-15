package service

import "github.com/basketikun/infinite-canvas/model"

func GenerationProfiles() []model.GenerationProfile {
	return []model.GenerationProfile{{
		ID:            "seedance-1-5-pro",
		Version:       1,
		DisplayName:   "Seedance 1.5 Pro",
		AdapterKey:    "seedance-contents-v1",
		UpstreamModel: "seedance-1-5-pro",
		Intents:       []model.GenerationIntentKind{model.IntentVideoGenerate},
	}}
}
