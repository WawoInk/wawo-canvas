"use client";

import { Button, Card, Col, DatePicker, Form, Input, Row, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import { SearchOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import type { AdminCanvasNode } from "@/services/api/admin";
import { useAdminCanvasNodes } from "./use-admin-canvas-nodes";

export default function AdminCanvasNodesPage() {
    const { t } = useTranslation();
    const { nodes, filters, page, pageSize, total, isLoading, setFilters, changePage, changePageSize, resetFilters } = useAdminCanvasNodes();
    const [filterInputs, setFilterInputs] = useState(filters);
    const columns: TableColumnsType<AdminCanvasNode> = [
        { title: t("admin.canvasNodes.table.userId"), dataIndex: "userId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.username"), dataIndex: "username", width: 140, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.nodeId"), dataIndex: "nodeId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.upstreamTaskId"), dataIndex: "upstreamTaskId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.createdAt"), dataIndex: "createdAt", width: 180, render: (value: string) => <Typography.Text type="secondary">{value ? formatDateTime(value) : "-"}</Typography.Text> },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Space orientation="vertical" size={16} style={{ display: "flex" }}>
                <Card>
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="220px">
                                <Form.Item label={t("admin.canvasNodes.filters.userId")}>
                                    <Input value={filterInputs.userId} placeholder={t("admin.canvasNodes.filters.userIdPlaceholder")} allowClear onChange={(event) => setFilterInputs((value) => ({ ...value, userId: event.target.value }))} />
                                </Form.Item>
                            </Col>
                            <Col flex="180px">
                                <Form.Item label={t("admin.canvasNodes.filters.username")}>
                                    <Input value={filterInputs.username} placeholder={t("admin.canvasNodes.filters.usernamePlaceholder")} allowClear onChange={(event) => setFilterInputs((value) => ({ ...value, username: event.target.value }))} />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label={t("admin.canvasNodes.filters.nodeId")}>
                                    <Input value={filterInputs.nodeId} placeholder={t("admin.canvasNodes.filters.nodeIdPlaceholder")} allowClear onChange={(event) => setFilterInputs((value) => ({ ...value, nodeId: event.target.value }))} />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label={t("admin.canvasNodes.filters.upstreamTaskId")}>
                                    <Input
                                        value={filterInputs.upstreamTaskId}
                                        placeholder={t("admin.canvasNodes.filters.upstreamTaskIdPlaceholder")}
                                        allowClear
                                        onChange={(event) => setFilterInputs((value) => ({ ...value, upstreamTaskId: event.target.value }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="260px">
                                <Form.Item label={t("admin.canvasNodes.filters.createdAt")}>
                                    <DatePicker.RangePicker
                                        value={filterInputs.dateRange}
                                        format={t("admin.common.filters.dateFormat")}
                                        placeholder={[t("admin.common.filters.startDate"), t("admin.common.filters.endDate")]}
                                        onChange={(value) => setFilterInputs((current) => ({ ...current, dateRange: value as [Dayjs, Dayjs] | null }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setFilterInputs({ userId: "", username: "", nodeId: "", upstreamTaskId: "", dateRange: null });
                                                resetFilters();
                                            }}
                                        >
                                            {t("admin.common.actions.reset")}
                                        </Button>
                                        <Button type="primary" icon={<SearchOutlined />} onClick={() => setFilters(filterInputs)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                    <Table<AdminCanvasNode>
                        rowKey={(node) => `${node.userId}:${node.nodeId}`}
                        columns={columns}
                        dataSource={nodes}
                        loading={isLoading}
                        tableLayout="fixed"
                        scroll={{ x: 1840 }}
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
                </Card>
            </Space>
        </main>
    );
}
