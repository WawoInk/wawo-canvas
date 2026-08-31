package repository

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestDatabaseLoggerParameterizesSensitiveQueryLogs(t *testing.T) {
	var output bytes.Buffer
	databaseLogger := newDatabaseLogger(log.New(&output, "", 0))
	filter, ok := databaseLogger.(gorm.ParamsFilter)
	if !ok {
		t.Fatal("database logger does not support GORM parameter filtering")
	}

	const query = "SELECT * FROM settings WHERE api_key = $1 AND output = $2"
	sentinels := []string{"api-key-sentinel", "complete-output-sentinel"}
	filteredQuery, filteredParams := filter.ParamsFilter(context.Background(), query, sentinels[0], sentinels[1])
	if filteredQuery != query {
		t.Fatalf("filtered query = %q, want %q", filteredQuery, query)
	}
	if len(filteredParams) != 0 {
		t.Fatalf("filtered params = %#v, want none", filteredParams)
	}

	databaseLogger.Trace(context.Background(), time.Now(), func() (string, int64) {
		return (postgres.Dialector{}).Explain(filteredQuery, filteredParams...), 0
	}, errors.New("query failed with "+sentinels[0]))
	for _, sentinel := range sentinels {
		if strings.Contains(output.String(), sentinel) {
			t.Fatalf("database log exposed %q: %s", sentinel, output.String())
		}
	}
	if !strings.Contains(output.String(), "SELECT * FROM settings") {
		t.Fatalf("database log omitted query text: %s", output.String())
	}
}

func TestDatabaseLoggerKeepsWarnAnd200msSlowQueryBehavior(t *testing.T) {
	var output bytes.Buffer
	databaseLogger := newDatabaseLogger(log.New(&output, "", 0))
	trace := func(begin time.Time) {
		databaseLogger.Trace(context.Background(), begin, func() (string, int64) {
			return "SELECT 1", 1
		}, nil)
	}

	trace(time.Now().Add(-100 * time.Millisecond))
	if output.Len() != 0 {
		t.Fatalf("fast query logged at default level: %s", output.String())
	}

	trace(time.Now().Add(-250 * time.Millisecond))
	if !strings.Contains(output.String(), "SLOW SQL >= 200ms") {
		t.Fatalf("slow query warning missing: %s", output.String())
	}
}
