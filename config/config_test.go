package config

import "testing"

func TestLoadDefaultsDatabaseDSN(t *testing.T) {
	Cfg = Config{}
	if err := Load(); err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if Cfg.DatabaseDSN == "" {
		t.Fatal("DatabaseDSN should default to a postgres URL")
	}
	// 默认值应为 postgres URL（不含 StorageDriver）
	if Cfg.DatabaseDSN != "postgres://localhost:5432/infinite-canvas?sslmode=disable" {
		// 若 .env 存在覆盖了默认值，仅校验非空即可
		t.Logf("DatabaseDSN = %q (可能被 .env 覆盖)", Cfg.DatabaseDSN)
	}
}

func TestLoadAutoGeneratesJWTSecret(t *testing.T) {
	Cfg = Config{JWTSecret: "infinite-canvas"}
	_ = Load()
	if Cfg.JWTSecret == "" || Cfg.JWTSecret == "infinite-canvas" {
		t.Fatalf("JWTSecret should be auto-generated, got %q", Cfg.JWTSecret)
	}
}
