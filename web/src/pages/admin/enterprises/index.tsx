"use client";

import { KeyOutlined, PercentageOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, WalletOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import type { AdminCreditLog, AdminEnterprise, CreateAdminEnterprise } from "@/services/api/admin";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { useAdminEnterprises } from "./use-admin-enterprises";

export default function AdminEnterprisesPage() {
    const { t } = useTranslation();
    const { enterprises, total, keyword, page, pageSize, isLoading, search, reset, changePage, refresh, create, setStatus, setDiscountRate, setOwnerStatus, resetPassword, adjustCredits, loadCreditLogs } = useAdminEnterprises();
    const [keywordText, setKeywordText] = useState(keyword);
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState<AdminEnterprise | null>(null);
    const [adjusting, setAdjusting] = useState<AdminEnterprise | null>(null);
    const [discounting, setDiscounting] = useState<AdminEnterprise | null>(null);
    const [creditLogs, setCreditLogs] = useState<AdminCreditLog[]>([]);
    const [createForm] = Form.useForm<CreateAdminEnterprise>();
    const [passwordForm] = Form.useForm<{ password: string }>();
    const [creditForm] = Form.useForm<{ delta: string; reason: string }>();
    const [discountForm] = Form.useForm<{ discountRate: string }>();

    const openCreditAdjustment = async (item: AdminEnterprise) => {
        setAdjusting(item);
        creditForm.resetFields();
        setCreditLogs(await loadCreditLogs(item.ownerId));
    };

    const columns: ProColumns<AdminEnterprise>[] = [
        {
            title: t("admin.enterprises.table.enterprise"),
            dataIndex: "name",
            width: 210,
            render: (_, item) => (
                <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis>
                        {item.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis>
                        {item.id}
                    </Typography.Text>
                </Flex>
            ),
        },
        { title: t("admin.enterprises.table.owner"), dataIndex: "ownerName", width: 170, ellipsis: true },
        { title: t("admin.enterprises.table.members"), dataIndex: "memberCount", width: 70, render: (_, item) => t("admin.common.counts.people", { count: item.memberCount, value: formatNumber(item.memberCount) }) },
        { title: t("admin.enterprises.table.ownerBalance"), dataIndex: "ownerCredits", width: 105, render: (_, item) => formatDecimal(item.ownerCredits) },
        { title: t("admin.enterprises.table.discountRate"), dataIndex: "discountRate", width: 90, render: (_, item) => t("admin.enterprises.values.multiplier", { value: item.discountRate }) },
        {
            title: t("admin.enterprises.table.enterpriseStatus"),
            dataIndex: "status",
            width: 100,
            render: (_, item) => <Switch size="small" checked={item.status === "active"} checkedChildren={t("admin.common.statuses.enabled")} unCheckedChildren={t("admin.common.statuses.disabled")} onChange={(checked) => void setStatus(item, checked)} />,
        },
        {
            title: t("admin.enterprises.table.ownerStatus"),
            dataIndex: "ownerStatus",
            width: 110,
            render: (_, item) => (
                <Switch size="small" checked={item.ownerStatus === "active"} checkedChildren={t("admin.common.statuses.enabled")} unCheckedChildren={t("admin.common.statuses.disabled")} onChange={(checked) => void setOwnerStatus(item, checked)} />
            ),
        },
        { title: t("admin.common.table.createdAt"), dataIndex: "createdAt", width: 155, render: (_, item) => <Typography.Text type="secondary">{formatDateTime(item.createdAt)}</Typography.Text> },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 108,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title={t("admin.enterprises.actions.setDiscount")}>
                        <Button
                            type="text"
                            size="small"
                            icon={<PercentageOutlined />}
                            onClick={() => {
                                setDiscounting(item);
                                discountForm.setFieldsValue({ discountRate: item.discountRate });
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={t("admin.enterprises.actions.adjustCredits")}>
                        <Button type="text" size="small" icon={<WalletOutlined />} onClick={() => void openCreditAdjustment(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.enterprises.actions.resetPassword")}>
                        <Button type="text" size="small" icon={<KeyOutlined />} onClick={() => setResetting(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="360px">
                                <Form.Item label={t("admin.common.filters.keyword")}>
                                    <Input.Search
                                        value={keywordText}
                                        placeholder={t("admin.enterprises.filters.searchPlaceholder")}
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => search(keywordText)}
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
                                                reset();
                                            }}
                                        >
                                            {t("admin.common.actions.reset")}
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => search(keywordText)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminEnterprise>
                    rowKey="id"
                    columns={columns}
                    dataSource={enterprises}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    scroll={{ x: 1118 }}
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.enterprises.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.companies", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refresh() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                            {t("admin.enterprises.actions.create")}
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => t("admin.common.pagination.companies", { count: value, value: formatNumber(value) }),
                        onChange: changePage,
                    }}
                />
            </Flex>

            <Modal
                title={t("admin.enterprises.create.title")}
                open={creating}
                width={620}
                onCancel={() => setCreating(false)}
                onOk={async () => {
                    const value = await createForm.validateFields();
                    await create(value);
                    setCreating(false);
                    createForm.resetFields();
                }}
                okText={t("admin.common.actions.create")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={createForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="name" label={t("admin.enterprises.form.name")} rules={[{ required: true, message: t("admin.enterprises.validation.nameRequired") }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerDisplayName" label={t("admin.enterprises.form.ownerDisplayName")}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerUsername" label={t("admin.enterprises.form.ownerUsername")} rules={[{ required: true, message: t("admin.enterprises.validation.ownerUsernameRequired") }]}>
                                <Input autoComplete="off" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerPassword" label={t("admin.enterprises.form.initialPassword")} rules={[{ required: true, message: t("admin.enterprises.validation.initialPasswordRequired") }]}>
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={t("admin.enterprises.discount.title", { name: discounting?.name || "" })}
                open={Boolean(discounting)}
                confirmLoading={isLoading}
                onCancel={() => setDiscounting(null)}
                onOk={async () => {
                    if (!discounting) return;
                    const { discountRate } = await discountForm.validateFields();
                    await setDiscountRate(discounting, discountRate);
                    setDiscounting(null);
                    discountForm.resetFields();
                }}
                okText={t("admin.common.actions.save")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={discountForm} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="discountRate"
                        label={t("admin.enterprises.form.discountRate")}
                        rules={[
                            { required: true, message: t("admin.enterprises.validation.discountRequired") },
                            { validator: (_, value) => (compareDecimal(value, "0.1") >= 0 && compareDecimal(value, "1") <= 0 ? Promise.resolve() : Promise.reject(new Error(t("admin.enterprises.validation.discountRange")))) },
                        ]}
                    >
                        <InputNumber min={0.1} max={1} step="0.01" stringMode suffix={t("admin.enterprises.units.multiplier")} style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={t("admin.enterprises.credits.title", { name: adjusting?.ownerName || "" })}
                open={Boolean(adjusting)}
                width={760}
                confirmLoading={isLoading}
                onCancel={() => setAdjusting(null)}
                onOk={async () => {
                    if (!adjusting) return;
                    const { delta, reason } = await creditForm.validateFields();
                    const updated = await adjustCredits(adjusting, delta, reason);
                    setAdjusting(updated);
                    setCreditLogs(await loadCreditLogs(updated.ownerId));
                    creditForm.resetFields();
                }}
                okText={t("admin.enterprises.actions.confirmAdjustment")}
                cancelText={t("admin.common.actions.close")}
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">
                    {t("admin.enterprises.credits.balancePrefix")}
                    <Typography.Text strong>{formatDecimal(adjusting?.ownerCredits)}</Typography.Text>
                    {t("admin.enterprises.credits.balanceHint")}
                </Typography.Paragraph>
                <Form form={creditForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={8}>
                            <Form.Item
                                name="delta"
                                label={t("admin.enterprises.form.adjustmentAmount")}
                                rules={[
                                    { required: true, message: t("admin.enterprises.validation.adjustmentRequired") },
                                    { validator: (_, value) => (compareDecimal(value, "0") === 0 ? Promise.reject(new Error(t("admin.enterprises.validation.adjustmentNonZero"))) : Promise.resolve()) },
                                ]}
                            >
                                <InputNumber step="0.01" stringMode style={{ width: "100%" }} placeholder={t("admin.enterprises.form.adjustmentPlaceholder")} />
                            </Form.Item>
                        </Col>
                        <Col span={16}>
                            <Form.Item name="reason" label={t("admin.enterprises.form.adjustmentReason")} rules={[{ required: true, whitespace: true, message: t("admin.enterprises.validation.reasonRequired") }]}>
                                <Input maxLength={200} placeholder={t("admin.enterprises.form.reasonPlaceholder")} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
                <Typography.Text strong>{t("admin.enterprises.credits.recentAdjustments")}</Typography.Text>
                <Table<AdminCreditLog>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={creditLogs}
                    style={{ marginTop: 12 }}
                    columns={[
                        { title: t("admin.common.table.time"), dataIndex: "createdAt", width: 160, render: (value: string) => formatDateTime(value) },
                        {
                            title: t("admin.creditLogs.table.change"),
                            dataIndex: "amount",
                            width: 90,
                            render: (value: string) => <Typography.Text type={compareDecimal(value, "0") >= 0 ? "success" : "danger"}>{compareDecimal(value, "0") > 0 ? `+${formatDecimal(value)}` : formatDecimal(value)}</Typography.Text>,
                        },
                        { title: t("admin.creditLogs.table.balance"), dataIndex: "balance", width: 90, render: (value: string) => formatDecimal(value) },
                        { title: t("admin.enterprises.credits.reason"), dataIndex: "remark", ellipsis: true },
                        { title: t("admin.enterprises.credits.operator"), dataIndex: "relatedId", width: 160, ellipsis: true },
                    ]}
                />
            </Modal>

            <Modal
                title={t("admin.enterprises.password.title")}
                open={Boolean(resetting)}
                onCancel={() => setResetting(null)}
                onOk={async () => {
                    if (!resetting) return;
                    const { password } = await passwordForm.validateFields();
                    await resetPassword(resetting, password);
                    setResetting(null);
                    passwordForm.resetFields();
                }}
                okText={t("admin.common.actions.reset")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">{t("admin.enterprises.password.confirm", { name: resetting?.ownerName })}</Typography.Paragraph>
                <Form form={passwordForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="password" label={t("admin.enterprises.form.newPassword")} rules={[{ required: true, message: t("admin.enterprises.validation.newPasswordRequired") }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
