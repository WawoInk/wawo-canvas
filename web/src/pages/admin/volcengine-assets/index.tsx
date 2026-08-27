"use client";

import { CheckCircleOutlined, FormatPainterOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Flex, Input, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchAdminVolcengineAssetsConfig, saveAdminVolcengineAssetsConfig } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

function getJsonState(value: string, invalidMessage: string) {
    try {
        return { error: "", formatted: JSON.stringify(JSON.parse(value), null, 2) ?? value };
    } catch (error) {
        return { error: error instanceof Error ? error.message : invalidMessage, formatted: value };
    }
}

export default function AdminVolcengineAssets() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const queryKey = ["admin", "volcengine-assets", "config", token] as const;
    const [serverConfig, setServerConfig] = useState("");
    const [configText, setConfigText] = useState("");
    const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
    const configQuery = useQuery({
        queryKey,
        queryFn: () => fetchAdminVolcengineAssetsConfig(token),
        enabled: Boolean(token),
        retry: false,
        refetchOnWindowFocus: false,
    });
    const jsonState = useMemo(() => getJsonState(configText, t("admin.volcengineAssets.jsonInvalid")), [configText]);
    const isDirty = configText !== serverConfig;
    const saveMutation = useMutation({
        mutationFn: () => saveAdminVolcengineAssetsConfig(token, configText),
        onSuccess: async () => {
            message.success(t("admin.volcengineAssets.messages.saved"));
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t("admin.volcengineAssets.messages.saveFailed"));
        },
    });

    useEffect(() => {
        setServerConfig("");
        setConfigText("");
        setHasLoadedConfig(false);
    }, [token]);

    useEffect(() => {
        if (!configQuery.data) return;
        const nextConfig = getJsonState(configQuery.data.config, t("admin.volcengineAssets.jsonInvalid")).formatted;
        setServerConfig(nextConfig);
        setConfigText(nextConfig);
        setHasLoadedConfig(true);
    }, [configQuery.data, t]);

    const formatConfig = () => {
        if (jsonState.error) {
            message.error(t("admin.volcengineAssets.messages.formatFailed"));
            return;
        }
        setConfigText(jsonState.formatted);
    };

    const resetConfig = () => {
        setConfigText(serverConfig);
        message.info(t("admin.volcengineAssets.messages.reset"));
    };

    const errorMessage = configQuery.error instanceof Error ? configQuery.error.message : t("admin.volcengineAssets.messages.loadFailed");

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex align="center" justify="space-between" gap={16} wrap>
                        <Flex vertical gap={4}>
                            <Space size={8} wrap>
                                <Typography.Title level={4} style={{ margin: 0 }}>
                                    {t("admin.volcengineAssets.title")}
                                </Typography.Title>
                                <Tag color="processing">{t("admin.volcengineAssets.redacted")}</Tag>
                            </Space>
                            <Typography.Text type="secondary">{t("admin.volcengineAssets.description")}</Typography.Text>
                        </Flex>
                        <Space wrap>
                            <Button icon={<FormatPainterOutlined />} disabled={!hasLoadedConfig || Boolean(jsonState.error)} onClick={formatConfig}>
                                {t("admin.volcengineAssets.actions.format")}
                            </Button>
                            <Button icon={<ReloadOutlined />} disabled={!hasLoadedConfig || !isDirty} onClick={resetConfig}>
                                {t("admin.volcengineAssets.actions.reset")}
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} disabled={!hasLoadedConfig || Boolean(jsonState.error)} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                                {t("admin.volcengineAssets.actions.save")}
                            </Button>
                        </Space>
                    </Flex>
                </Card>

                <Card variant="borderless">
                    <Flex vertical gap={16}>
                        <Alert showIcon type="info" message={t("admin.volcengineAssets.security.title")} description={t("admin.volcengineAssets.security.description")} />

                        {configQuery.isLoading ? (
                            <Flex vertical align="center" justify="center" gap={12} style={{ minHeight: 420 }}>
                                <Spin size="large" />
                                <Typography.Text type="secondary">{t("admin.volcengineAssets.states.loading")}</Typography.Text>
                            </Flex>
                        ) : configQuery.isError ? (
                            <Alert
                                showIcon
                                type="error"
                                message={t("admin.volcengineAssets.states.loadFailed")}
                                description={errorMessage}
                                action={
                                    <Button size="small" onClick={() => void configQuery.refetch()}>
                                        {t("admin.volcengineAssets.actions.retry")}
                                    </Button>
                                }
                            />
                        ) : !token ? (
                            <Alert showIcon type="warning" message={t("admin.volcengineAssets.states.loginRequired")} />
                        ) : (
                            <>
                                <Flex align="center" justify="space-between" gap={12} wrap>
                                    <Typography.Text strong>{t("admin.volcengineAssets.jsonLabel")}</Typography.Text>
                                    {jsonState.error ? (
                                        <Tag color="error">{t("admin.volcengineAssets.jsonInvalid")}</Tag>
                                    ) : (
                                        <Tag color="success" icon={<CheckCircleOutlined />}>
                                            {t("admin.volcengineAssets.jsonValid")}
                                        </Tag>
                                    )}
                                </Flex>
                                <Input.TextArea
                                    value={configText}
                                    autoSize={{ minRows: 20, maxRows: 32 }}
                                    placeholder={t("admin.volcengineAssets.placeholder")}
                                    spellCheck={false}
                                    status={jsonState.error ? "error" : undefined}
                                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", lineHeight: 1.6 }}
                                    onChange={(event) => setConfigText(event.target.value)}
                                />
                                {jsonState.error ? <Alert showIcon type="error" message={t("admin.volcengineAssets.jsonInvalid")} description={jsonState.error} /> : null}
                                <Typography.Text type="secondary">{t(isDirty ? "admin.volcengineAssets.states.dirty" : "admin.volcengineAssets.states.clean")}</Typography.Text>
                            </>
                        )}
                    </Flex>
                </Card>
            </Flex>
        </main>
    );
}
