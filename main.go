package main

import (
	"log"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/router"
	"github.com/basketikun/infinite-canvas/service"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		log.Fatal(err)
	}
	if err := service.ValidateGenerationProfiles(); err != nil {
		log.Fatal(err)
	}
	if err := service.ValidateStoredGenerationBindings(); err != nil {
		log.Printf("generation bindings disabled: %v", err)
	}
	service.StartPromptSyncScheduler()
	service.StartPayloadCleanupJob()
	service.StartGenerationWorker()
	log.Fatal(router.New().Run(":" + config.Cfg.Port))
}
