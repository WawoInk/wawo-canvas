"use client";

import { Card, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import type { AdminCanvasNode } from "@/services/api/admin";
import { useAdminCanvasNodes } from "./use-admin-canvas-nodes";

export default function AdminCanvasNodesPage() {
    const { t } = useTranslation();
    const { nodes, page, pageSize, total, isLoading, changePage, changePageSize } = useAdminCanvasNodes();
    const columns: TableColumnsType<AdminCanvasNode> = [
        { title: t("admin.canvasNodes.table.userId"), dataIndex: "userId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.username"), dataIndex: "username", width: 140, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.nodeId"), dataIndex: "nodeId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.upstreamTaskId"), dataIndex: "upstreamTaskId", width: 220, render: (value: string) => <Typography.Text>{value || "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.createdAt"), dataIndex: "createdAt", width: 180, render: (value: string) => <Typography.Text type="secondary">{value ? formatDateTime(value) : "-"}</Typography.Text> },
        { title: t("admin.canvasNodes.table.resultUrl"), dataIndex: "resultUrl", width: 360, render: (value: string) => <Typography.Text style={{ wordBreak: "break-all" }}>{value || "-"}</Typography.Text> },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                <Table<AdminCanvasNode>
                    rowKey={(node) => `${node.userId}:${node.nodeId}`}
                    columns={columns}
                    dataSource={nodes}
                    loading={isLoading}
                    scroll={{ x: 1340 }}
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
        </main>
    );
}
