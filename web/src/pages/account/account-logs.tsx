"use client";

import { useEffect, useState } from "react";
import { App, Button, DatePicker, Space, Table, Tabs, Tag } from "antd";
import type { TableProps } from "antd";
import type { Dayjs } from "dayjs";
import type { TFunction } from "i18next";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import { fetchUserCreditLogs, type UserCreditLog } from "@/services/api/auth";
import { fetchGenerationTasks, type GenerationTaskItem } from "@/services/api/generation-tasks";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { useUserStore } from "@/stores/use-user-store";
import { downloadCsv, fetchAllPages, type CsvColumn } from "./account-log-export";

const operationLabelKeys: Record<string, string> = {
    "video.generate": "account.logs.operations.generateVideo",
    "video.short-drama": "account.logs.operations.generateShortDrama",
    image: "account.logs.operations.generateImage",
    video: "account.logs.operations.generateVideo",
    audio: "account.logs.operations.generateAudio",
    chat: "account.logs.operations.textChat",
};
const sourceLabelKeys: Record<string, string> = {
    canvas: "account.logs.sources.canvas",
    image_workbench: "account.logs.sources.imageWorkbench",
    video_workbench: "account.logs.sources.videoWorkbench",
};
const statusLabels: Record<string, { key: string; color: string }> = {
    queued: { key: "account.logs.statuses.queued", color: "default" },
    pending: { key: "account.logs.statuses.pending", color: "default" },
    running: { key: "account.logs.statuses.running", color: "processing" },
    success: { key: "account.logs.statuses.success", color: "success" },
    succeeded: { key: "account.logs.statuses.success", color: "success" },
    failed: { key: "account.logs.statuses.failed", color: "error" },
    cancelled: { key: "account.logs.statuses.cancelled", color: "warning" },
};
const creditLogTypeKeys: Record<string, string> = {
    admin_adjust: "account.logs.creditTypes.adminAdjust",
    ai_consume: "account.logs.creditTypes.aiConsume",
    ai_refund: "account.logs.creditTypes.aiRefund",
    enterprise_allocate: "account.logs.creditTypes.enterpriseAllocate",
    enterprise_reclaim: "account.logs.creditTypes.enterpriseReclaim",
};

type LogDateRange = [Dayjs, Dayjs] | null;

function operationLabel(t: TFunction, item: GenerationTaskItem) {
    const value = item.intentKind || item.taskType;
    const key = operationLabelKeys[value];
    return key ? t(key) : value;
}

function sourceLabel(t: TFunction, value: string) {
    const key = sourceLabelKeys[value];
    return key ? t(key) : value;
}

function createUsageCsvColumns(t: TFunction): CsvColumn<GenerationTaskItem>[] {
    return [
        { title: t("account.logs.table.taskId"), value: (item) => item.id },
        { title: t("account.logs.table.operation"), value: (item) => operationLabel(t, item) },
        { title: t("account.logs.table.source"), value: (item) => sourceLabel(t, item.source) },
        { title: t("account.logs.table.model"), value: (item) => item.model },
        { title: t("account.logs.table.modelDisplayName"), value: (item) => item.modelDisplayName || item.model },
        { title: t("account.logs.table.status"), value: (item) => (statusLabels[item.status] ? t(statusLabels[item.status].key) : item.status) },
        { title: t("account.logs.table.credits"), value: (item) => formatDecimal(item.credits) },
        { title: t("account.logs.table.upstreamCredits"), value: (item) => (item.taskType === "video" ? (item.upstreamCredits ?? t("common.states.notAvailable")) : "") },
        {
            title: t("account.logs.table.durationSeconds"),
            value: (item) => (item.latencyMs ? formatNumber(item.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : ""),
        },
        { title: t("account.logs.table.time"), value: (item) => (item.createdAt ? formatDateTime(item.createdAt) : "") },
    ];
}

function createCreditCsvColumns(t: TFunction): CsvColumn<UserCreditLog>[] {
    return [
        { title: t("account.logs.table.logId"), value: (item) => item.id },
        { title: t("account.logs.table.type"), value: (item) => (creditLogTypeKeys[item.type] ? t(creditLogTypeKeys[item.type]) : item.type) },
        { title: t("account.logs.table.change"), value: (item) => formatDecimal(item.amount) },
        { title: t("account.logs.table.balance"), value: (item) => formatDecimal(item.balance) },
        { title: t("account.logs.table.relatedTask"), value: (item) => item.taskId || item.relatedId },
        { title: t("account.logs.table.remark"), value: (item) => item.remark },
        { title: t("account.logs.table.time"), value: (item) => (item.createdAt ? formatDateTime(item.createdAt) : "") },
    ];
}

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
    const { t } = useTranslation();

    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div>
                <h2 className="text-lg font-semibold">{t("account.logs.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("account.logs.description")}</p>
            </div>
            <Tabs
                className="mt-4"
                items={[
                    { key: "usage", label: t("account.logs.tabs.usage"), children: <AccountUsageLogs /> },
                    { key: "credits", label: t("account.logs.tabs.credits"), children: <AccountCreditLogs /> },
                ]}
            />
        </section>
    );
}

export function AccountUsageLogTable({ items, loading, pagination }: UsageLogTableProps) {
    const { t } = useTranslation();

    return (
        <Table<GenerationTaskItem>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={pagination}
            scroll={{ x: 1180 }}
            columns={[
                {
                    title: t("account.logs.table.operation"),
                    width: 180,
                    render: (_, item) => (
                        <div>
                            <div>{operationLabel(t, item) || "-"}</div>
                            <div className="text-xs text-muted-foreground">{sourceLabel(t, item.source) || "-"}</div>
                        </div>
                    ),
                },
                { title: t("account.logs.table.model"), dataIndex: "model", ellipsis: true, render: (value: string) => value || "-" },
                { title: t("account.logs.table.modelDisplayName"), dataIndex: "modelDisplayName", width: 160, ellipsis: true, render: (value: string, item) => value || item.model || "-" },
                {
                    title: t("account.logs.table.status"),
                    dataIndex: "status",
                    width: 100,
                    render: (value: string) => {
                        const status = statusLabels[value];
                        return <Tag color={status?.color || "default"}>{status ? t(status.key) : value || t("account.logs.values.unknown")}</Tag>;
                    },
                },
                {
                    title: t("account.logs.table.credits"),
                    dataIndex: "credits",
                    width: 100,
                    render: (value: string) => t("account.logs.values.credits", { count: Number(value), value: formatDecimal(value) }),
                },
                { title: t("account.logs.table.upstreamCredits"), dataIndex: "upstreamCredits", width: 120, render: (_, item) => (item.taskType === "video" ? (item.upstreamCredits ?? t("common.states.notAvailable")) : "-") },
                {
                    title: t("account.logs.table.duration"),
                    dataIndex: "latencyMs",
                    width: 100,
                    render: (value: number) =>
                        value
                            ? t("account.logs.values.seconds", {
                                  value: formatNumber(value / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                              })
                            : "-",
                },
                { title: t("account.logs.table.time"), dataIndex: "createdAt", width: 180, render: (value: string) => (value ? formatDateTime(value) : "-") },
            ]}
        />
    );
}

export function AccountUsageLogs() {
    const { message } = App.useApp();
    const { t } = useTranslation();
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
                setError(reason instanceof Error ? reason.message : t("account.logs.usage.messages.loadError"));
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, page, pageSize, startTime, t, token, userId]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchGenerationTasks({ start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning(t("account.logs.usage.messages.emptyExport"));
                return;
            }
            downloadCsv(t("account.logs.usage.export.fileName"), createUsageCsvColumns(t), rows);
            message.success(t("account.logs.usage.messages.exportSuccess"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("account.logs.usage.messages.exportError"));
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <Space wrap className="mb-4">
                <DatePicker.RangePicker
                    value={range}
                    format={t("account.logs.filters.dateFormat")}
                    placeholder={[t("account.logs.filters.startDate"), t("account.logs.filters.endDate")]}
                    onChange={(value) => {
                        setRange(value as LogDateRange);
                        setPage(1);
                    }}
                />
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>
                    {t("account.logs.usage.export.button")}
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
                    showTotal: (value) => t("account.logs.pagination.total", { count: value, value: formatNumber(value) }),
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
    const { t } = useTranslation();
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
                setError(reason instanceof Error ? reason.message : t("account.logs.credits.messages.loadError"));
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, page, pageSize, startTime, t, token, user?.credits, user?.id]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchUserCreditLogs(token, { start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning(t("account.logs.credits.messages.emptyExport"));
                return;
            }
            downloadCsv(t("account.logs.credits.export.fileName"), createCreditCsvColumns(t), rows);
            message.success(t("account.logs.credits.messages.exportSuccess"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("account.logs.credits.messages.exportError"));
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <Space wrap className="mb-4">
                <DatePicker.RangePicker
                    value={range}
                    format={t("account.logs.filters.dateFormat")}
                    placeholder={[t("account.logs.filters.startDate"), t("account.logs.filters.endDate")]}
                    onChange={(value) => {
                        setRange(value as LogDateRange);
                        setPage(1);
                    }}
                />
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>
                    {t("account.logs.credits.export.button")}
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
                    showTotal: (value) => t("account.logs.pagination.total", { count: value, value: formatNumber(value) }),
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
    const { t } = useTranslation();

    return (
        <Table<UserCreditLog>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={pagination}
            scroll={{ x: 900 }}
            columns={[
                { title: t("account.logs.table.type"), dataIndex: "type", width: 120, render: (value: string) => <Tag>{creditLogTypeKeys[value] ? t(creditLogTypeKeys[value]) : value || "-"}</Tag> },
                {
                    title: t("account.logs.table.change"),
                    dataIndex: "amount",
                    width: 100,
                    render: (value: string) => <span className={compareDecimal(value, "0") >= 0 ? "text-green-600" : "text-red-500"}>{compareDecimal(value, "0") > 0 ? `+${formatDecimal(value)}` : formatDecimal(value)}</span>,
                },
                { title: t("account.logs.table.balance"), dataIndex: "balance", width: 100, render: (value: string) => formatDecimal(value) },
                { title: t("account.logs.table.relatedTask"), width: 220, render: (_, item) => item.taskId || item.relatedId || "-" },
                { title: t("account.logs.table.remark"), dataIndex: "remark", ellipsis: true, render: (value: string) => value || "-" },
                { title: t("account.logs.table.time"), dataIndex: "createdAt", width: 180, render: (value: string) => (value ? formatDateTime(value) : "-") },
            ]}
        />
    );
}
