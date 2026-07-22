"use client";

import { KeyOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Input, Modal, Row, Space, Switch, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import type { AdminEnterprise, CreateAdminEnterprise } from "@/services/api/admin";
import { useAdminEnterprises } from "./use-admin-enterprises";

export default function AdminEnterprisesPage() {
    const { enterprises, total, keyword, page, pageSize, isLoading, search, reset, changePage, refresh, create, setStatus, setOwnerStatus, resetPassword } = useAdminEnterprises();
    const [keywordText, setKeywordText] = useState(keyword);
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState<AdminEnterprise | null>(null);
    const [createForm] = Form.useForm<CreateAdminEnterprise>();
    const [passwordForm] = Form.useForm<{ password: string }>();
    const columns: ProColumns<AdminEnterprise>[] = [
        {
            title: "企业",
            dataIndex: "name",
            width: 240,
            render: (_, item) => (
                <Flex vertical style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis>{item.name}</Typography.Text>
                    <Typography.Text type="secondary" ellipsis>{item.id}</Typography.Text>
                </Flex>
            ),
        },
        { title: "主账号", dataIndex: "ownerName", width: 220, ellipsis: true },
        { title: "成员", dataIndex: "memberCount", width: 80, render: (_, item) => `${item.memberCount} 人` },
        { title: "主账号余额", dataIndex: "ownerCredits", width: 120, render: (_, item) => item.ownerCredits.toLocaleString() },
        {
            title: "企业状态",
            dataIndex: "status",
            width: 110,
            render: (_, item) => <Switch size="small" checked={item.status === "active"} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void setStatus(item, checked)} />,
        },
        {
            title: "主账号状态",
            dataIndex: "ownerStatus",
            width: 120,
            render: (_, item) => <Switch size="small" checked={item.ownerStatus === "active"} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void setOwnerStatus(item, checked)} />,
        },
        { title: "创建时间", dataIndex: "createdAt", width: 170, render: (_, item) => <Typography.Text type="secondary">{dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")}</Typography.Text> },
        {
            title: "操作",
            key: "actions",
            width: 72,
            align: "right",
            render: (_, item) => (
                <Tooltip title="重置主账号密码">
                    <Button type="text" size="small" icon={<KeyOutlined />} onClick={() => setResetting(item)} />
                </Tooltip>
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
                                        <Button onClick={() => { setKeywordText(""); reset(); }}>重置</Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => search(keywordText)}>查询</Button>
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
                    cardProps={{ variant: "borderless" }}
                    headerTitle={<Space><Typography.Text strong>企业列表</Typography.Text><Tag>{total} 家</Tag></Space>}
                    options={{ density: true, setting: true, reload: () => void refresh() }}
                    toolBarRender={() => [<Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>创建企业</Button>]}
                    pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (value) => `共 ${value} 家`, onChange: changePage }}
                />
            </Flex>

            <Modal title="创建企业" open={creating} width={620} onCancel={() => setCreating(false)} onOk={async () => { const value = await createForm.validateFields(); await create(value); setCreating(false); createForm.resetFields(); }} okText="创建" cancelText="取消" destroyOnHidden>
                <Form form={createForm} layout="vertical" requiredMark={false}>
                    <Row gutter={14}>
                        <Col span={12}><Form.Item name="name" label="企业名称" rules={[{ required: true, message: "请输入企业名称" }]}><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="ownerDisplayName" label="主账号昵称"><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="ownerUsername" label="主账号用户名" rules={[{ required: true, message: "请输入用户名" }]}><Input autoComplete="off" /></Form.Item></Col>
                        <Col span={12}><Form.Item name="ownerPassword" label="初始密码" rules={[{ required: true, message: "请输入初始密码" }]}><Input.Password autoComplete="new-password" /></Form.Item></Col>
                    </Row>
                </Form>
            </Modal>

            <Modal title="重置主账号密码" open={Boolean(resetting)} onCancel={() => setResetting(null)} onOk={async () => { if (!resetting) return; const { password } = await passwordForm.validateFields(); await resetPassword(resetting, password); setResetting(null); passwordForm.resetFields(); }} okText="重置" cancelText="取消" destroyOnHidden>
                <Typography.Paragraph type="secondary">重置「{resetting?.ownerName}」的密码后，该账号现有会话会立即失效。</Typography.Paragraph>
                <Form form={passwordForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
