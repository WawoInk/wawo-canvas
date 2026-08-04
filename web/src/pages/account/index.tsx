"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Table, Tabs, Tag } from "antd";
import type { Dayjs } from "dayjs";
import type { TFunction } from "i18next";
import { Download } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { enterpriseCapabilities } from "@/lib/account-access";
import { formatDateTime, formatNumber } from "@/i18n/formatters";
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

const platformRoleKeys = {
    guest: "account.roles.platform.guest",
    user: "account.roles.platform.user",
    admin: "account.roles.platform.admin",
} as const;
const enterpriseRoleKeys = { owner: "account.roles.enterprise.owner", member: "account.roles.enterprise.member" } as const;
const enterpriseStatusKeys = { active: "account.status.active", disabled: "account.status.disabled" } as const;
const memberStatusKeys = { active: "account.enterprise.members.status.active", ban: "account.enterprise.members.status.disabled" } as const;
const creditLogTypeKeys: Record<EnterpriseCreditLog["type"], string> = {
    admin_adjust: "account.logs.creditTypes.adminAdjust",
    ai_consume: "account.logs.creditTypes.aiConsume",
    ai_refund: "account.logs.creditTypes.aiRefund",
    enterprise_allocate: "account.logs.creditTypes.enterpriseAllocate",
    enterprise_reclaim: "account.logs.creditTypes.enterpriseReclaim",
};

function createEnterpriseCreditCsvColumns(t: TFunction): CsvColumn<EnterpriseCreditLog>[] {
    return [
        { title: t("account.enterprise.creditLogs.csv.logId"), value: (item) => item.id },
        { title: t("account.enterprise.creditLogs.csv.member"), value: (item) => item.displayName || item.username },
        { title: t("account.enterprise.creditLogs.csv.username"), value: (item) => item.username },
        { title: t("account.enterprise.creditLogs.csv.type"), value: (item) => t(creditLogTypeKeys[item.type]) },
        { title: t("account.enterprise.creditLogs.csv.change"), value: (item) => formatDecimal(item.amount) },
        { title: t("account.enterprise.creditLogs.csv.balance"), value: (item) => formatDecimal(item.balance) },
        { title: t("account.enterprise.creditLogs.csv.relatedId"), value: (item) => item.relatedId || item.taskId },
        { title: t("account.enterprise.creditLogs.csv.counterpartyId"), value: (item) => item.counterpartyId },
        { title: t("account.enterprise.creditLogs.csv.remark"), value: (item) => item.remark },
        { title: t("account.enterprise.creditLogs.csv.time"), value: (item) => (item.createdAt ? formatDateTime(item.createdAt) : "") },
    ];
}

export default function AccountPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
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
            .catch((error) => current && setSummaryError(error instanceof Error ? error.message : t("account.enterprise.overview.loadError")));
        return () => {
            current = false;
        };
    }, [capabilities.showSummary, enterpriseForm, t, token, user?.id]);

    if (!user) return <main className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">{t("account.loading")}</main>;

    const saveProfile = async (values: { displayName: string; email: string }) => {
        setProfileSaving(true);
        try {
            const updated = await updateAccountProfile(token, values);
            setSession(token, updated);
            profileForm.setFieldsValue({ displayName: updated.displayName, email: updated.email });
            message.success(t("account.profile.messages.updateSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.profile.messages.updateError"));
        } finally {
            setProfileSaving(false);
        }
    };

    const changePassword = async (values: { currentPassword: string; newPassword: string }) => {
        setPasswordSaving(true);
        try {
            await changeAccountPassword(token, values);
            clearSession();
            message.success(t("account.password.messages.updateSuccess"));
            navigate("/login", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.password.messages.updateError"));
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
            message.success(t("account.enterprise.overview.renameSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.enterprise.overview.renameError"));
        } finally {
            setEnterpriseSaving(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
                <header className="border-b pb-6">
                    <p className="text-xs text-muted-foreground">{t("account.header.eyebrow")}</p>
                    <h1 className="mt-3 text-3xl font-semibold">{t("account.header.title")}</h1>
                </header>

                <Tabs
                    activeKey={activeSection}
                    items={[{ key: "account", label: t("account.tabs.account") }, { key: "logs", label: t("account.tabs.logs") }, ...(capabilities.showSummary ? [{ key: "enterprise", label: t("account.tabs.enterprise") }] : [])]}
                    onChange={setActiveSection}
                />

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">{t("account.overview.title")}</h2>
                    <Descriptions
                        className="mt-5"
                        column={{ xs: 1, sm: 2 }}
                        items={[
                            { key: "username", label: t("account.overview.fields.username"), children: user.username },
                            { key: "credits", label: t("account.overview.fields.credits"), children: formatDecimal(user.credits) },
                            { key: "role", label: t("account.overview.fields.role"), children: t(platformRoleKeys[user.role]) },
                            { key: "createdAt", label: t("account.overview.fields.registeredAt"), children: user.createdAt ? formatDateTime(user.createdAt) : "-" },
                        ]}
                    />
                </section>

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">{t("account.profile.title")}</h2>
                    <Form form={profileForm} layout="vertical" requiredMark={false} initialValues={{ displayName: user.displayName, email: user.email }} onFinish={saveProfile} className="mt-5 max-w-xl">
                        <Form.Item label={t("account.profile.fields.displayName")} name="displayName">
                            <Input placeholder={t("account.profile.placeholders.displayName")} />
                        </Form.Item>
                        <Form.Item label={t("account.profile.fields.email")} name="email" rules={[{ type: "email", message: t("account.profile.validation.email") }]}>
                            <Input placeholder={t("account.profile.placeholders.email")} />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={profileSaving}>
                            {t("account.profile.actions.save")}
                        </Button>
                    </Form>
                </section>

                <section hidden={activeSection !== "account"} className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">{t("account.password.title")}</h2>
                    <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={changePassword} className="mt-5 max-w-xl">
                        <Form.Item label={t("account.password.fields.current")} name="currentPassword" extra={t("account.password.currentHint")}>
                            <Input.Password autoComplete="current-password" />
                        </Form.Item>
                        <Form.Item label={t("account.password.fields.new")} name="newPassword" rules={[{ required: true, message: t("account.password.validation.newRequired") }]}>
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item
                            label={t("account.password.fields.confirm")}
                            name="confirmPassword"
                            dependencies={["newPassword"]}
                            rules={[
                                { required: true, message: t("account.password.validation.confirmRequired") },
                                ({ getFieldValue }) => ({ validator: (_, value) => (!value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(t("account.password.validation.mismatch")))) }),
                            ]}
                        >
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={passwordSaving}>
                            {t("account.password.actions.update")}
                        </Button>
                    </Form>
                </section>

                {capabilities.showSummary ? (
                    <section hidden={activeSection !== "enterprise"} className="rounded-2xl border border-border bg-card p-6">
                        <h2 className="text-lg font-semibold">{t("account.enterprise.overview.title")}</h2>
                        {!summary && !summaryError ? <Skeleton active paragraph={{ rows: 2 }} className="mt-5" /> : null}
                        {summaryError ? <p className="mt-5 text-sm text-red-500">{summaryError}</p> : null}
                        {summary ? (
                            <>
                                <Descriptions
                                    className="mt-5"
                                    column={{ xs: 1, sm: 2 }}
                                    items={[
                                        { key: "name", label: t("account.enterprise.overview.fields.name"), children: summary.name },
                                        { key: "role", label: t("account.enterprise.overview.fields.role"), children: t(enterpriseRoleKeys[summary.role]) },
                                        { key: "status", label: t("account.enterprise.overview.fields.status"), children: t(enterpriseStatusKeys[summary.status]) },
                                        {
                                            key: "members",
                                            label: t("account.enterprise.overview.fields.memberCount"),
                                            children: t("account.enterprise.overview.memberCount", { count: summary.memberCount, value: formatNumber(summary.memberCount) }),
                                        },
                                        ...(summary.role === "owner"
                                            ? [
                                                  {
                                                      key: "discountRate",
                                                      label: t("account.enterprise.overview.fields.discountRate"),
                                                      children: t("account.enterprise.overview.discountRate", { value: formatDecimal(summary.discountRate) }),
                                                  },
                                              ]
                                            : []),
                                    ]}
                                />
                                {capabilities.canRename ? (
                                    <Form form={enterpriseForm} layout="inline" requiredMark={false} onFinish={renameEnterprise} className="mt-6">
                                        <Form.Item name="name" rules={[{ required: true, message: t("account.enterprise.overview.validation.nameRequired") }]} className="min-w-64 flex-1">
                                            <Input placeholder={t("account.enterprise.overview.placeholders.name")} />
                                        </Form.Item>
                                        <Button type="primary" htmlType="submit" loading={enterpriseSaving}>
                                            {t("account.enterprise.overview.actions.rename")}
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
    const { t } = useTranslation();
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
            .catch((reason) => current && message.error(reason instanceof Error ? reason.message : t("account.enterprise.creditLogs.messages.memberFilterLoadError")));
        return () => {
            current = false;
        };
    }, [message, t, token, user?.id]);

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
                const detail = reason instanceof Error ? reason.message : t("account.enterprise.creditLogs.messages.loadError");
                setLogs([]);
                setTotal(0);
                setError(detail);
            })
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [endTime, keyword, memberId, page, pageSize, startTime, t, token, type, user?.credits, user?.id]);

    const exportLogs = async () => {
        setExporting(true);
        try {
            const rows = await fetchAllPages((nextPage, nextPageSize) => fetchEnterpriseCreditLogs(token, { memberId, type, keyword, start_time: startTime, end_time: endTime, page: nextPage, pageSize: nextPageSize }));
            if (!rows.length) {
                message.warning(t("account.enterprise.creditLogs.messages.emptyExport"));
                return;
            }
            downloadCsv(t("account.enterprise.creditLogs.export.fileName"), createEnterpriseCreditCsvColumns(t), rows);
            message.success(t("account.enterprise.creditLogs.messages.exportSuccess"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("account.enterprise.creditLogs.messages.exportError"));
        } finally {
            setExporting(false);
        }
    };

    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div>
                <h2 className="text-lg font-semibold">{t("account.enterprise.creditLogs.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("account.enterprise.creditLogs.description")}</p>
            </div>
            <Space wrap className="mt-5">
                <Select
                    allowClear
                    aria-label={t("account.enterprise.creditLogs.filters.memberAria")}
                    className="w-48"
                    placeholder={t("account.enterprise.creditLogs.filters.allMembers")}
                    value={memberId || undefined}
                    options={[
                        ...(user ? [{ value: user.id, label: t("account.enterprise.creditLogs.filters.mainAccount", { name: user.displayName || user.username }) }] : []),
                        ...members.map((member) => ({
                            value: member.id,
                            label: member.displayName ? t("account.enterprise.creditLogs.filters.memberName", { displayName: member.displayName, username: member.username }) : member.username,
                        })),
                    ]}
                    onChange={(value) => {
                        setMemberId(value || "");
                        setPage(1);
                    }}
                />
                <Select
                    allowClear
                    aria-label={t("account.enterprise.creditLogs.filters.typeAria")}
                    className="w-36"
                    placeholder={t("account.enterprise.creditLogs.filters.allTypes")}
                    value={type || undefined}
                    options={Object.entries(creditLogTypeKeys).map(([value, key]) => ({ value, label: t(key) }))}
                    onChange={(value) => {
                        setType(value || "");
                        setPage(1);
                    }}
                />
                <DatePicker.RangePicker
                    value={range}
                    format={t("account.logs.filters.dateFormat")}
                    placeholder={[t("account.logs.filters.startDate"), t("account.logs.filters.endDate")]}
                    onChange={(value) => {
                        setRange(value as [Dayjs, Dayjs] | null);
                        setPage(1);
                    }}
                />
                <Input.Search
                    allowClear
                    aria-label={t("account.enterprise.creditLogs.filters.searchAria")}
                    className="w-72"
                    placeholder={t("account.enterprise.creditLogs.filters.searchPlaceholder")}
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
                    {t("account.enterprise.creditLogs.export.button")}
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
                        title: t("account.enterprise.creditLogs.table.member"),
                        width: 180,
                        render: (_, item) => (
                            <div>
                                <div>{item.displayName || item.username}</div>
                                <div className="text-xs text-muted-foreground">{item.username}</div>
                            </div>
                        ),
                    },
                    { title: t("account.enterprise.creditLogs.table.type"), dataIndex: "type", width: 120, render: (value: EnterpriseCreditLog["type"]) => <Tag>{t(creditLogTypeKeys[value])}</Tag> },
                    {
                        title: t("account.enterprise.creditLogs.table.change"),
                        dataIndex: "amount",
                        width: 100,
                        render: (value: string) => <span className={compareDecimal(value, "0") >= 0 ? "text-green-600" : "text-red-500"}>{compareDecimal(value, "0") > 0 ? `+${formatDecimal(value)}` : formatDecimal(value)}</span>,
                    },
                    { title: t("account.enterprise.creditLogs.table.balance"), dataIndex: "balance", width: 100, render: (value: string) => formatDecimal(value) },
                    {
                        title: t("account.enterprise.creditLogs.table.relatedInfo"),
                        width: 260,
                        render: (_, item) => (
                            <div className="text-xs text-muted-foreground">
                                <div>{item.relatedId || item.taskId || "-"}</div>
                                {item.counterpartyId ? <div>{t("account.enterprise.creditLogs.table.counterparty", { id: item.counterpartyId })}</div> : null}
                            </div>
                        ),
                    },
                    { title: t("account.enterprise.creditLogs.table.remark"), dataIndex: "remark", ellipsis: true, render: (value: string) => value || "-" },
                    { title: t("account.enterprise.creditLogs.table.time"), dataIndex: "createdAt", width: 180, render: (value: string) => (value ? formatDateTime(value) : "-") },
                ]}
            />
        </section>
    );
}

function EnterpriseMembers({ onCreated }: { onCreated: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
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
            .catch((error) => current && message.error(error instanceof Error ? error.message : t("account.enterprise.members.messages.loadError")))
            .finally(() => current && setLoading(false));
        return () => {
            current = false;
        };
    }, [keyword, message, page, pageSize, refreshKey, t, token]);

    const create = async (values: { username: string; password: string; displayName?: string; email?: string }) => {
        setSaving(true);
        try {
            await createEnterpriseMember(token, values);
            createForm.resetFields();
            setCreateOpen(false);
            setPage(1);
            setRefreshKey((value) => value + 1);
            onCreated();
            message.success(t("account.enterprise.members.messages.createSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.enterprise.members.messages.createError"));
        } finally {
            setSaving(false);
        }
    };

    const setStatus = async (member: EnterpriseMember) => {
        setSaving(true);
        try {
            await setEnterpriseMemberStatus(token, member.id, member.status === "active" ? "ban" : "active");
            setRefreshKey((value) => value + 1);
            message.success(member.status === "active" ? t("account.enterprise.members.messages.disableSuccess") : t("account.enterprise.members.messages.enableSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.enterprise.members.messages.statusError"));
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
            message.success(t("account.enterprise.members.messages.passwordResetSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.enterprise.members.messages.passwordResetError"));
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
            message.success(result.action === "allocate" ? t("account.enterprise.members.messages.allocateSuccess") : t("account.enterprise.members.messages.reclaimSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : creditsTarget.action === "allocate" ? t("account.enterprise.members.messages.allocateError") : t("account.enterprise.members.messages.reclaimError"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">{t("account.enterprise.members.title")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("account.enterprise.members.description")}</p>
                </div>
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                    {t("account.enterprise.members.actions.create")}
                </Button>
            </div>
            <Input.Search
                allowClear
                aria-label={t("account.enterprise.members.searchAria")}
                placeholder={t("account.enterprise.members.searchPlaceholder")}
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
                        title: t("account.enterprise.members.table.member"),
                        render: (_, item) => (
                            <div>
                                <div>{item.displayName || item.username}</div>
                                <div className="text-xs text-muted-foreground">{item.username}</div>
                            </div>
                        ),
                    },
                    { title: t("account.enterprise.members.table.email"), dataIndex: "email", render: (value: string) => value || "-" },
                    { title: t("account.enterprise.members.table.credits"), dataIndex: "credits", render: (value: string) => formatDecimal(value) },
                    {
                        title: t("account.enterprise.members.table.status"),
                        dataIndex: "status",
                        render: (value: EnterpriseMember["status"]) => <Tag color={value === "active" ? "success" : "default"}>{t(memberStatusKeys[value])}</Tag>,
                    },
                    {
                        title: t("account.enterprise.members.table.actions"),
                        fixed: "right",
                        width: 320,
                        render: (_, item) => (
                            <Space size={0}>
                                <Button type="link" onClick={() => setCreditsTarget({ member: item, action: "allocate", requestId: nanoid() })}>
                                    {t("account.enterprise.members.actions.allocate")}
                                </Button>
                                <Button type="link" onClick={() => setCreditsTarget({ member: item, action: "reclaim", requestId: nanoid() })}>
                                    {t("account.enterprise.members.actions.reclaim")}
                                </Button>
                                <Popconfirm title={item.status === "active" ? t("account.enterprise.members.confirm.disable") : t("account.enterprise.members.confirm.enable")} onConfirm={() => setStatus(item)}>
                                    <Button type="link" danger={item.status === "active"} loading={saving}>
                                        {item.status === "active" ? t("account.enterprise.members.actions.disable") : t("account.enterprise.members.actions.enable")}
                                    </Button>
                                </Popconfirm>
                                <Button type="link" onClick={() => setResetMember(item)}>
                                    {t("account.enterprise.members.actions.resetPassword")}
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />

            <Modal
                title={t("account.enterprise.members.modals.createTitle")}
                open={createOpen}
                footer={null}
                onCancel={() => {
                    setCreateOpen(false);
                    createForm.resetFields();
                }}
            >
                <Form form={createForm} layout="vertical" requiredMark={false} onFinish={create}>
                    <Form.Item label={t("account.enterprise.members.fields.username")} name="username" rules={[{ required: true, whitespace: true, message: t("account.enterprise.members.validation.usernameRequired") }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item label={t("account.enterprise.members.fields.initialPassword")} name="password" rules={[{ required: true, message: t("account.enterprise.members.validation.initialPasswordRequired") }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item label={t("account.enterprise.members.fields.displayName")} name="displayName">
                        <Input />
                    </Form.Item>
                    <Form.Item label={t("account.enterprise.members.fields.email")} name="email" rules={[{ type: "email", message: t("account.enterprise.members.validation.email") }]}>
                        <Input />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        {t("account.enterprise.members.actions.create")}
                    </Button>
                </Form>
            </Modal>

            <Modal
                title={resetMember ? t("account.enterprise.members.modals.resetPasswordFor", { name: resetMember.displayName || resetMember.username }) : t("account.enterprise.members.actions.resetPassword")}
                open={Boolean(resetMember)}
                footer={null}
                onCancel={() => {
                    setResetMember(null);
                    passwordForm.resetFields();
                }}
            >
                <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={resetPassword}>
                    <Form.Item label={t("account.enterprise.members.fields.newPassword")} name="password" rules={[{ required: true, message: t("account.enterprise.members.validation.newPasswordRequired") }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                        {t("account.enterprise.members.actions.resetPassword")}
                    </Button>
                </Form>
            </Modal>

            <Modal
                title={
                    creditsTarget
                        ? t(creditsTarget.action === "reclaim" ? "account.enterprise.members.modals.reclaimFor" : "account.enterprise.members.modals.allocateFor", {
                              name: creditsTarget.member.displayName || creditsTarget.member.username,
                          })
                        : ""
                }
                open={Boolean(creditsTarget)}
                okText={creditsTarget?.action === "reclaim" ? t("account.enterprise.members.actions.confirmReclaim") : t("account.enterprise.members.actions.confirmAllocate")}
                cancelText={t("account.enterprise.members.actions.cancel")}
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
                    <Form.Item
                        label={t("account.enterprise.members.fields.creditAmount")}
                        name="amount"
                        rules={[
                            { required: true, message: t("account.enterprise.members.validation.creditAmountRequired") },
                            { validator: (_, value) => (compareDecimal(value, "0") > 0 ? Promise.resolve() : Promise.reject(new Error(t("account.enterprise.members.validation.creditAmountPositive")))) },
                        ]}
                    >
                        <InputNumber min={0} step="0.01" stringMode className="w-full" placeholder={t("account.enterprise.members.placeholders.creditAmount")} />
                    </Form.Item>
                </Form>
            </Modal>
        </section>
    );
}
