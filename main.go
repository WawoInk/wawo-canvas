package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	server := &http.Server{Addr: ":" + config.Cfg.Port, Handler: router.New()}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err := serveHTTP(server, listener, signals, config.Cfg.ShutdownTimeout); err != nil {
		log.Fatal(err)
	}
}

func serveHTTP(server *http.Server, listener net.Listener, signals <-chan os.Signal, shutdownTimeout time.Duration) error {
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case received := <-signals:
		log.Printf("HTTP shutdown started: signal=%s timeout=%s", received, shutdownTimeout)
	}

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		if closeErr := server.Close(); closeErr != nil {
			return fmt.Errorf("HTTP shutdown timed out after %s: %w (force close failed: %v)", shutdownTimeout, err, closeErr)
		}
		return fmt.Errorf("HTTP shutdown timed out after %s: %w", shutdownTimeout, err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Print("HTTP shutdown completed")
	return nil
}
