"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Table, Tabs, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { Download } from "lucide-react";
import { nanoid } from "nanoid";

import { enterpriseCapabilities } from "@/lib/account-access";
import {
    changeAccountPassword,
    createEnterpriseMember,
    fetchEnterpriseAccountSummary,
    fetchEnterpriseCreditLogs,
    fetchEnterpriseMembers,
    resetEnterpriseMemberPassword,
    setEnterpriseMemberStatus,
    transferEnterpriseMemberCredits,
    updateAccountEnterprise,
    updateAccountProfile,
    type EnterpriseAccountSummary,
    type EnterpriseCreditAction,
    type EnterpriseCreditLog,
    type EnterpriseMember,
} from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { compareDecimal, formatDecimal } from "@/lib/decimal";
import { downloadCsv, fetchAllPages, type CsvColumn } from "./account-log-export";
import { AccountLogs } from "./account-logs";

const platformRoleLabels = { guest: "访客", user: "普通用户", admin: "平台管理员" } as const;
const enterpriseRoleLabels = { owner: "企业主账号", member: "企业成员" } as const;
const enterpriseStatusLabels = { active: "正常", disabled: "已禁用" } as const;
const creditLogTypeLabels = {
    admin_adjust: "平台调整",
    ai_consume: "模型消费",
    ai_refund: "失败返还",
    enterprise_allocate: "企业分配",
    enterprise_reclaim: "企业收回",
} as const;
const enterpriseCreditCsvColumns: CsvColumn<EnterpriseCreditLog>[] = [
    { title: "流水 ID", value: (item) => item.id },
    { title: "成员", value: (item) => item.displayName || item.username },
    { title: "用户名", value: (item) => item.username },
    { title: "类型", value: (item) => creditLogTypeLabels[item.type] },
    { title: "变动", value: (item) => formatDecimal(item.amount) },
    { title: "余额", value: (item) => formatDecimal(item.balance) },
    { title: "关联 ID", value: (item) => item.relatedId || item.taskId },
    { title: "对方 ID", value: (item) => item.counterpartyId },
    { title: "备注", value: (item) => item.remark },
    { title: "时间", value: (item) => (item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "") },
];

export default function AccountPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const capabilities = enterpriseCapabilities(user);
    const [profileForm] = Form.useForm();
    const [passwordForm] = Form.useForm();
    const [enterpriseForm] = Form.useForm();
    const [summary, setSummary] = useState<EnterpriseAccountSummary | null>(null);
    const [summaryError, setSummaryError] = useState("");
    const [activeSection, setActiveSection] = useState("account");
    const [profileSaving, setProfileSaving] = useState(false);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [enterpriseSaving, setEnterpriseSaving] = useState(false);

    useEffect(() => {
        if (!capabilities.showSummary || !token) return;
        let current = true;
        setSummary(null);
        setSummaryError("");
        void fetchEnterpriseAccountSummary(token)
            .then((value) => {
                if (!current) return;
                setSummary(value);
                enterpriseForm.setFieldsValue({ name: value.name });
            })
            .catch((error) => current && setSummaryError(error instanceof Error ? error.message : "企业信息加载失败"));
        return () => {
            current = false;
        };
    }, [capabilities.showSummary, enterpriseForm, token, user?.id]);

    if (!user) return <main className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">正在加载账户...</main>;

    const saveProfile = async (values: { displayName: string; email: string }) => {
        setProfileSaving(true);
        try {
            const updated = await updateAccountProfile(token, values);
            setSession(token, updated);
            profileForm.setFieldsValue({ displayName: updated.displayName, email: updated.email });
            message.success("个人资料已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "个人资料更新失败");
        } finally {
            setProfileSaving(false);
        }
    };

    const changePassword = async (values: { currentPassword: string; newPassword: string }) => {
        setPasswordSaving(true);
        try {
            await changeAccountPassword(token, values);
            clearSession();
            message.success("密码已修改，请重新登录");
            navigate("/login", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码修改失败");
        } finally {
            setPasswordSaving(false);
        }
    };

    const renameEnterprise = async ({ name }: { name: string }) => {
        setEnterpriseSaving(true);
        try {
            const updated = await updateAccountEnterprise(token, name);
            setSummary(updated);
            setSession(token, { ...user, enterpriseName: updated.name });
            enterpriseForm.setFieldsValue({ name: updated.name });
            message.success("企业名称已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "企业名称更新失败");
        } finally {
            setEnterpriseSaving(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
                <header className="border-b pb-6">
                    <p className="text-xs text-muted-foreground">账户中心</p>
                    <h1 className="mt-3 text-3xl font-semibold">账户设置</h1>
                </header>

                <Tabs activeKey={activeSection} items={[{ key: "account", label: "账户信息" }, { key: "logs", label: "日志记录" }, ...(capabilities.showSummary ? [{ key: "enterprise", label: "企业信息" }] : [])]} onChange={setActiveSection} />

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">账户概况</h2>
                    <Descriptions
                        className="mt-5"
                        column={{ xs: 1, sm: 2 }}
                        items={[
                            { key: "username", label: "用户名", children: user.username },
                            { key: "credits", label: "当前积分", children: formatDecimal(user.credits) },
                            { key: "role", label: "平台身份", children: platformRoleLabels[user.role] },
                            { key: "createdAt", label: "注册时间", children: user.createdAt ? new Date(user.createdAt).toLocaleString("zh-CN") : "-" },
                        ]}
                    />
                </section>

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">个人资料</h2>
                    <Form form={profileForm} layout="vertical" requiredMark={false} initialValues={{ displayName: user.displayName, email: user.email }} onFinish={saveProfile} className="mt-5 max-w-xl">
                        <Form.Item label="昵称" name="displayName">
                            <Input placeholder="请输入昵称" />
                        </Form.Item>
                        <Form.Item label="邮箱" name="email" rules={[{ type: "email", message: "请输入有效邮箱" }]}>
                            <Input placeholder="请输入邮箱" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={profileSaving}>
                            保存资料
                        </Button>
                    </Form>
                </section>

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">修改密码</h2>
                    <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={changePassword} className="mt-5 max-w-xl">
                        <Form.Item label="当前密码" name="currentPassword" extra="通过第三方账号登录且尚未设置本地密码时可留空">
                            <Input.Password autoComplete="current-password" />
                        </Form.Item>
                        <Form.Item label="新密码" name="newPassword" rules={[{ required: true, message: "请输入新密码" }]}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item
                            label="确认新密码"
                            name="confirmPassword"
                            dependencies={["newPassword"]}
                            rules={[
                                { required: true, message: "请再次输入新密码" },
                                ({ getFieldValue }) => ({ validator: (_, value) => (!value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致"))) }),
                            ]}
                        >
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={passwordSaving}>
                            修改密码
                        </Button>
                    </Form>
                </section>

                {capabilities.showSummary ? (
                    <section hidden={activeSection !== "enterprise"} className="rounded-2xl border border-border bg-card p-6">
                        <h2 className="text-lg font-semibold">企业概况</h2>
                        {!summary && !summaryError ? <Skeleton active paragraph={{ rows: 2 }} className="mt-5" /> : null}
                        {summaryError ? <p className="mt-5 text-sm text-red-500">{summaryError}</p> : null}
                        {summary ? (
                            <>
                                <Descriptions
                                    className="mt-5"
                                    column={{ xs: 1, sm: 2 }}
                                    items={[
                                        { key: "name", label: "企业名称", children: summary.name },
                                        { key: "role", label: "企业身份", children: enterpriseRoleLabels[summary.role] },
                                        { key: "status", label: "企业状态", children: enterpriseStatusLabels[summary.status] },
                                        { key: "members", label: "成员数量", children: `${summary.memberCount} 人` },
                                        ...(summary.role === "owner" ? [{ key: "discountRate", label: "折扣倍率", children: `${summary.discountRate} 倍` }] : []),
                                    ]}
                                />
                                {capabilities.canRename ? (
                                    <Form form={enterpriseForm} layout="inline" requiredMark={false} onFinish={renameEnterprise} className="mt-6">
                                        <Form.Item name="name" rules={[{ required: true, message: "请输入企业名称" }]} className="min-w-64 flex-1">
                                            <Input placeholder="企业名称" />
                                        </Form.Item>
                                        <Button type="primary" htmlType="submit" loading={enterpriseSaving}>
                                            更新企业名称
                                        </Button>
                                    </Form>
                                ) : null}
                            </>
                        ) : null}
                    </section>
                ) : null}

                {activeSection === "enterprise" && capabilities.canManageMembers ? (
                    <>
                        <EnterpriseMembers onCreated={() => setSummary((current) => (current ? { ...current, memberCount: current.memberCount + 1 } : current))} />
                        <EnterpriseCreditLogs key={user.id} />
                    </>
                ) : null}
                {activeSection === "logs" ? <AccountLogs key={user.id} /> : null}
            </div>
        </main>
    );
}

export function EnterpriseCreditLogs() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [members, setMembers] = useState<EnterpriseMember[]>([]);
    const [logs, setLogs] = useState<EnterpriseCreditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [memberId, setMemberId] = useState("");
    const [type, setType] = useState("");
    const [keyword, setKeyword] = useState("");
    const [keywordText, setKeywordText] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
    const startTime = range?.[0].startOf("day").toISOString();
    const endTime = range?.[1].endOf("day").toISOString();

    useEffect(() => {
        let current = true;
        setMembers([]);
        // ponytail: 500 follows the API cap; use remote member search when an enterprise exceeds it.
        void fetchEnterpriseMembers(token, { page: 1, pageSize: 500 })
            .then((result) => current && setMembers(result.items))
            .catch((reason) => current && message.error(reason instanceof Error ? reason.message : "成员筛选加载失败"));
        return () => {
            current = false;
        };
    }, [message, token, user?.id]);

    useEffect(() => {
        let current = true;
        setLoading(true);
        setError("");
        setLogs([]);
        setTotal(0);
        void fetchEnterpriseCreditLogs(token, { memberId, type, keyword, start_time: startTime, end_time: endTime, page, pageSize })
            .then((result) => {
                if (!current) return;
                setLogs(result.items);
                setTotal(result.total);
            })
            .catch((reason) => {
                if (!current) return;
                const detail = reason instanceof Error ? reason.message : "企业积分流水加载失败";
                setLogs([]);
                setTotal(0);
                setError(detail);
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, keyword, memberId, page, pageSize, startTime, token, type, user?.credits, user?.id]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchEnterpriseCreditLogs(token, { memberId, type, keyword, start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning("暂无企业积分流水可导出");
                return;
            }
            downloadCsv("企业积分流水.csv", enterpriseCreditCsvColumns, rows);
            message.success("企业积分流水已导出");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : "企业积分流水导出失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div>
                <h2 className="text-lg font-semibold">企业积分流水</h2>
                <p className="mt-1 text-sm text-muted-foreground">查看本企业的积分分配、消费和退款记录</p>
            </div>
            <Space wrap className="mt-5">
                <Select
                    allowClear
                    aria-label="按成员筛选企业积分流水"
                    className="w-48"
                    placeholder="全部成员"
                    value={memberId || undefined}
                    options={[
                        ...(user ? [{ value: user.id, label: `${user.displayName || user.username}（主账号）` }] : []),
                        ...members.map((member) => ({ value: member.id, label: member.displayName ? `${member.displayName}（${member.username}）` : member.username })),
                    ]}
                    onChange={(value) => {
                        setMemberId(value || "");
                        setPage(1);
                    }}
                />
                <Select
                    allowClear
                    aria-label="按类型筛选企业积分流水"
                    className="w-36"
                    placeholder="全部类型"
                    value={type || undefined}
                    options={Object.entries(creditLogTypeLabels).map(([value, label]) => ({ value, label }))}
                    onChange={(value) => {
                        setType(value || "");
                        setPage(1);
                    }}
                />
                <DatePicker.RangePicker
                    value={range}
                    format="YYYY-MM-DD"
                    placeholder={["开始日期", "结束日期"]}
                    onChange={(value) => {
                        setRange(value as [Dayjs, Dayjs] | null);
                        setPage(1);
                    }}
                />
                <Input.Search
                    allowClear
                    aria-label="搜索企业积分流水"
                    className="w-72"
                    placeholder="搜索成员、类型、备注或关联 ID"
                    value={keywordText}
                    onChange={(event) => {
                        const value = event.target.value;
                        setKeywordText(value);
                        if (!value) {
                            setKeyword("");
                            setPage(1);
                        }
                    }}
                    onSearch={() => {
                        setKeyword(keywordText.trim());
                        setPage(1);
                    }}
                />
                <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>
                    导出企业积分流水
                </Button>
            </Space>
            {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
            <Table<EnterpriseCreditLog>
                rowKey="id"
                className="mt-4"
                loading={loading}
                dataSource={logs}
                scroll={{ x: 1100 }}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    onChange: (nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    },
                }}
                columns={[
                    {
                        title: "成员",
                        width: 180,
                        render: (_, item) => (
                            <div>
                                <div>{item.displayName || item.username}</div>
                                <div className="text-xs text-muted-foreground">{item.username}</div>
                            </div>
                        ),
                    },
                    { title: "类型", dataIndex: "type", width: 120, render: (value: EnterpriseCreditLog["type"]) => <Tag>{creditLogTypeLabels[value]}</Tag> },
                    {
                        title: "变动",
                        dataIndex: "amount",
                        width: 100,
                        render: (value: string) => <span className={compareDecimal(value, "0") >= 0 ? "text-green-600" : "text-red-500"}>{compareDecimal(value, "0") > 0 ? `+${formatDecimal(value)}` : formatDecimal(value)}</span>,
                    },
                    { title: "余额", dataIndex: "balance", width: 100, render: (value: string) => formatDecimal(value) },
                    {
                        title: "关联信息",
                        width: 260,
                        render: (_, item) => (
                            <div className="text-xs text-muted-foreground">
                                <div>{item.relatedId || item.taskId || "-"}</div>
                                {item.counterpartyId ? <div>对方：{item.counterpartyId}</div> : null}
                            </div>
                        ),
                    },
                    { title: "备注", dataIndex: "remark", ellipsis: true, render: (value: string) => value || "-" },
                    { title: "时间", dataIndex: "createdAt", width: 180, render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN") : "-") },
                ]}
            />
        </section>
    );
}

function EnterpriseMembers({ onCreated }: { onCreated: () => void }) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [createForm] = Form.useForm();
    const [passwordForm] = Form.useForm();
    const [creditsForm] = Form.useForm<{ amount: string }>();
    const [members, setMembers] = useState<EnterpriseMember[]>([]);
    const [total, setTotal] = useState(0);
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [refreshKey, setRefreshKey] = useState(0);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [resetMember, setResetMember] = useState<EnterpriseMember | null>(null);
    const [creditsTarget, setCreditsTarget] = useState<{ member: EnterpriseMember; action: EnterpriseCreditAction; requestId: string } | null>(null);

    useEffect(() => {
        let current = true;
        setLoading(true);
        void fetchEnterpriseMembers(token, { keyword, page, pageSize })
            .then((result) => {
                if (!current) return;
                setMembers(result.items);
                setTotal(result.total);
            })
            .catch((error) => current && message.error(error instanceof Error ? error.message : "成员加载失败"))
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [keyword, message, page, pageSize, refreshKey, token]);

    const create = async (values: { username: string; password: string; displayName?: string; email?: string }) => {
        setSaving(true);
        try {
            await createEnterpriseMember(token, values);
            createForm.resetFields();
            setCreateOpen(false);
            setPage(1);
            setRefreshKey((value) => value + 1);
            onCreated();
            message.success("成员已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "成员创建失败");
        } finally {
            setSaving(false);
        }
    };

    const setStatus = async (member: EnterpriseMember) => {
        setSaving(true);
        try {
            await setEnterpriseMemberStatus(token, member.id, member.status === "active" ? "ban" : "active");
            setRefreshKey((value) => value + 1);
            message.success(member.status === "active" ? "成员已禁用" : "成员已启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "成员状态更新失败");
        } finally {
            setSaving(false);
        }
    };

    const resetPassword = async ({ password }: { password: string }) => {
        if (!resetMember) return;
        setSaving(true);
        try {
            await resetEnterpriseMemberPassword(token, resetMember.id, password);
            passwordForm.resetFields();
            setResetMember(null);
            message.success("成员密码已重置");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码重置失败");
        } finally {
            setSaving(false);
        }
    };

    const transferCredits = async ({ amount }: { amount: string }) => {
        if (!creditsTarget) return;
        setSaving(true);
        try {
            const result = await transferEnterpriseMemberCredits(token, creditsTarget.member.id, { action: creditsTarget.action, amount, requestId: creditsTarget.requestId });
            setMembers((current) => current.map((item) => (item.id === result.member.id ? result.member : item)));
            const session = useUserStore.getState();
            if (session.token === token && session.user) session.setSession(token, { ...session.user, credits: result.ownerCredits });
            setCreditsTarget(null);
            creditsForm.resetFields();
            message.success(result.action === "allocate" ? "积分分配成功" : "积分收回成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : creditsTarget.action === "allocate" ? "积分分配失败" : "积分收回失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">企业成员</h2>
                    <p className="mt-1 text-sm text-muted-foreground">创建和管理本企业子账号</p>
                </div>
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                    创建成员
                </Button>
            </div>
            <Input.Search
                allowClear
                placeholder="搜索用户名、昵称或邮箱"
                className="mt-5 max-w-md"
                onSearch={(value) => {
                    setKeyword(value.trim());
                    setPage(1);
                }}
            />
            <Table<EnterpriseMember>
                rowKey="id"
                className="mt-4"
                loading={loading}
                dataSource={members}
                scroll={{ x: 900 }}
                pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    onChange: (nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    },
                }}
                columns={[
                    {
                        title: "成员",
                        render: (_, item) => (
                            <div>
                                <div>{item.displayName || item.username}</div>
                                <div className="text-xs text-muted-foreground">{item.username}</div>
                            </div>
                        ),
                    },
                    { title: "邮箱", dataIndex: "email", render: (value: string) => value || "-" },
                    { title: "积分", dataIndex: "credits", render: (value: string) => formatDecimal(value) },
                    { title: "状态", dataIndex: "status", render: (value: EnterpriseMember["status"]) => <Tag color={value === "active" ? "success" : "default"}>{value === "active" ? "正常" : "已禁用"}</Tag> },
                    {
                        title: "操作",
                        fixed: "right",
                        width: 320,
                        render: (_, item) => (
                            <Space size={0}>
                                <Button type="link" onClick={() => setCreditsTarget({ member: item, action: "allocate", requestId: nanoid() })}>
                                    分配积分
                                </Button>
                                <Button type="link" onClick={() => setCreditsTarget({ member: item, action: "reclaim", requestId: nanoid() })}>
                                    收回积分
                                </Button>
                                <Popconfirm title={item.status === "active" ? "确认禁用该成员？" : "确认启用该成员？"} onConfirm={() => setStatus(item)}>
                                    <Button type="link" danger={item.status === "active"} loading={saving}>
                                        {item.status === "active" ? "禁用" : "启用"}
                                    </Button>
                                </Popconfirm>
                                <Button type="link" onClick={() => setResetMember(item)}>
                                    重置密码
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />

            <Modal
                title="创建企业成员"
                open={createOpen}
                footer={null}
                onCancel={() => {
                    setCreateOpen(false);
                    createForm.resetFields();
                }}
            >
                <Form form={createForm} layout="vertical" requiredMark={false} onFinish={create}>
                    <Form.Item label="用户名" name="username" rules={[{ required: true, whitespace: true, message: "请输入用户名" }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item label="初始密码" name="password" rules={[{ required: true, message: "请输入初始密码" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item label="昵称" name="displayName">
                        <Input />
                    </Form.Item>
                    <Form.Item label="邮箱" name="email" rules={[{ type: "email", message: "请输入有效邮箱" }]}>
                        <Input />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        创建成员
                    </Button>
                </Form>
            </Modal>

            <Modal
                title={`重置密码${resetMember ? `：${resetMember.displayName || resetMember.username}` : ""}`}
                open={Boolean(resetMember)}
                footer={null}
                onCancel={() => {
                    setResetMember(null);
                    passwordForm.resetFields();
                }}
            >
                <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={resetPassword}>
                    <Form.Item label="新密码" name="password" rules={[{ required: true, message: "请输入新密码" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        重置密码
                    </Button>
                </Form>
            </Modal>

            <Modal
                title={`${creditsTarget?.action === "reclaim" ? "收回" : "分配"}积分${creditsTarget ? `：${creditsTarget.member.displayName || creditsTarget.member.username}` : ""}`}
                open={Boolean(creditsTarget)}
                okText={creditsTarget?.action === "reclaim" ? "确认收回" : "确认分配"}
                cancelText="取消"
                confirmLoading={saving}
                closable={!saving}
                keyboard={!saving}
                maskClosable={!saving}
                onOk={() => creditsForm.submit()}
                onCancel={() => {
                    if (saving) return;
                    setCreditsTarget(null);
                    creditsForm.resetFields();
                }}
            >
                <Form form={creditsForm} layout="vertical" requiredMark={false} onFinish={transferCredits}>
                    <Form.Item label="积分数量" name="amount" rules={[{ required: true, message: "请输入积分数量" }, { validator: (_, value) => (compareDecimal(value, "0") > 0 ? Promise.resolve() : Promise.reject(new Error("积分数量必须为正数"))) }]}>
                        <InputNumber min={0} step="0.01" stringMode className="w-full" placeholder="请输入积分数量" />
                    </Form.Item>
                </Form>
            </Modal>
        </section>
    );
}
