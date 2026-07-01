package service

import (
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/repository"
)

const payloadTTLDays = 90

// StartPayloadCleanupJob 启动定期清理过期 generation_payloads 的后台任务。
func StartPayloadCleanupJob() {
	go func() {
		for {
			// 每天凌晨 3 点执行一次清理
			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 3, 0, 0, 0, now.Location())
			time.Sleep(next.Sub(now))

			cutoff := time.Now().AddDate(0, 0, -payloadTTLDays).Format(time.RFC3339)
			count, err := repository.DeleteExpiredPayloads(cutoff)
			if err != nil {
				log.Printf("[payload-cleanup] 清理过期 payload 失败: %v", err)
			} else if count > 0 {
				log.Printf("[payload-cleanup] 已清理 %d 条过期 payload（TTL=%d 天），截止日期: %s", count, payloadTTLDays, cutoff)
			}
		}
	}()
}
