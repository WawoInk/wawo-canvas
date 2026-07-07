// web/src/services/sync-scheduler.ts
import { syncClient } from "./sync-client";

const ACTIVE_TASK_POLL_MS = 5_000;       // C: 有活跃任务时 5s
const DOMAIN_POLL_MS = 60_000;           // A: 数据域默认 60s
const ACTIVITY_IDLE_MS = 120_000;         // B: 2 分钟无操作视为闲置

class SyncScheduler {
    private runningTaskCount = 0;
    private lastActivity = Date.now();
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private visibilityHandler: (() => void) | null = null;
    private lastTasksPoll = 0;
    private lastDomainPoll = 0;

    /** 启动调度器 */
    start(): void {
        // 首次全量同步
        syncClient.syncAll().catch(() => {});
        // 初始化轮询时间戳，避免立即触发第一次定时轮询
        this.lastTasksPoll = Date.now();
        this.lastDomainPoll = Date.now();

        // Tab 可见性
        this.visibilityHandler = () => {
            if (document.visibilityState === "visible") {
                syncClient.syncAll().catch(() => {});
            }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);

        // 定时器：使用 arrow 包裹确保 this 绑定
        this.intervalId = setInterval(() => this.tick(), 1000);
    }

    /** 停止调度器 */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    /** 标记用户活动（mutation 时调用）*/
    markActivity(): void {
        this.lastActivity = Date.now();
    }

    /** 更新活跃任务数（生成任务状态变化时调用）*/
    onRunningTaskCountChange(count: number): void {
        this.runningTaskCount = count;
    }

    private tick(): void {
        const now = Date.now();
        const idle = now - this.lastActivity > ACTIVITY_IDLE_MS;

        // B: 活跃编辑时不轮询
        if (!idle) return;

        // C: 生命周期驱动 — 有活跃任务时高频轮询 tasks
        if (this.runningTaskCount > 0) {
            if (now - this.lastTasksPoll >= ACTIVE_TASK_POLL_MS) {
                this.lastTasksPoll = now;
                syncClient.syncDomain("tasks").catch(() => {});
            }
            return; // tasks 轮询优先，不与 canvas/assets 合并
        }

        // A: 数据域驱动 — canvas/assets 60s 轮询
        if (now - this.lastDomainPoll >= DOMAIN_POLL_MS) {
            this.lastDomainPoll = now;
            syncClient.syncDomain("canvas").catch(() => {});
            syncClient.syncDomain("assets").catch(() => {});
        }
    }
}

export const syncScheduler = new SyncScheduler();
