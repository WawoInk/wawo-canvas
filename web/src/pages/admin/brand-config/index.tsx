"use client";

import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Flex, Form, Space, Spin, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAdminSettings, saveAdminSettings, type AdminSettings } from "@/services/api/admin";
import type { PublicNavigationSettings } from "@/services/api/settings";
import { useUserStore } from "@/stores/use-user-store";

const defaultNavigation: PublicNavigationSettings = {
    enabled: true,
    canvas: true,
    storyboard: true,
    image: true,
    video: true,
    assets: true,
    volcengineAssets: true,
    prompts: true,
    storyboardItems: { brainstormAgent: true, storyboard: true, scriptAgent: true },
};

const mainItems = ["canvas", "storyboard", "image", "video", "assets", "volcengineAssets", "prompts"] as const;
const storyboardItems = ["brainstormAgent", "storyboard", "scriptAgent"] as const;
const hiddenStoryboardItems = { brainstormAgent: false, storyboard: false, scriptAgent: false };

function normalizeNavigation(navigation?: PublicNavigationSettings): PublicNavigationSettings {
    const normalized = {
        ...defaultNavigation,
        ...navigation,
        storyboardItems: { ...defaultNavigation.storyboardItems, ...navigation?.storyboardItems },
    };
    if (!normalized.storyboard) normalized.storyboardItems = hiddenStoryboardItems;
    return normalized;
}

export default function AdminBrandConfigPage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [form] = Form.useForm<PublicNavigationSettings>();
    const [settings, setSettings] = useState<AdminSettings | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const navigationEnabled = Form.useWatch("enabled", form) !== false;
    const storyboardEnabled = Form.useWatch("storyboard", form) !== false;

    async function loadSettings() {
        if (!token) return;
        setIsLoading(true);
        setLoadError("");
        try {
            const data = await fetchAdminSettings(token);
            setSettings(data);
            form.setFieldsValue(normalizeNavigation(data.public.navigation));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("admin.brandConfig.states.loadFailed");
            setLoadError(errorMessage);
            message.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }

    async function saveSettings() {
        if (!token || !settings) return;
        setIsSaving(true);
        try {
            const navigation = normalizeNavigation(form.getFieldsValue(true));
            const saved = await saveAdminSettings(token, {
                ...settings,
                public: { ...settings.public, navigation },
            });
            setSettings(saved);
            form.setFieldsValue(normalizeNavigation(saved.public.navigation));
            message.success(t("admin.brandConfig.messages.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin.brandConfig.messages.saveFailed"));
        } finally {
            setIsSaving(false);
        }
    }

    useEffect(() => {
        setSettings(null);
        void loadSettings();
    }, [token]);

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex align="center" justify="space-between" gap={16} wrap>
                        <Flex vertical gap={4}>
                            <Typography.Title level={4} style={{ margin: 0 }}>
                                {t("admin.brandConfig.title")}
                            </Typography.Title>
                            <Typography.Text type="secondary">{t("admin.brandConfig.description")}</Typography.Text>
                        </Flex>
                        <Space wrap>
                            <Button icon={<ReloadOutlined />} loading={isLoading} onClick={() => void loadSettings()}>
                                {t("admin.brandConfig.actions.refresh")}
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} disabled={!settings} loading={isSaving} onClick={() => void saveSettings()}>
                                {t("admin.brandConfig.actions.save")}
                            </Button>
                        </Space>
                    </Flex>
                </Card>

                <Alert showIcon type="info" title={t("admin.brandConfig.notice.title")} description={t("admin.brandConfig.notice.description")} />

                {isLoading && !settings ? (
                    <Card variant="borderless">
                        <Flex vertical align="center" justify="center" gap={12} style={{ minHeight: 320 }}>
                            <Spin size="large" />
                            <Typography.Text type="secondary">{t("admin.brandConfig.states.loading")}</Typography.Text>
                        </Flex>
                    </Card>
                ) : loadError ? (
                    <Alert
                        showIcon
                        type="error"
                        title={t("admin.brandConfig.states.loadFailed")}
                        description={loadError}
                        action={
                            <Button size="small" onClick={() => void loadSettings()}>
                                {t("admin.brandConfig.actions.retry")}
                            </Button>
                        }
                    />
                ) : !token ? (
                    <Alert showIcon type="warning" title={t("admin.brandConfig.states.loginRequired")} />
                ) : settings ? (
                    <Form
                        form={form}
                        initialValues={defaultNavigation}
                        onValuesChange={(changed) => {
                            if (changed.storyboard === false) form.setFieldsValue({ storyboardItems: { ...hiddenStoryboardItems } });
                        }}
                    >
                        <Flex vertical gap={16}>
                            <Card title={t("admin.brandConfig.sections.navigation")} variant="borderless">
                                <Flex align="center" justify="space-between" gap={24}>
                                    <Flex vertical gap={4}>
                                        <Typography.Text strong>{t("admin.brandConfig.fields.enabled")}</Typography.Text>
                                        <Typography.Text type="secondary">{t("admin.brandConfig.fields.enabledDescription")}</Typography.Text>
                                    </Flex>
                                    <Form.Item name="enabled" valuePropName="checked" noStyle>
                                        <Switch aria-label={t("admin.brandConfig.fields.enabled")} />
                                    </Form.Item>
                                </Flex>
                            </Card>

                            <Card title={t("admin.brandConfig.sections.mainItems")} variant="borderless">
                                <Flex vertical>
                                    {mainItems.map((item, index) => {
                                        const isStoryboard = item === "storyboard";
                                        return (
                                            <section
                                                key={item}
                                                data-navigation-item={item}
                                                style={{
                                                    padding: isStoryboard ? "14px 16px 12px" : "14px 0",
                                                    margin: isStoryboard ? "8px 0" : undefined,
                                                    border: isStoryboard ? "1px solid var(--ant-color-border-secondary)" : undefined,
                                                    borderBottom: !isStoryboard && index !== mainItems.length - 1 ? "1px solid var(--ant-color-border-secondary)" : undefined,
                                                    borderRadius: isStoryboard ? 12 : undefined,
                                                }}
                                            >
                                                <Flex align="center" justify="space-between" gap={24}>
                                                    <Typography.Text>{t(`admin.brandConfig.fields.${item}`)}</Typography.Text>
                                                    <Form.Item name={item} valuePropName="checked" noStyle>
                                                        <Switch aria-label={t(`admin.brandConfig.fields.${item}`)} disabled={!navigationEnabled} />
                                                    </Form.Item>
                                                </Flex>

                                                {isStoryboard ? (
                                                    <div
                                                        role="group"
                                                        aria-label={t("admin.brandConfig.sections.storyboardItems")}
                                                        style={{
                                                            marginTop: 12,
                                                            padding: "12px 0 0 16px",
                                                            borderTop: "1px solid var(--ant-color-border-secondary)",
                                                            opacity: navigationEnabled && storyboardEnabled ? 1 : 0.45,
                                                            transition: "opacity 160ms ease",
                                                        }}
                                                    >
                                                        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                                                            {t("admin.brandConfig.sections.storyboardItemsDescription")}
                                                        </Typography.Paragraph>
                                                        {storyboardItems.map((child, childIndex) => (
                                                            <Flex
                                                                key={child}
                                                                align="center"
                                                                justify="space-between"
                                                                gap={24}
                                                                style={{ padding: "12px 0", borderBottom: childIndex === storyboardItems.length - 1 ? undefined : "1px solid var(--ant-color-border-secondary)" }}
                                                            >
                                                                <Typography.Text>{t(`admin.brandConfig.storyboardItems.${child}`)}</Typography.Text>
                                                                <Form.Item name={["storyboardItems", child]} valuePropName="checked" noStyle>
                                                                    <Switch aria-label={t(`admin.brandConfig.storyboardItems.${child}`)} disabled={!navigationEnabled || !storyboardEnabled} />
                                                                </Form.Item>
                                                            </Flex>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </section>
                                        );
                                    })}
                                </Flex>
                            </Card>
                        </Flex>
                    </Form>
                ) : null}
            </Flex>
        </main>
    );
}
