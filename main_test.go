package main

import (
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestHTTPServerDrainsInflightRequestAndRefusesNewConnections(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
			_, _ = w.Write([]byte("done"))
		case <-r.Context().Done():
		}
	})
	address, signals, serverDone := startHTTPServer(t, handler, time.Second)

	type result struct {
		body string
		err  error
	}
	responseDone := make(chan result, 1)
	go func() {
		resp, err := (&http.Client{Transport: &http.Transport{DisableKeepAlives: true}}).Get("http://" + address)
		if err != nil {
			responseDone <- result{err: err}
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		responseDone <- result{body: string(body), err: err}
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
	signals <- syscall.SIGTERM
	signals <- os.Interrupt
	waitForConnectionRefused(t, address)
	close(release)

	response := <-responseDone
	if response.err != nil || response.body != "done" {
		t.Fatalf("in-flight response = %q, %v", response.body, response.err)
	}
	if err := <-serverDone; err != nil {
		t.Fatalf("server shutdown returned %v", err)
	}
}

func TestHTTPServerForcesCloseAfterShutdownTimeout(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})
	address, signals, serverDone := startHTTPServer(t, handler, 40*time.Millisecond)
	requestDone := make(chan error, 1)
	go func() {
		resp, err := (&http.Client{Transport: &http.Transport{DisableKeepAlives: true}}).Get("http://" + address)
		if resp != nil {
			_ = resp.Body.Close()
		}
		requestDone <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
	shutdownStarted := time.Now()
	signals <- syscall.SIGTERM
	err := <-serverDone
	if err == nil || !strings.Contains(err.Error(), "HTTP shutdown timed out after 40ms") {
		t.Fatalf("shutdown error = %v", err)
	}
	if elapsed := time.Since(shutdownStarted); elapsed > 500*time.Millisecond {
		t.Fatalf("shutdown took %s", elapsed)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("timed-out request was not forcibly closed")
	}
	select {
	case <-requestDone:
	case <-time.After(time.Second):
		t.Fatal("client request remained blocked")
	}
}

func startHTTPServer(t *testing.T, handler http.Handler, timeout time.Duration) (string, chan<- os.Signal, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	t.Cleanup(func() { _ = server.Close() })
	signals := make(chan os.Signal, 2)
	done := make(chan error, 1)
	go func() {
		done <- serveHTTP(server, listener, signals, timeout)
	}()
	return listener.Addr().String(), signals, done
}

func waitForConnectionRefused(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", address, 20*time.Millisecond)
		if err != nil {
			return
		}
		_ = conn.Close()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("server continued accepting new connections")
}
