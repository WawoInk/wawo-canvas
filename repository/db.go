package repository

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var promptCategories = []model.PromptCategory{
	{Category: "system", Name: "系统", Description: "系统提示词分类"},
	{Category: "gpt-image-2-prompts", Name: "GPT Image 2 Prompts", Description: "EvoLinkAI 的 GPT Image 2 案例提示词分类", GithubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", Remote: true},
	{Category: "awesome-gpt-image", Name: "Awesome GPT Image", Description: "ZeroLu 的中文 GPT Image 提示词分类", GithubURL: "https://github.com/ZeroLu/awesome-gpt-image", Remote: true},
	{Category: "awesome-gpt4o-image-prompts", Name: "Awesome GPT4o Image Prompts", Description: "ImgEdify 的 GPT-4o 图像提示词分类", GithubURL: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", Remote: true},
	{Category: "youmind-gpt-image-2", Name: "YouMind GPT Image 2", Description: "YouMind OpenLab 的 GPT Image 2 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", Remote: true},
	{Category: "youmind-nano-banana-pro", Name: "YouMind Nano Banana Pro", Description: "YouMind OpenLab 的 Nano Banana Pro 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", Remote: true},
	{Category: "davidwu-gpt-image2-prompts", Name: "awesome-gpt-image2-prompts", Description: "davidwuw0811-boop 整理的 GPT Image 2 提示词分类", GithubURL: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", Remote: true},
}

var (
	db     *gorm.DB
	dbOnce sync.Once
	dbErr  error
)

// DB 初始化并返回全局数据库连接（仅 PostgreSQL）。
func DB() (*gorm.DB, error) {
	dbOnce.Do(func() {
		dsn := config.Cfg.DatabaseDSN
		dbErr = ensurePostgresDatabase(dsn)
		if dbErr != nil {
			return
		}
		db, dbErr = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if dbErr != nil {
			return
		}
		dbErr = db.Exec("CREATE SEQUENCE IF NOT EXISTS canvas_revision_seq").Error
		if dbErr != nil {
			return
		}
		dbErr = db.AutoMigrate(
			&model.User{},
			&model.CreditLog{},
			&model.Prompt{},
			&model.Asset{},
			&model.Setting{},
			&model.GenerationTask{},
			&model.GenerationPayload{},
			&model.CanvasProject{},
			&model.VideoTask{},
			&model.UserFile{},
			&model.DeletedRecord{},
		)
	})
	return db, dbErr
}

func ensurePostgresDatabase(dsn string) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	target := strings.TrimSpace(cfg.Database)
	if target == "" {
		return nil
	}
	ctx := context.Background()
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err == nil {
		_ = conn.Close(ctx)
		return nil
	}
	if !isPostgresError(err, "3D000") {
		return err
	}

	maintenance := cfg.Copy()
	maintenance.Database = "postgres"
	if strings.EqualFold(target, "postgres") {
		maintenance.Database = "template1"
	}
	conn, err = pgx.ConnectConfig(ctx, maintenance)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{target}.Sanitize(), pgx.QueryExecModeExec)
	if isPostgresError(err, "42P04") {
		return nil
	}
	return err
}

func isPostgresError(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
