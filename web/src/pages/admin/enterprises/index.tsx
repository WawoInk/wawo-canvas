"use client";

import { KeyOutlined, PercentageOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, WalletOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import type { AdminCreditLog, AdminEnterprise, CreateAdminEnterprise } from "@/services/api/admin";
import { useAdminEnterprises } from "./use-admin-enterprises";

export default function AdminEnterprisesPage() {
    const { enterprises, total, keyword, page, pageSize, isLoading, search, reset, changePage, refresh, create, setStatus, setDiscountRate, setOwnerStatus, resetPassword, adjustCredits, loadCreditLogs } = useAdminEnterprises();
    const [keywordText, setKeywordText] = useState(keyword);
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState<AdminEnterprise | null>(null);
    const [adjusting, setAdjusting] = useState<AdminEnterprise | null>(null);
    const [discounting, setDiscounting] = useState<AdminEnterprise | null>(null);
    const [creditLogs, setCreditLogs] = useState<AdminCreditLog[]>([]);
    const [createForm] = Form.useForm<CreateAdminEnterprise>();
    const [passwordForm] = Form.useForm<{ password: string }>();
    const [creditForm] = Form.useForm<{ delta: number; reason: string }>();
    const [discountForm] = Form.useForm<{ discountRate: number }>();

    const openCreditAdjustment = async (item: AdminEnterprise) => {
        setAdjusting(item);
        creditForm.resetFields();
        setCreditLogs(await loadCreditLogs(item.ownerId));
    };

    const columns: ProColumns<AdminEnterprise>[] = [
        {
            title: "企业",
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
        { title: "主账号", dataIndex: "ownerName", width: 170, ellipsis: true },
        { title: "成员", dataIndex: "memberCount", width: 70, render: (_, item) => `${item.memberCount} 人` },
        { title: "主账号余额", dataIndex: "ownerCredits", width: 105, render: (_, item) => item.ownerCredits.toLocaleString() },
        { title: "折扣倍率", dataIndex: "discountRate", width: 90, render: (_, item) => `${item.discountRate} 倍` },
        {
            title: "企业状态",
            dataIndex: "status",
            width: 100,
            render: (_, item) => <Switch size="small" checked={item.status === "active"} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void setStatus(item, checked)} />,
        },
        {
            title: "主账号状态",
            dataIndex: "ownerStatus",
            width: 110,
            render: (_, item) => <Switch size="small" checked={item.ownerStatus === "active"} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void setOwnerStatus(item, checked)} />,
        },
        { title: "创建时间", dataIndex: "createdAt", width: 155, render: (_, item) => <Typography.Text type="secondary">{dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")}</Typography.Text> },
        {
            title: "操作",
            key: "actions",
            width: 108,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="设置折扣倍率">
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
                    <Tooltip title="调整主账号积分">
                        <Button type="text" size="small" icon={<WalletOutlined />} onClick={() => void openCreditAdjustment(item)} />
                    </Tooltip>
                    <Tooltip title="重置主账号密码">
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
                                <Form.Item label="关键词">
                                    <Input.Search value={keywordText} placeholder="搜索企业名称或主账号" allowClear enterButton={<SearchOutlined />} onSearch={() => search(keywordText)} onChange={(event) => setKeywordText(event.target.value)} />
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
                                            重置
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => search(keywordText)}>
                                            查询
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
                            <Typography.Text strong>企业列表</Typography.Text>
                            <Tag>{total} 家</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refresh() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                            创建企业
                        </Button>,
                    ]}
                    pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (value) => `共 ${value} 家`, onChange: changePage }}
                />
            </Flex>

            <Modal
                title="创建企业"
                open={creating}
                width={620}
                onCancel={() => setCreating(false)}
                onOk={async () => {
                    const value = await createForm.validateFields();
                    await create(value);
                    setCreating(false);
                    createForm.resetFields();
                }}
                okText="创建"
                cancelText="取消"
                destroyOnHidden
            >
                <Form form={createForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="name" label="企业名称" rules={[{ required: true, message: "请输入企业名称" }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerDisplayName" label="主账号昵称">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerUsername" label="主账号用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                                <Input autoComplete="off" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="ownerPassword" label="初始密码" rules={[{ required: true, message: "请输入初始密码" }]}>
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={`设置折扣倍率 · ${discounting?.name || ""}`}
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
                okText="保存"
                cancelText="取消"
                destroyOnHidden
            >
                <Form form={discountForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="discountRate" label="折扣倍率" rules={[{ required: true, message: "请输入折扣倍率" }, { type: "number", min: 0.1, max: 1, message: "折扣倍率必须在 0.1 到 1 之间" }]}>
                        <InputNumber min={0.1} max={1} step={0.1} suffix="倍" style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`调整主账号积分 · ${adjusting?.ownerName || ""}`}
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
                okText="确认调整"
                cancelText="关闭"
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">
                    当前余额：<Typography.Text strong>{adjusting?.ownerCredits.toLocaleString()}</Typography.Text>。正数增加，负数扣减，扣减后余额不能小于 0。
                </Typography.Paragraph>
                <Form form={creditForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={8}>
                            <Form.Item name="delta" label="调整数量" rules={[{ required: true, message: "请输入调整数量" }, { validator: (_, value) => (value === 0 ? Promise.reject(new Error("调整数量不能为 0")) : Promise.resolve()) }]}>
                                <InputNumber precision={0} style={{ width: "100%" }} placeholder="例如 100 或 -50" />
                            </Form.Item>
                        </Col>
                        <Col span={16}>
                            <Form.Item name="reason" label="调整原因" rules={[{ required: true, whitespace: true, message: "请输入调整原因" }]}>
                                <Input maxLength={200} placeholder="例如：线下充值到账" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
                <Typography.Text strong>最近平台调整</Typography.Text>
                <Table<AdminCreditLog>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={creditLogs}
                    style={{ marginTop: 12 }}
                    columns={[
                        { title: "时间", dataIndex: "createdAt", width: 160, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
                        { title: "变动", dataIndex: "amount", width: 90, render: (value: number) => <Typography.Text type={value >= 0 ? "success" : "danger"}>{value > 0 ? `+${value}` : value}</Typography.Text> },
                        { title: "余额", dataIndex: "balance", width: 90 },
                        { title: "原因", dataIndex: "remark", ellipsis: true },
                        { title: "操作者", dataIndex: "relatedId", width: 160, ellipsis: true },
                    ]}
                />
            </Modal>

            <Modal
                title="重置主账号密码"
                open={Boolean(resetting)}
                onCancel={() => setResetting(null)}
                onOk={async () => {
                    if (!resetting) return;
                    const { password } = await passwordForm.validateFields();
                    await resetPassword(resetting, password);
                    setResetting(null);
                    passwordForm.resetFields();
                }}
                okText="重置"
                cancelText="取消"
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">重置「{resetting?.ownerName}」的密码后，该账号现有会话会立即失效。</Typography.Paragraph>
                <Form form={passwordForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
