"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Segmented, Space } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { BorderBeam } from "@/components/ui/border-beam";
import { fetchCurrentUser } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type LoginFormValues = {
    username: string;
    password: string;
    confirmPassword?: string;
};

// 仅放行站内相对路径，拦截开放重定向。浏览器会忽略 URL 中的 Tab/换行/回车，并把
// //host 或 /\host 解析为协议相对的跨站地址，因此先剥离控制字符，再拒绝 // 与 /\ 前缀。
function safeRedirect(value: string | null): string {
    const cleaned = (value ?? "").replace(/[\t\n\r]/g, "");
    if (!cleaned.startsWith("/") || cleaned.startsWith("//") || cleaned.startsWith("/\\")) {
        return "/";
    }
    return cleaned;
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const setSession = useUserStore((state) => state.setSession);
    const isLoading = useUserStore((state) => state.isLoading);
    const linuxDoEnabled = useConfigStore((state) => state.publicSettings?.auth?.linuxDo?.enabled === true);
    const allowRegister = useConfigStore((state) => state.publicSettings?.auth?.allowRegister !== false);
    const [mode, setMode] = useState<"login" | "register">("login");
    const redirect = safeRedirect(searchParams.get("redirect"));

    useEffect(() => {
        const token = searchParams.get("token");
        const error = searchParams.get("error");
        if (error) message.error(error);
        if (!token) return;
        void fetchCurrentUser(token).then((user) => {
            setSession(token, user);
            message.success(t("auth.messages.loginSuccess"));
            navigate(redirect, { replace: true });
            window.location.reload();
        });
    }, [message, redirect, navigate, searchParams, setSession, t]);

    useEffect(() => {
        if (!allowRegister && mode === "register") setMode("login");
    }, [allowRegister, mode]);

    const submit = async (values: LoginFormValues) => {
        try {
            if (mode === "register" && !allowRegister) {
                message.error(t("auth.messages.registrationDisabled"));
                return;
            }
            if (mode === "register" && values.password !== values.confirmPassword) {
                message.error(t("auth.validation.passwordMismatch"));
                return;
            }
            const action = mode === "register" ? register : login;
            const user = await action({ username: values.username, password: values.password });
            message.success(mode === "register" ? t("auth.messages.registerSuccess") : t("auth.messages.loginSuccess"));
            navigate(redirect, { replace: true });
            window.location.reload();
            if (user.role !== "admin") navigate("/", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.messages.loginFailed"));
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)]">
            <section className="relative w-full max-w-[420px] rounded-[16px] overflow-hidden">
                <div className="mb-7 text-center">
                    <BrandLogo variant="full" height={64} className="mx-auto mb-4" />
                    <h1 className="text-3xl font-semibold tracking-normal text-foreground">{t("auth.title")}</h1>
                    <p className="mt-3 text-base leading-7 text-muted-foreground">{t("auth.description")}</p>
                </div>

                <Form<LoginFormValues> layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    <Form.Item>
                        <Segmented
                            block
                            value={mode}
                            onChange={(value) => setMode(value as "login" | "register")}
                            options={
                                allowRegister
                                    ? [
                                          { label: t("common.login"), value: "login" },
                                          { label: t("common.register"), value: "register" },
                                      ]
                                    : [{ label: t("common.login"), value: "login" }]
                            }
                        />
                    </Form.Item>
                    <Form.Item name="username" label={<span className="font-medium text-foreground">{t("auth.fields.username")}</span>} rules={[{ required: true, message: t("auth.validation.usernameRequired") }]}>
                        <Input prefix={<UserOutlined />} autoComplete="username" />
                    </Form.Item>
                    <Form.Item name="password" label={<span className="font-medium text-foreground">{t("auth.fields.password")}</span>} rules={[{ required: true, message: t("auth.validation.passwordRequired") }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    {mode === "register" ? (
                        <Form.Item name="confirmPassword" label={<span className="font-medium text-foreground">{t("auth.fields.confirmPassword")}</span>} rules={[{ required: true, message: t("auth.validation.confirmPasswordRequired") }]}>
                            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                        </Form.Item>
                    ) : null}
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Button block type="primary" htmlType="submit" loading={isLoading}>
                            {mode === "register" ? t("common.register") : t("common.login")}
                        </Button>
                        {linuxDoEnabled ? (
                            <Button block href={`/api/auth/linux-do/authorize?redirect=${encodeURIComponent(redirect)}`} icon={<img src="/icons/linuxdo.svg" alt="" width={18} height={18} />}>
                                {t("auth.actions.loginWithLinuxDo")}
                            </Button>
                        ) : null}
                    </Space>
                </Form>
                <BorderBeam size={120} duration={8} colorFrom="#E8956A" colorTo="#F0B898" />
            </section>
        </main>
    );
}
