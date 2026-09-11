"use client";

import { DownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Card, Col, DatePicker, Form, Input, Row, Select, Space, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { downloadCsv, type CsvColumn } from "@/pages/account/account-log-export";
import type { AdminEnterpriseCreditLog } from "@/services/api/admin";
import { generationTaskStatus } from "../generation-tasks/generation-task-status";
import { emptyAdminEnterpriseCreditLogFilters, useAdminEnterpriseCreditLogs, type AdminEnterpriseCreditLogFilters } from "./use-admin-enterprise-credit-logs";

const typeLabelKeys: Record<string, string> = {
    admin_adjust: "admin.enterpriseCreditLogs.types.admin_adjust",
    enterprise_allocate: "admin.enterpriseCreditLogs.types.enterprise_allocate",
    enterprise_reclaim: "admin.enterpriseCreditLogs.types.enterprise_reclaim",
    ai_consume: "admin.enterpriseCreditLogs.types.ai_consume",
    ai_refund: "admin.enterpriseCreditLogs.types.ai_refund",
};

const typeLabel = (t: TFunction, type: string) => (typeLabelKeys[type] ? t(typeLabelKeys[type]) : type || "-");
const statusLabel = (t: TFunction, status: string) => (status ? t(generationTaskStatus(status).labelKey) : "-");

function createCsvColumns(t: TFunction): CsvColumn<AdminEnterpriseCreditLog>[] {
    return [
        { title: t("admin.enterpriseCreditLogs.filters.enterpriseId"), value: (item) => item.enterpriseId },
        { title: t("admin.enterpriseCreditLogs.filters.enterpriseName"), value: (item) => item.enterpriseName },
        { title: t("admin.enterpriseCreditLogs.table.account"), value: (item) => item.displayName || item.username },
        { title: t("admin.enterpriseCreditLogs.table.userId"), value: (item) => item.userId },
        { title: t("admin.enterpriseCreditLogs.table.model"), value: (item) => item.model },
        { title: t("admin.enterpriseCreditLogs.table.type"), value: (item) => typeLabel(t, item.type) },
        { title: t("admin.enterpriseCreditLogs.table.amount"), value: (item) => formatDecimal(item.amount) },
        { title: t("admin.enterpriseCreditLogs.table.status"), value: (item) => statusLabel(t, item.status) },
        { title: t("admin.enterpriseCreditLogs.table.remark"), value: (item) => item.remark },
        { title: t("admin.enterpriseCreditLogs.table.time"), value: (item) => (item.createdAt ? formatDateTime(item.createdAt) : "") },
    ];
}

export default function AdminEnterpriseCreditLogsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const { logs, total, filters, page, pageSize, isLoading, applyFilters, resetFilters, changePage, changePageSize, refreshLogs, fetchAll } = useAdminEnterpriseCreditLogs();
    const [draft, setDraft] = useState<AdminEnterpriseCreditLogFilters>(filters);
    const [exporting, setExporting] = useState(false);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAll();
            if (!rows.length) {
                message.warning(t("admin.enterpriseCreditLogs.messages.emptyExport"));
                return;
            }
            downloadCsv(t("admin.enterpriseCreditLogs.export.fileName"), createCsvColumns(t), rows);
            message.success(t("admin.enterpriseCreditLogs.messages.exportSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin.enterpriseCreditLogs.messages.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const columns: ProColumns<AdminEnterpriseCreditLog>[] = [
        {
            title: t("admin.enterpriseCreditLogs.table.enterprise"),
            width: 220,
            render: (_, item) => (
                <div>
                    <div>{item.enterpriseName}</div>
                    <Typography.Text type="secondary" copyable ellipsis style={{ maxWidth: 190 }}>
                        {item.enterpriseId}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: t("admin.enterpriseCreditLogs.table.account"),
            width: 180,
            render: (_, item) => (
                <div>
                    <div>{item.displayName || item.username}</div>
                    <Typography.Text type="secondary">{item.username}</Typography.Text>
                </div>
            ),
        },
        { title: t("admin.enterpriseCreditLogs.table.model"), dataIndex: "model", width: 180, ellipsis: true, render: (_, item) => item.model || "-" },
        { title: t("admin.enterpriseCreditLogs.table.type"), dataIndex: "type", width: 120, render: (_, item) => <Tag color={item.type === "ai_refund" ? "green" : item.type === "ai_consume" ? "red" : "default"}>{typeLabel(t, item.type)}</Tag> },
        {
            title: t("admin.enterpriseCreditLogs.table.amount"),
            dataIndex: "amount",
            width: 110,
            render: (_, item) => <Typography.Text type={compareDecimal(item.amount, "0") >= 0 ? "success" : "danger"}>{compareDecimal(item.amount, "0") > 0 ? `+${formatDecimal(item.amount)}` : formatDecimal(item.amount)}</Typography.Text>,
        },
        {
            title: t("admin.enterpriseCreditLogs.table.status"),
            dataIndex: "status",
            width: 100,
            render: (_, item) => (item.status ? <Tag color={generationTaskStatus(item.status).color}>{statusLabel(t, item.status)}</Tag> : "-"),
        },
        { title: t("admin.enterpriseCreditLogs.table.remark"), dataIndex: "remark", ellipsis: true, render: (_, item) => item.remark || "-" },
        { title: t("admin.enterpriseCreditLogs.table.time"), dataIndex: "createdAt", width: 180, render: (_, item) => (item.createdAt ? formatDateTime(item.createdAt) : "-") },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="220px">
                                <Form.Item label={t("admin.enterpriseCreditLogs.filters.enterpriseId")}>
                                    <Input
                                        value={draft.enterpriseId}
                                        placeholder={t("admin.enterpriseCreditLogs.filters.enterpriseIdPlaceholder")}
                                        allowClear
                                        onChange={(event) => setDraft({ ...draft, enterpriseId: event.target.value })}
                                        onPressEnter={() => applyFilters(draft)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="180px">
                                <Form.Item label={t("admin.enterpriseCreditLogs.filters.enterpriseName")}>
                                    <Input
                                        value={draft.enterpriseName}
                                        placeholder={t("admin.enterpriseCreditLogs.filters.enterpriseNamePlaceholder")}
                                        allowClear
                                        onChange={(event) => setDraft({ ...draft, enterpriseName: event.target.value })}
                                        onPressEnter={() => applyFilters(draft)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="180px">
                                <Form.Item label={t("admin.enterpriseCreditLogs.filters.model")}>
                                    <Input
                                        value={draft.model}
                                        placeholder={t("admin.enterpriseCreditLogs.filters.modelPlaceholder")}
                                        allowClear
                                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                                        onPressEnter={() => applyFilters(draft)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label={t("admin.enterpriseCreditLogs.filters.status")}>
                                    <Select
                                        value={draft.status || undefined}
                                        placeholder={t("admin.common.filters.all")}
                                        allowClear
                                        options={["queued", "running", "succeeded", "failed", "cancelled"].map((value) => ({ value, label: statusLabel(t, value) }))}
                                        onChange={(value) => setDraft({ ...draft, status: value || "" })}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="250px">
                                <Form.Item label={t("admin.enterpriseCreditLogs.filters.dateRange")}>
                                    <DatePicker.RangePicker
                                        value={draft.dateRange}
                                        format={t("admin.common.filters.dateFormat")}
                                        placeholder={[t("admin.common.filters.startDate"), t("admin.common.filters.endDate")]}
                                        onChange={(value) => setDraft({ ...draft, dateRange: value as [Dayjs, Dayjs] | null })}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setDraft(emptyAdminEnterpriseCreditLogFilters);
                                                resetFilters();
                                            }}
                                        >
                                            {t("admin.common.actions.reset")}
                                        </Button>
                                        <Button type="primary" icon={<SearchOutlined />} onClick={() => applyFilters(draft)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminEnterpriseCreditLog>
                    rowKey="id"
                    columns={columns}
                    dataSource={logs}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    scroll={{ x: 1250 }}
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.enterpriseCreditLogs.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.records", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshLogs() }}
                    toolBarRender={() => [
                        <Button key="export" icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportLogs()}>
                            {t("admin.enterpriseCreditLogs.export.button")}
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => t("admin.common.pagination.records", { count: value, value: formatNumber(value) }),
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Space>
        </main>
    );
}
