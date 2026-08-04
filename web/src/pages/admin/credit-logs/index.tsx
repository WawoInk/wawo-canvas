"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import type { AdminCreditLog } from "@/services/api/admin";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { useAdminCreditLogs } from "./use-admin-credit-logs";

type CreditLogFormValues = Partial<AdminCreditLog>;

const creditLogTypeKeys: Record<string, string> = {
    admin_adjust: "admin.creditLogs.types.adminAdjust",
    ai_consume: "admin.creditLogs.types.aiConsume",
    ai_refund: "admin.creditLogs.types.aiRefund",
    enterprise_allocate: "admin.creditLogs.types.enterpriseAllocate",
    enterprise_reclaim: "admin.creditLogs.types.enterpriseReclaim",
};

export default function AdminCreditLogsPage() {
    const { t } = useTranslation();
    const { logs, keyword, page, pageSize, total, isLoading, searchLogs, changePage, changePageSize, resetFilters, refreshLogs, saveLog: saveAdminLog, deleteLog } = useAdminCreditLogs();
    const [form] = Form.useForm<CreditLogFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingLog, setEditingLog] = useState<Partial<AdminCreditLog> | null>(null);
    const [deletingLog, setDeletingLog] = useState<AdminCreditLog | null>(null);

    useEffect(() => setKeywordText(keyword), [keyword]);

    useEffect(() => {
        if (editingLog) form.setFieldsValue({ type: "admin_adjust", amount: "0", balance: "0", ...editingLog });
    }, [editingLog, form]);

    const saveLog = async () => {
        const value = await form.validateFields();
        await saveAdminLog({ ...editingLog, ...value });
        setEditingLog(null);
    };

    const columns: ProColumns<AdminCreditLog>[] = [
        {
            title: t("admin.creditLogs.table.userId"),
            dataIndex: "userId",
            width: 220,
            render: (_, item) => <Typography.Text copyable>{item.userId}</Typography.Text>,
        },
        {
            title: t("admin.creditLogs.table.relatedId"),
            dataIndex: "relatedId",
            width: 220,
            render: (_, item) => (item.relatedId ? <Typography.Text copyable>{item.relatedId}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>),
        },
        {
            title: t("admin.creditLogs.table.type"),
            dataIndex: "type",
            width: 140,
            render: (_, item) => <Tag>{creditLogTypeKeys[item.type] ? t(creditLogTypeKeys[item.type]) : item.type || "-"}</Tag>,
        },
        {
            title: t("admin.creditLogs.table.change"),
            dataIndex: "amount",
            width: 100,
            render: (_, item) => <Typography.Text type={compareDecimal(item.amount, "0") >= 0 ? "success" : "danger"}>{formatDecimal(item.amount)}</Typography.Text>,
        },
        {
            title: t("admin.creditLogs.table.balance"),
            dataIndex: "balance",
            width: 100,
            render: (_, item) => formatDecimal(item.balance),
        },
        {
            title: t("admin.creditLogs.table.remark"),
            dataIndex: "remark",
            ellipsis: true,
            render: (_, item) => <Typography.Text type="secondary">{item.remark || "-"}</Typography.Text>,
        },
        {
            title: t("admin.common.table.createdAt"),
            dataIndex: "createdAt",
            width: 180,
            render: (_, item) => <Typography.Text type="secondary">{item.createdAt ? formatDateTime(item.createdAt) : "-"}</Typography.Text>,
        },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 96,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title={t("admin.common.actions.edit")}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingLog(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.delete")}>
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingLog(item)} />
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
                            <Col flex="360px">
                                <Form.Item label={t("admin.common.filters.keyword")}>
                                    <Input.Search
                                        value={keywordText}
                                        placeholder={t("admin.creditLogs.filters.searchPlaceholder")}
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchLogs(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
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
                <ProTable<AdminCreditLog>
                    rowKey="id"
                    columns={columns}
                    dataSource={logs}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.creditLogs.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.records", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshLogs() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingLog({ type: "admin_adjust", amount: "0", balance: "0" })}>
                            {t("admin.common.actions.add")}
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

            <Modal
                title={t(editingLog?.id ? "admin.creditLogs.modal.editTitle" : "admin.creditLogs.modal.createTitle")}
                open={Boolean(editingLog)}
                width={680}
                onCancel={() => setEditingLog(null)}
                onOk={() => void saveLog()}
                okText={t("admin.common.actions.save")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="userId" label={t("admin.creditLogs.form.userId")} rules={[{ required: true, message: t("admin.creditLogs.validation.userIdRequired") }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="type" label={t("admin.creditLogs.form.type")} rules={[{ required: true, message: t("admin.creditLogs.validation.typeRequired") }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="amount" label={t("admin.creditLogs.form.amount")} rules={[{ required: true, message: t("admin.creditLogs.validation.amountRequired") }]}>
                                <InputNumber step="0.01" stringMode style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="balance" label={t("admin.creditLogs.form.balance")} rules={[{ required: true, message: t("admin.creditLogs.validation.balanceRequired") }]}>
                                <InputNumber min={0} step="0.01" stringMode style={{ width: "100%" }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="relatedId" label={t("admin.creditLogs.form.relatedId")}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="createdAt" label={t("admin.common.table.createdAt")}>
                                <Input placeholder={t("admin.creditLogs.form.createdAtPlaceholder")} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="remark" label={t("admin.creditLogs.form.remark")}>
                                <Input.TextArea rows={3} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="extra" label={t("admin.creditLogs.form.extra")}>
                                <Input.TextArea rows={3} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={t("admin.creditLogs.delete.title")}
                open={Boolean(deletingLog)}
                onCancel={() => setDeletingLog(null)}
                onOk={async () => {
                    if (!deletingLog) return;
                    await deleteLog(deletingLog.id);
                    setDeletingLog(null);
                }}
                okText={t("admin.common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("admin.common.actions.cancel")}
            >
                {t("admin.creditLogs.delete.confirm")}
            </Modal>
        </main>
    );
}
