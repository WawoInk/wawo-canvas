"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, Descriptions, Form, Input, Skeleton } from "antd";

import { enterpriseCapabilities } from "@/lib/account-access";
import { changeAccountPassword, fetchEnterpriseAccountSummary, updateAccountEnterprise, updateAccountProfile, type EnterpriseAccountSummary } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

const platformRoleLabels = { guest: "访客", user: "普通用户", admin: "平台管理员" } as const;
const enterpriseRoleLabels = { owner: "企业主账号", member: "企业成员" } as const;
const enterpriseStatusLabels = { active: "正常", disabled: "已禁用" } as const;

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

                <section className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-semibold">账户概况</h2>
                    <Descriptions
                        className="mt-5"
                        column={{ xs: 1, sm: 2 }}
                        items={[
                            { key: "username", label: "用户名", children: user.username },
                            { key: "credits", label: "当前积分", children: user.credits.toLocaleString() },
                            { key: "role", label: "平台身份", children: platformRoleLabels[user.role] },
                            { key: "createdAt", label: "注册时间", children: user.createdAt ? new Date(user.createdAt).toLocaleString("zh-CN") : "-" },
                        ]}
                    />
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
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

                <section className="rounded-2xl border border-border bg-card p-6">
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
                    <section className="rounded-2xl border border-border bg-card p-6">
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
            </div>
        </main>
    );
}
