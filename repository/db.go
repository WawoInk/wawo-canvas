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
		dbErr = migrateDecimalBillingColumns(db)
		if dbErr != nil {
			return
		}
		dbErr = db.AutoMigrate(
			&model.Enterprise{},
			&model.User{},
			&model.CreditLog{},
			&model.Prompt{},
			&model.Asset{},
			&model.Setting{},
			&model.VolcengineAssetGroupBinding{},
			&model.GenerationTask{},
			&model.GenerationTaskEvent{},
			&model.GenerationPayload{},
			&model.CanvasProject{},
			&model.VideoTask{},
			&model.UserFile{},
			&model.DeletedRecord{},
		)
		if dbErr == nil {
			dbErr = db.Exec("UPDATE generation_tasks SET client_request_id = '' WHERE client_request_id <> '' AND command_hash = ''").Error
		}
		if dbErr == nil {
			dbErr = db.Exec(`WITH duplicates AS (
				SELECT id, row_number() OVER (PARTITION BY user_id, client_request_id ORDER BY created_at, id) AS position
				FROM generation_tasks WHERE client_request_id <> ''
			) UPDATE generation_tasks SET client_request_id = '' FROM duplicates WHERE generation_tasks.id = duplicates.id AND duplicates.position > 1`).Error
		}
		if dbErr == nil {
			dbErr = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_user_client_request ON generation_tasks (user_id, client_request_id) WHERE client_request_id <> ''").Error
		}
		if dbErr == nil {
			dbErr = db.Exec(`WITH duplicates AS (
				SELECT id, row_number() OVER (PARTITION BY task_id, type ORDER BY created_at, id) AS position
				FROM credit_logs WHERE task_id <> ''
			) UPDATE credit_logs SET task_id = '' FROM duplicates WHERE credit_logs.id = duplicates.id AND duplicates.position > 1`).Error
		}
		if dbErr == nil {
			dbErr = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_logs_task_type ON credit_logs (task_id, type) WHERE task_id <> ''").Error
		}
		if dbErr == nil {
			dbErr = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_logs_transfer_request ON credit_logs (user_id, type, related_id) WHERE related_id <> '' AND type IN ('enterprise_allocate', 'enterprise_reclaim')").Error
		}
		if dbErr == nil {
			dbErr = db.Exec(`DO $$ BEGIN
				ALTER TABLE enterprises ADD CONSTRAINT fk_enterprises_owner FOREIGN KEY (owner_id) REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED;
			EXCEPTION WHEN duplicate_object THEN NULL; END $$`).Error
		}
		if dbErr == nil {
			dbErr = db.Exec(`DO $$ BEGIN
				ALTER TABLE users ADD CONSTRAINT fk_users_enterprise FOREIGN KEY (enterprise_id) REFERENCES enterprises(id) DEFERRABLE INITIALLY DEFERRED;
			EXCEPTION WHEN duplicate_object THEN NULL; END $$`).Error
		}
		if dbErr == nil {
			dbErr = db.Exec(`CREATE OR REPLACE FUNCTION validate_enterprise_owner() RETURNS trigger AS $$
			BEGIN
				IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id AND enterprise_id = NEW.id AND enterprise_role = 'owner') THEN
					RAISE EXCEPTION 'enterprise owner must be its owner user';
				END IF;
				RETURN NEW;
			END; $$ LANGUAGE plpgsql;
			DROP TRIGGER IF EXISTS enterprise_owner_identity ON enterprises;
			CREATE CONSTRAINT TRIGGER enterprise_owner_identity AFTER INSERT OR UPDATE ON enterprises DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_enterprise_owner()`).Error
		}
	})
	return db, dbErr
}

func migrateDecimalBillingColumns(db *gorm.DB) error {
	return db.Exec(`
		DO $$
		DECLARE target record;
		BEGIN
			FOR target IN SELECT * FROM (VALUES
				('enterprises', 'discount_rate'),
				('users', 'credits'),
				('credit_logs', 'amount'),
				('credit_logs', 'balance'),
				('generation_tasks', 'credits'),
				('generation_tasks', 'upstream_credits'),
				('generation_tasks', 'billing_rate')
			) AS billing_columns(table_name, column_name)
			LOOP
				IF EXISTS (
					SELECT 1 FROM information_schema.columns AS columns
					WHERE columns.table_schema = current_schema()
						AND columns.table_name = target.table_name
						AND columns.column_name = target.column_name
						AND columns.data_type <> 'numeric'
				) THEN
					EXECUTE format(
						'ALTER TABLE %I ALTER COLUMN %I TYPE numeric USING %I::numeric',
						target.table_name,
						target.column_name,
						target.column_name
					);
				END IF;
			END LOOP;
		END $$`).Error
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
