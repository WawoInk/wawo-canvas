"use client";

import { useEffect, useState } from "react";
import { App, Button, DatePicker, Space, Table, Tabs, Tag } from "antd";
import type { TableProps } from "antd";
import type { Dayjs } from "dayjs";
import { Download } from "lucide-react";

import { fetchUserCreditLogs, type UserCreditLog } from "@/services/api/auth";
import { fetchGenerationTasks, type GenerationTaskItem } from "@/services/api/generation-tasks";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { useUserStore } from "@/stores/use-user-store";
import { downloadCsv, fetchAllPages, type CsvColumn } from "./account-log-export";

const operationLabels: Record<string, string> = {
    "video.generate": "生成视频",
    "video.short-drama": "生成短剧",
    image: "生成图片",
    video: "生成视频",
    audio: "生成音频",
    chat: "文本对话",
};
const sourceLabels: Record<string, string> = {
    canvas: "无限画布",
    image_workbench: "图片工作台",
    video_workbench: "视频工作台",
};
const statusLabels: Record<string, { label: string; color: string }> = {
    queued: { label: "排队中", color: "default" },
    pending: { label: "等待中", color: "default" },
    running: { label: "运行中", color: "processing" },
    success: { label: "成功", color: "success" },
    succeeded: { label: "成功", color: "success" },
    failed: { label: "失败", color: "error" },
    cancelled: { label: "已取消", color: "warning" },
};
const creditLogTypeLabels: Record<string, string> = {
    admin_adjust: "平台调整",
    ai_consume: "模型消费",
    ai_refund: "失败返还",
    enterprise_allocate: "企业分配",
    enterprise_reclaim: "企业收回",
};

type LogDateRange = [Dayjs, Dayjs] | null;

const displayTime = (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "");
const usageCsvColumns: CsvColumn<GenerationTaskItem>[] = [
    { title: "任务 ID", value: (item) => item.id },
    { title: "操作", value: (item) => operationLabels[item.intentKind || ""] || operationLabels[item.taskType] || item.intentKind || item.taskType },
    { title: "来源", value: (item) => sourceLabels[item.source] || item.source },
    { title: "模型", value: (item) => item.model },
    { title: "模型展示名", value: (item) => item.modelDisplayName || item.model },
    { title: "状态", value: (item) => statusLabels[item.status]?.label || item.status },
    { title: "积分", value: (item) => formatDecimal(item.credits) },
    { title: "上游 Credits", value: (item) => (item.taskType === "video" ? (item.upstreamCredits ?? "null") : "") },
    { title: "耗时（秒）", value: (item) => (item.latencyMs ? (item.latencyMs / 1000).toFixed(1) : "") },
    { title: "时间", value: (item) => displayTime(item.createdAt) },
];
const creditCsvColumns: CsvColumn<UserCreditLog>[] = [
    { title: "流水 ID", value: (item) => item.id },
    { title: "类型", value: (item) => creditLogTypeLabels[item.type] || item.type },
    { title: "变动", value: (item) => formatDecimal(item.amount) },
    { title: "余额", value: (item) => formatDecimal(item.balance) },
    { title: "关联任务", value: (item) => item.taskId || item.relatedId },
    { title: "备注", value: (item) => item.remark },
    { title: "时间", value: (item) => displayTime(item.createdAt) },
];

type UsageLogTableProps = {
    items: GenerationTaskItem[];
    loading?: boolean;
    pagination?: TableProps<GenerationTaskItem>["pagination"];
};

type CreditLogTableProps = {
    items: UserCreditLog[];
    loading?: boolean;
    pagination?: TableProps<UserCreditLog>["pagination"];
};

export function AccountLogs() {
    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div>
                <h2 className="text-lg font-semibold">日志记录</h2>
                <p className="mt-1 text-sm text-muted-foreground">仅展示当前登录账号的使用情况和积分变动</p>
            </div>
            <Tabs
                className="mt-4"
                items={[
                    { key: "usage", label: "使用记录", children: <AccountUsageLogs /> },
                    { key: "credits", label: "积分记录", children: <AccountCreditLogs /> },
                ]}
            />
        </section>
    );
}

export function AccountUsageLogTable({ items, loading, pagination }: UsageLogTableProps) {
    return (
        <Table<GenerationTaskItem>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={pagination}
            scroll={{ x: 1180 }}
            columns={[
                {
                    title: "操作",
                    width: 180,
                    render: (_, item) => (
                        <div>
                            <div>{operationLabels[item.intentKind || ""] || operationLabels[item.taskType] || item.intentKind || item.taskType || "-"}</div>
                            <div className="text-xs text-muted-foreground">{sourceLabels[item.source] || item.source || "-"}</div>
                        </div>
                    ),
                },
                { title: "模型", dataIndex: "model", ellipsis: true, render: (value: string) => value || "-" },
                { title: "模型展示名", dataIndex: "modelDisplayName", width: 160, ellipsis: true, render: (value: string, item) => value || item.model || "-" },
                {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (value: string) => {
                        const status = statusLabels[value] || { label: value || "未知", color: "default" };
                        return <Tag color={status.color}>{status.label}</Tag>;
                    },
                },
                { title: "积分", dataIndex: "credits", width: 100, render: (value: string) => `${formatDecimal(value)} 积分` },
                { title: "上游 Credits", dataIndex: "upstreamCredits", width: 120, render: (_, item) => (item.taskType === "video" ? (item.upstreamCredits ?? "null") : "-") },
                { title: "耗时", dataIndex: "latencyMs", width: 100, render: (value: number) => (value ? `${(value / 1000).toFixed(1)} 秒` : "-") },
                { title: "时间", dataIndex: "createdAt", width: 180, render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "-") },
            ]}
        />
    );
}

export function AccountUsageLogs() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const [items, setItems] = useState<GenerationTaskItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const [range, setRange] = useState<LogDateRange>(null);
    const startTime = range?.[0].startOf("day").toISOString();
    const endTime = range?.[1].endOf("day").toISOString();

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError("");
        void fetchGenerationTasks({ start_time: startTime, end_time: endTime, page, pageSize })
            .then((result) => {
                if (!current) return;
                setItems(result.items);
                setTotal(result.total);
            })
            .catch((reason) => {
                if (!current) return;
                setItems([]);
                setTotal(0);
                setError(reason instanceof Error ? reason.message : "使用记录加载失败");
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, page, pageSize, startTime, token, userId]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchGenerationTasks({ start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning("暂无使用记录可导出");
                return;
            }
            downloadCsv("使用记录.csv", usageCsvColumns, rows);
            message.success("使用记录已导出");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "使用记录导出失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <Space wrap className="mb-4">
                <DatePicker.RangePicker
                    value={range}
                    format="YYYY-MM-DD"
                    placeholder={["开始日期", "结束日期"]}
                    onChange={(value) => {
                        setRange(value as LogDateRange);
                        setPage(1);
                    }}
                />
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>
                    导出使用记录
                </Button>
            </Space>
            {error ? <p className="mb-4 text-sm text-red-500">{error}</p> : null}
            <AccountUsageLogTable
                items={items}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    showTotal: (value) => `共 ${value} 条`,
                    onChange: (nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    },
                }}
            />
        </>
    );
}

export function AccountCreditLogs() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [items, setItems] = useState<UserCreditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const [range, setRange] = useState<LogDateRange>(null);
    const startTime = range?.[0].startOf("day").toISOString();
    const endTime = range?.[1].endOf("day").toISOString();

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError("");
        void fetchUserCreditLogs(token, { start_time: startTime, end_time: endTime, page, pageSize })
            .then((result) => {
                if (!current) return;
                setItems(result.items);
                setTotal(result.total);
            })
            .catch((reason) => {
                if (!current) return;
                setItems([]);
                setTotal(0);
                setError(reason instanceof Error ? reason.message : "积分记录加载失败");
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, page, pageSize, startTime, token, user?.credits, user?.id]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchUserCreditLogs(token, { start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning("暂无积分记录可导出");
                return;
            }
            downloadCsv("积分记录.csv", creditCsvColumns, rows);
            message.success("积分记录已导出");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "积分记录导出失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <Space wrap className="mb-4">
                <DatePicker.RangePicker
                    value={range}
                    format="YYYY-MM-DD"
                    placeholder={["开始日期", "结束日期"]}
                    onChange={(value) => {
                        setRange(value as LogDateRange);
                        setPage(1);
                    }}
                />
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>
                    导出日志记录
                </Button>
            </Space>
            {error ? <p className="mb-4 text-sm text-red-500">{error}</p> : null}
            <AccountCreditLogTable
                items={items}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    showTotal: (value) => `共 ${value} 条`,
                    onChange: (nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    },
                }}
            />
        </>
    );
}

export function AccountCreditLogTable({ items, loading, pagination }: CreditLogTableProps) {
    return (
        <Table<UserCreditLog>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={pagination}
            scroll={{ x: 900 }}
            columns={[
                { title: "类型", dataIndex: "type", width: 120, render: (value: string) => <Tag>{creditLogTypeLabels[value] || value || "-"}</Tag> },
                {
                    title: "变动",
                    dataIndex: "amount",
                    width: 100,
                    render: (value: string) => <span className={compareDecimal(value, "0") >= 0 ? "text-green-600" : "text-red-500"}>{compareDecimal(value, "0") > 0 ? `+${formatDecimal(value)}` : formatDecimal(value)}</span>,
                },
                { title: "余额", dataIndex: "balance", width: 100, render: (value: string) => formatDecimal(value) },
                { title: "关联任务", width: 220, render: (_, item) => item.taskId || item.relatedId || "-" },
                { title: "备注", dataIndex: "remark", ellipsis: true, render: (value: string) => value || "-" },
                { title: "时间", dataIndex: "createdAt", width: 180, render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "-") },
            ]}
        />
    );
}
