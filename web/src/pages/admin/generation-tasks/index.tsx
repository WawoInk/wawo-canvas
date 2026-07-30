"use client";

import { DeleteOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Form, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { AdminGenerationTask, AdminGenerationTaskDetailResponse } from "@/services/api/admin";
import { generationTaskStatus } from "./generation-task-status";
import { useAdminGenerationTasks } from "./use-admin-generation-tasks";

const taskTypeLabels: Record<string, string> = {
    image: "图片生成",
    video: "视频生成",
    audio: "音频生成",
    chat: "对话",
};

const taskTypeColors: Record<string, string> = {
    image: "purple",
    video: "blue",
    audio: "orange",
    chat: "green",
};

export default function AdminGenerationTasksPage() {
    const { tasks, keyword, taskType, status, page, pageSize, total, isLoading, isDeleting, searchLogs, filterByType, filterByStatus, changePage, changePageSize, resetFilters, refreshLogs, fetchDetail, deleteTask, batchDeleteTasks } =
        useAdminGenerationTasks();
    const [keywordText, setKeywordText] = useState(keyword);
    const [detail, setDetail] = useState<AdminGenerationTaskDetailResponse | null>(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

    const handleDelete = (item: AdminGenerationTask) => {
        Modal.confirm({
            title: "确认删除",
            content: `确定删除该条使用日志吗？用户: ${item.username || item.userId}, 模型: ${item.modelDisplayName || item.model}`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
            onOk: () => deleteTask(item.id),
        });
    };

    const handleBatchDelete = () => {
        if (selectedRowKeys.length === 0) return;
        Modal.confirm({
            title: "确认批量删除",
            content: `确定删除选中的 ${selectedRowKeys.length} 条使用日志吗？此操作不可恢复。`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
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
            title: "用户 ID",
            dataIndex: "userId",
            width: 220,
            render: (_, item) => (
                <Typography.Text copyable ellipsis style={{ maxWidth: 180 }}>
                    {item.userId}
                </Typography.Text>
            ),
        },
        {
            title: "用户名",
            dataIndex: "username",
            width: 120,
            render: (_, item) => <Typography.Text>{item.username || "-"}</Typography.Text>,
        },
        {
            title: "任务类型",
            dataIndex: "taskType",
            width: 100,
            render: (_, item) => <Tag color={taskTypeColors[item.taskType] || "default"}>{taskTypeLabels[item.taskType] || item.taskType}</Tag>,
        },
        {
            title: "模型",
            dataIndex: "model",
            width: 160,
            ellipsis: true,
        },
        {
            title: "模型展示名",
            dataIndex: "modelDisplayName",
            width: 160,
            ellipsis: true,
            render: (_, item) => item.modelDisplayName || item.model || "-",
        },
        {
            title: "Provider",
            dataIndex: "provider",
            width: 100,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (_, item) => {
                const status = generationTaskStatus(item.status);
                return <Tag color={status.color}>{status.label}</Tag>;
            },
        },
        {
            title: "扣费",
            dataIndex: "credits",
            width: 80,
            render: (_, item) => <Typography.Text type={item.credits > 0 ? "danger" : "secondary"}>{item.credits > 0 ? `-${item.credits}` : item.credits}</Typography.Text>,
        },
        {
            title: "上游 Credits",
            dataIndex: "upstreamCredits",
            width: 112,
            render: (_, item) => <Typography.Text type="secondary">{item.taskType === "video" ? (item.upstreamCredits ?? "null") : "-"}</Typography.Text>,
        },
        {
            title: "耗时",
            dataIndex: "latencyMs",
            width: 80,
            render: (_, item) => <Typography.Text type="secondary">{item.latencyMs > 0 ? `${(item.latencyMs / 1000).toFixed(1)}s` : "-"}</Typography.Text>,
        },
        {
            title: "错误信息",
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
            title: "创建时间",
            dataIndex: "createdAt",
            width: 170,
            render: (_, item) => <Typography.Text type="secondary">{item.createdAt ? dayjs(item.createdAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 108,
            align: "right",
            render: (_, item) => (
                <Space size={0}>
                    <Tooltip title="查看详情">
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
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
                                <Form.Item label="用户 ID">
                                    <Input value={keywordText} placeholder="搜索用户 ID" allowClear prefix={<SearchOutlined />} onPressEnter={() => searchLogs(keywordText)} onChange={(event) => setKeywordText(event.target.value)} />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label="任务类型">
                                    <Select
                                        value={taskType || undefined}
                                        placeholder="全部"
                                        allowClear
                                        options={[
                                            { label: "图片生成", value: "image" },
                                            { label: "视频生成", value: "video" },
                                            { label: "音频生成", value: "audio" },
                                            { label: "对话", value: "chat" },
                                        ]}
                                        onChange={(value) => filterByType(value || "")}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="140px">
                                <Form.Item label="状态">
                                    <Select
                                        value={status || undefined}
                                        placeholder="全部"
                                        allowClear
                                        options={[
                                            { label: "成功", value: "success" },
                                            { label: "失败", value: "failed" },
                                            { label: "运行中", value: "running" },
                                            { label: "已取消", value: "cancelled" },
                                        ]}
                                        onChange={(value) => filterByStatus(value || "")}
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
                                            重置
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchLogs(keywordText)}>
                                            查询
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
                            <Typography.Text strong>使用日志</Typography.Text>
                            <Tag>{total} 条</Tag>
                            {selectedRowKeys.length > 0 && (
                                <Button size="small" danger icon={<DeleteOutlined />} loading={isDeleting} onClick={handleBatchDelete}>
                                    删除选中 ({selectedRowKeys.length})
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
                        showTotal: (value) => `共 ${value} 条`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Space>

            {/* Detail Modal */}
            <Modal title="任务详情" open={Boolean(detail)} width={800} footer={null} onCancel={() => setDetail(null)} destroyOnHidden>
                {detail && (
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Row gutter={24}>
                            <Col span={8}>
                                <Typography.Text type="secondary">任务 ID</Typography.Text>
                                <br />
                                <Typography.Text copyable>{detail.task.id}</Typography.Text>
                            </Col>
                            <Col span={8}>
                                <Typography.Text type="secondary">用户 ID</Typography.Text>
                                <br />
                                <Typography.Text copyable>{detail.task.userId}</Typography.Text>
                            </Col>
                            <Col span={8}>
                                <Typography.Text type="secondary">上游任务</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.upstreamTaskId || "-"}</Typography.Text>
                            </Col>
                        </Row>
                        <Row gutter={24}>
                            <Col span={6}>
                                <Typography.Text type="secondary">类型</Typography.Text>
                                <br />
                                <Tag color={taskTypeColors[detail.task.taskType]}>{taskTypeLabels[detail.task.taskType] || detail.task.taskType}</Tag>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">状态</Typography.Text>
                                <br />
                                <Tag color={generationTaskStatus(detail.task.status).color}>{generationTaskStatus(detail.task.status).label}</Tag>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">扣费</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.credits}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">上游 Credits</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.taskType === "video" ? (detail.task.upstreamCredits ?? "null") : "-"}</Typography.Text>
                            </Col>
                        </Row>
                        <Row gutter={24}>
                            <Col span={6}>
                                <Typography.Text type="secondary">Provider</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.provider}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">模型</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.model}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">创建时间</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.createdAt ? dayjs(detail.task.createdAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>
                            </Col>
                            <Col span={6}>
                                <Typography.Text type="secondary">耗时</Typography.Text>
                                <br />
                                <Typography.Text>{detail.task.latencyMs > 0 ? `${(detail.task.latencyMs / 1000).toFixed(1)}s` : "-"}</Typography.Text>
                            </Col>
                        </Row>
                        {detail.task.errorMessage && (
                            <div>
                                <Typography.Text type="secondary">错误信息</Typography.Text>
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
                                    请求体
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
                                    {formatJSON(detail.payload.requestBody)}
                                </pre>
                                <Typography.Text strong style={{ marginTop: 8, display: "block" }}>
                                    响应体
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
                                    {formatJSON(detail.payload.responseBody)}
                                </pre>
                                {detail.payload.rawError && (
                                    <>
                                        <Typography.Text strong type="danger" style={{ marginTop: 8, display: "block" }}>
                                            原始错误
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

function formatJSON(value: string | undefined): string {
    if (!value) return "(无数据)";
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value.length > 4000 ? value.slice(0, 4000) + "...(截断)" : value;
    }
}
