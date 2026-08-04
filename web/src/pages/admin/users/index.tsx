"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Avatar, Button, Card, Col, Divider, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime, formatNumber } from "@/i18n/formatters";
import { formatDecimal } from "@/lib/decimal";
import type { AdminUser } from "@/services/api/admin";
import { useAdminUsers } from "./use-admin-users";

type UserFormValues = Partial<AdminUser> & { password?: string };

export default function AdminUsersPage() {
    const { t } = useTranslation();
    const { users, keyword, page, pageSize, total, isLoading, searchUsers, changePage, changePageSize, resetFilters, refreshUsers, saveUser: saveAdminUser, adjustCredits, deleteUser } = useAdminUsers();
    const [form] = Form.useForm<UserFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingUser, setEditingUser] = useState<Partial<AdminUser> | null>(null);
    const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
    const roleOptions = [
        { label: t("admin.users.roles.user"), value: "user" },
        { label: t("admin.users.roles.admin"), value: "admin" },
    ];
    const statusOptions = [
        { label: t("admin.users.statuses.active"), value: "active" },
        { label: t("admin.users.statuses.banned"), value: "ban" },
    ];

    useEffect(() => setKeywordText(keyword), [keyword]);

    useEffect(() => {
        if (editingUser) form.setFieldsValue({ role: "user", status: "active", ...editingUser, password: "" });
    }, [editingUser, form]);

    const saveUser = async () => {
        const value = await form.validateFields();
        const userValue = { ...value };
        delete userValue.credits;
        await saveAdminUser({ ...editingUser, ...userValue, password: value.password || undefined });
        setEditingUser(null);
    };

    const saveCredits = async () => {
        if (!editingUser?.id) return;
        await adjustCredits(editingUser.id, form.getFieldValue("credits") || "0");
    };

    const columns: ProColumns<AdminUser>[] = [
        {
            title: t("admin.users.table.user"),
            dataIndex: "username",
            width: 260,
            render: (_, item) => (
                <Flex align="center" gap={10} style={{ minWidth: 0 }}>
                    <Avatar src={item.avatarUrl || undefined}>{(item.displayName || item.username || "U").slice(0, 1).toUpperCase()}</Avatar>
                    <Flex vertical style={{ minWidth: 0 }}>
                        <Typography.Text strong ellipsis>
                            {item.displayName || item.username}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis>
                            {item.username}
                        </Typography.Text>
                    </Flex>
                </Flex>
            ),
        },
        { title: t("admin.users.table.userId"), dataIndex: "id", width: 180, ellipsis: true, copyable: true },
        {
            title: t("admin.users.table.role"),
            dataIndex: "role",
            width: 100,
            render: (_, item) => <Tag color={item.role === "admin" ? "gold" : "default"}>{t(item.role === "admin" ? "admin.users.roles.admin" : "admin.users.roles.userShort")}</Tag>,
        },
        {
            title: t("admin.users.table.enterprise"),
            dataIndex: "enterpriseName",
            width: 180,
            render: (_, item) =>
                item.enterpriseId ? (
                    <Flex vertical gap={2}>
                        <Typography.Text ellipsis>{item.enterpriseName || item.enterpriseId}</Typography.Text>
                        <Tag style={{ width: "fit-content", marginInlineEnd: 0 }}>{t(item.enterpriseRole === "owner" ? "admin.users.enterpriseRoles.owner" : "admin.users.enterpriseRoles.member")}</Tag>
                    </Flex>
                ) : (
                    <Typography.Text type="secondary">{t("admin.users.enterpriseRoles.personal")}</Typography.Text>
                ),
        },
        {
            title: t("admin.users.table.status"),
            dataIndex: "status",
            width: 90,
            render: (_, item) => <Tag color={item.status === "ban" ? "red" : "green"}>{t(item.status === "ban" ? "admin.users.statuses.banned" : "admin.users.statuses.active")}</Tag>,
        },
        {
            title: t("admin.users.table.credits"),
            dataIndex: "credits",
            width: 100,
            render: (_, item) => <Typography.Text>{formatDecimal(item.credits)}</Typography.Text>,
        },
        {
            title: t("admin.users.table.linuxDo"),
            dataIndex: "linuxDoId",
            width: 140,
            render: (_, item) => <Typography.Text type="secondary">{item.linuxDoId || "-"}</Typography.Text>,
        },
        {
            title: t("admin.users.table.lastLogin"),
            dataIndex: "lastLoginAt",
            width: 180,
            render: (_, item) => <Typography.Text type="secondary">{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "-"}</Typography.Text>,
        },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 96,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title={t("admin.common.actions.edit")}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingUser(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.delete")}>
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingUser(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ maxWidth: "100%", minWidth: 0, overflowX: "hidden", padding: 24 }}>
            <Flex vertical gap={16} style={{ minWidth: 0, width: "100%" }}>
                <Card variant="borderless" style={{ minWidth: 0, width: "100%" }}>
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="360px">
                                <Form.Item label={t("admin.common.filters.keyword")}>
                                    <Input.Search
                                        value={keywordText}
                                        placeholder={t("admin.users.filters.searchPlaceholder")}
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchUsers(keywordText)}
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
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchUsers(keywordText)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminUser>
                    rowKey="id"
                    columns={columns}
                    dataSource={users}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    style={{ minWidth: 0, width: "100%" }}
                    tableLayout="fixed"
                    scroll={{ x: 1326 }}
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.users.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.people", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshUsers() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingUser({ role: "user", status: "active" })}>
                            {t("admin.common.actions.add")}
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => t("admin.common.pagination.people", { count: value, value: formatNumber(value) }),
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal
                title={t(editingUser?.id ? "admin.users.modal.editTitle" : "admin.users.modal.createTitle")}
                open={Boolean(editingUser)}
                width={680}
                onCancel={() => setEditingUser(null)}
                onOk={() => void saveUser()}
                okText={t("admin.common.actions.save")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Typography.Text strong>{t("admin.users.form.basicInfo")}</Typography.Text>
                    <Row gutter={14}>
                        <Col span={12}>
                            <Form.Item name="username" label={t("admin.users.form.username")} rules={[{ required: true, message: t("admin.users.validation.usernameRequired") }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="password" label={t(editingUser?.id ? "admin.users.form.newPassword" : "admin.users.form.password")} rules={editingUser?.id ? [] : [{ required: true, message: t("admin.users.validation.passwordRequired") }]}>
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="displayName" label={t("admin.users.form.displayName")}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="email" label={t("admin.users.form.email")}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="role" label={t("admin.users.form.role")} rules={[{ required: true, message: t("admin.users.validation.roleRequired") }]}>
                                <Select options={roleOptions} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="status" label={t("admin.users.form.status")} rules={[{ required: true, message: t("admin.users.validation.statusRequired") }]}>
                                <Select options={statusOptions} />
                            </Form.Item>
                        </Col>
                    </Row>
                    {editingUser?.id && !editingUser.enterpriseId ? (
                        <>
                            <Divider style={{ margin: "4px 0 16px" }} />
                            <Typography.Text strong>{t("admin.users.form.creditAdjustment")}</Typography.Text>
                            <Row gutter={14}>
                                <Col span={12}>
                                    <Form.Item label={t("admin.users.form.credits")}>
                                        <Space.Compact style={{ width: "100%" }}>
                                            <Form.Item name="credits" noStyle>
                                                <InputNumber min={0} step="0.01" stringMode style={{ width: "100%" }} />
                                            </Form.Item>
                                            <Button onClick={() => void saveCredits()}>{t("admin.common.actions.adjust")}</Button>
                                        </Space.Compact>
                                    </Form.Item>
                                </Col>
                            </Row>
                        </>
                    ) : editingUser?.id ? (
                        <>
                            <Divider style={{ margin: "4px 0 16px" }} />
                            <Typography.Text type="secondary">{t("admin.users.form.enterpriseCreditsHint")}</Typography.Text>
                        </>
                    ) : null}
                </Form>
            </Modal>

            <Modal
                title={t("admin.users.delete.title")}
                open={Boolean(deletingUser)}
                onCancel={() => setDeletingUser(null)}
                onOk={async () => {
                    if (!deletingUser) return;
                    await deleteUser(deletingUser.id);
                    setDeletingUser(null);
                }}
                okText={t("admin.common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("admin.common.actions.cancel")}
            >
                {t("admin.users.delete.confirm", { name: deletingUser?.displayName || deletingUser?.username })}
            </Modal>
        </main>
    );
}
