"use client";

import { DeleteOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { Dayjs } from "dayjs";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import type { AdminGenerationTask, AdminGenerationTaskDetailResponse } from "@/services/api/admin";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { generationTaskStatus } from "./generation-task-status";
import { useAdminGenerationTasks } from "./use-admin-generation-tasks";

const taskTypeLabelKeys: Record<string, string> = {
    image: "admin.generationTasks.types.image",
    video: "admin.generationTasks.types.video",
    audio: "admin.generationTasks.types.audio",
    chat: "admin.generationTasks.types.chat",
};

const taskTypeColors: Record<string, string> = {
    image: "purple",
    video: "blue",
    audio: "orange",
    chat: "green",
};

export default function AdminGenerationTasksPage() {
    const { t } = useTranslation();
    const { tasks, keyword, taskType, status, dateRange, page, pageSize, total, isLoading, isDeleting, searchLogs, filterByType, filterByStatus, filterByDateRange, changePage, changePageSize, resetFilters, refreshLogs, fetchDetail, deleteTask, batchDeleteTasks } =
        useAdminGenerationTasks();
    const [keywordText, setKeywordText] = useState(keyword);
    const [detail, setDetail] = useState<AdminGenerationTaskDetailResponse | null>(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

    const handleDelete = (item: AdminGenerationTask) => {
        Modal.confirm({
            title: t("admin.generationTasks.delete.title"),
            content: t("admin.generationTasks.delete.confirm", { user: item.username || item.userId, model: item.modelDisplayName || item.model }),
            okText: t("admin.common.actions.delete"),
            okType: "danger",
            cancelText: t("admin.common.actions.cancel"),
            onOk: () => deleteTask(item.id),
        });
    };

    const handleBatchDelete = () => {
        if (selectedRowKeys.length === 0) return;
        Modal.confirm({
            title: t("admin.generationTasks.batchDelete.title"),
            content: t("admin.generationTasks.batchDelete.confirm", { count: selectedRowKeys.length, value: formatNumber(selectedRowKeys.length) }),
            okText: t("admin.common.actions.delete"),
            okType: "danger",
            cancelText: t("admin.common.actions.cancel"),
            onOk: () => {
                batchDeleteTasks(selectedRowKeys);
                setSelectedRowKeys([]);
            },
        });
    };

    useEffect(() => setKeywordText(keyword), [keyword]);

    const openDetail = async (task: AdminGenerationTask) => {
        const result = await fetchDetail(task.id);
        setDetail(result);
    };

    const columns: ProColumns<AdminGenerationTask>[] = [
        {
            title: t("admin.generationTasks.table.userId"),
            dataIndex: "userId",
            width: 220,
            render: (_, item) => (
                <Typography.Text copyable ellipsis style={{ maxWidth: 180 }}>
                    {item.userId}
                </Typography.Text>
            ),
        },
        {
            title: t("admin.generationTasks.table.username"),
            dataIndex: "username",
            width: 120,
            render: (_, item) => <Typography.Text>{item.username || "-"}</Typography.Text>,
        },
        {
            title: t("admin.generationTasks.table.taskType"),
            dataIndex: "taskType",
            width: 100,
            render: (_, item) => <Tag color={taskTypeColors[item.taskType] || "default"}>{taskTypeLabelKeys[item.taskType] ? t(taskTypeLabelKeys[item.taskType]) : item.taskType}</Tag>,
        },
        {
            title: t("admin.generationTasks.table.model"),
            dataIndex: "model",
            width: 160,
            ellipsis: true,
        },
        {
            title: t("admin.generationTasks.table.modelDisplayName"),
            dataIndex: "modelDisplayName",
            width: 160,
            ellipsis: true,
            render: (_, item) => item.modelDisplayName || item.model || "-",
        },
        {
            title: t("admin.generationTasks.table.provider"),
            dataIndex: "provider",
            width: 100,
        },
        {
            title: t("admin.generationTasks.table.status"),
            dataIndex: "status",
            width: 90,
            render: (_, item) => {
                const status = generationTaskStatus(item.status);
                return <Tag color={status.color}>{t(status.labelKey)}</Tag>;
            },
        },
        {
            title: t("admin.generationTasks.table.credits"),
            dataIndex: "credits",
            width: 80,
            render: (_, item) => <Typography.Text type={compareDecimal(item.credits, "0") > 0 ? "danger" : "secondary"}>{compareDecimal(item.credits, "0") > 0 ? `-${formatDecimal(item.credits)}` : formatDecimal(item.credits)}</Typography.Text>,
        },
        {
            title: t("admin.generationTasks.table.upstreamCredits"),
            dataIndex: "upstreamCredits",
            width: 112,
            render: (_, item) => <Typography.Text type="secondary">{item.taskType === "video" ? (item.upstreamCredits ?? "null") : "-"}</Typography.Text>,
        },
        {
            title: t("admin.generationTasks.table.duration"),
            dataIndex: "latencyMs",
            width: 80,
            render: (_, item) => (
                <Typography.Text type="secondary">{item.latencyMs > 0 ? t("admin.generationTasks.values.seconds", { value: formatNumber(item.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : "-"}</Typography.Text>
            ),
        },
        {
            title: t("admin.generationTasks.table.error"),
            dataIndex: "errorMessage",
            ellipsis: true,
            width: 180,
            render: (_, item) =>
                item.errorMessage ? (
                    <Typography.Text type="danger" ellipsis style={{ maxWidth: 160 }}>
                        {item.errorMessage}
                    </Typography.Text>
                ) : (
                    <Typography.Text type="secondary">-</Typography.Text>
                ),
        },
        {
            title: t("admin.common.table.createdAt"),
            dataIndex: "createdAt",
            width: 170,
            render: (_, item) => <Typography.Text type="secondary">{item.createdAt ? formatDateTime(item.createdAt) : "-"}</Typography.Text>,
        },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 108,
            align: "right",
            render: (_, item) => (
                <Space size={0}>
                    <Tooltip title={t("admin.common.actions.viewDetails")}>
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.delete")}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={isDeleting} onClick={() => handleDelete(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="240px">
                                <Form.Item label={t("admin.generationTasks.filters.userId")}>
                                    <Input
                                        value={keywordText}
                                        placeholder={t("admin.generationTasks.filters.userIdPlaceholder")}
                                        allowClear
                                        prefix={<SearchOutlined />}
                                        onPressEnter={() => searchLogs(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label={t("admin.generationTasks.filters.taskType")}>
                                    <Select
                                        value={taskType || undefined}
                                        placeholder={t("admin.common.filters.all")}
                                        allowClear
                                        options={[
                                            { label: t("admin.generationTasks.types.image"), value: "image" },
                                            { label: t("admin.generationTasks.types.video"), value: "video" },
                                            { label: t("admin.generationTasks.types.audio"), value: "audio" },
                                            { label: t("admin.generationTasks.types.chat"), value: "chat" },
                                        ]}
                                        onChange={(value) => filterByType(value || "")}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label={t("admin.generationTasks.filters.status")}>
                                    <Select
                                        value={status || undefined}
                                        placeholder={t("admin.common.filters.all")}
                                        allowClear
                                        options={[
                                            { label: t("admin.generationTasks.statuses.success"), value: "success" },
                                            { label: t("admin.generationTasks.statuses.failed"), value: "failed" },
                                            { label: t("admin.generationTasks.statuses.running"), value: "running" },
                                            { label: t("admin.generationTasks.statuses.cancelled"), value: "cancelled" },
                                        ]}
                                        onChange={(value) => filterByStatus(value || "")}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="260px">
                                <Form.Item label={t("admin.common.filters.dateRange")}>
                                    <DatePicker.RangePicker
                                        value={dateRange}
                                        format={t("admin.common.filters.dateFormat")}
                                        placeholder={[t("admin.common.filters.startDate"), t("admin.common.filters.endDate")]}
                                        onChange={(value) => filterByDateRange(value as [Dayjs, Dayjs] | null)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setKeywordText("");
                                                resetFilters();
                                            }}
                                        >
                                            {t("admin.common.actions.reset")}
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchLogs(keywordText)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminGenerationTask>
                    rowKey="id"
                    columns={columns}
                    dataSource={tasks}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    scroll={{ x: 1672 }}
                    cardProps={{ variant: "borderless" }}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (keys) => setSelectedRowKeys(keys as string[]),
                    }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.generationTasks.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.records", { count: total, value: formatNumber(total) })}</Tag>
                            {selectedRowKeys.length > 0 && (
                                <Button size="small" danger icon={<DeleteOutlined />} loading={isDeleting} onClick={handleBatchDelete}>
                                    {t("admin.generationTasks.actions.deleteSelected", { count: selectedRowKeys.length, value: formatNumber(selectedRowKeys.length) })}
                                </Button>
                            )}
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshLogs() }}
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

            <Modal title={t("admin.generationTasks.detail.title")} open={Boolean(detail)} width={800} footer={null} onCancel={() => setDetail(null)} destroyOnHidden>
                {detail && (
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Row gutter={24}>
                            <Col span={8}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.taskId")}</Typography.Text>
                                <br />
                                <Typography.Text copyable>{detail.task.id}</Typography.Text>
                            </Col>
                            <Col span={8}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.userId")}</Typography.Text>
                                <br />
                                <Typography.Text copyable>{detail.task.userId}</Typography.Text>
                            </Col>
                            <Col span={8}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.upstreamTask")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.upstreamTaskId || "-"}</Typography.Text>
                            </Col>
                        </Row>
                        <Row gutter={24}>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.type")}</Typography.Text>
                                <br />
                                <Tag color={taskTypeColors[detail.task.taskType]}>{taskTypeLabelKeys[detail.task.taskType] ? t(taskTypeLabelKeys[detail.task.taskType]) : detail.task.taskType}</Tag>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.status")}</Typography.Text>
                                <br />
                                <Tag color={generationTaskStatus(detail.task.status).color}>{t(generationTaskStatus(detail.task.status).labelKey)}</Tag>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.credits")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.credits}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.upstreamCredits")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.taskType === "video" ? (detail.task.upstreamCredits ?? "null") : "-"}</Typography.Text>
                            </Col>
                        </Row>
                        <Row gutter={24}>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.provider")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.provider}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.model")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.model}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.common.table.createdAt")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.createdAt ? formatDateTime(detail.task.createdAt) : "-"}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.duration")}</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.latencyMs > 0 ? t("admin.generationTasks.values.seconds", { value: formatNumber(detail.task.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : "-"}</Typography.Text>
                            </Col>
                        </Row>
                        {detail.task.errorMessage && (
                            <div>
                                <Typography.Text type="secondary">{t("admin.generationTasks.detail.error")}</Typography.Text>
                                <br />
                                <Typography.Text type="danger">
                                    {detail.task.errorCode ? `[${detail.task.errorCode}] ` : ""}
                                    {detail.task.errorMessage}
                                </Typography.Text>
                            </div>
                        )}
                        {detail.payload && (
                            <>
                                <Typography.Text strong style={{ marginTop: 8, display: "block" }}>
                                    {t("admin.generationTasks.detail.requestBody")}
                                </Typography.Text>
                                <pre
                                    style={{
                                        maxHeight: 240,
                                        overflow: "auto",
                                        background: "var(--color-fill-tertiary)",
                                        padding: 12,
                                        borderRadius: 6,
                                        fontSize: 12,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-all",
                                    }}
                                >
                                    {formatJSON(detail.payload.requestBody, t)}
                                </pre>
                                <Typography.Text strong style={{ marginTop: 8, display: "block" }}>
                                    {t("admin.generationTasks.detail.responseBody")}
                                </Typography.Text>
                                <pre
                                    style={{
                                        maxHeight: 240,
                                        overflow: "auto",
                                        background: "var(--color-fill-tertiary)",
                                        padding: 12,
                                        borderRadius: 6,
                                        fontSize: 12,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-all",
                                    }}
                                >
                                    {formatJSON(detail.payload.responseBody, t)}
                                </pre>
                                {detail.payload.rawError && (
                                    <>
                                        <Typography.Text strong type="danger" style={{ marginTop: 8, display: "block" }}>
                                            {t("admin.generationTasks.detail.rawError")}
                                        </Typography.Text>
                                        <pre
                                            style={{
                                                maxHeight: 160,
                                                overflow: "auto",
                                                background: "var(--color-fill-tertiary)",
                                                padding: 12,
                                                borderRadius: 6,
                                                fontSize: 12,
                                                color: "var(--color-error)",
                                            }}
                                        >
                                            {detail.payload.rawError}
                                        </pre>
                                    </>
                                )}
                            </>
                        )}
                    </Space>
                )}
            </Modal>
        </main>
    );
}

function formatJSON(value: string | undefined, t: TFunction): string {
    if (!value) return t("admin.generationTasks.values.noData");
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value.length > 4000 ? `${value.slice(0, 4000)}${t("admin.generationTasks.values.truncated")}` : value;
    }
}
