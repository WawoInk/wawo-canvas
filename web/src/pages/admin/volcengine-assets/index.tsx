"use client";

import { CheckCircleOutlined, FormatPainterOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Flex, Input, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { fetchAdminVolcengineAssetsConfig, saveAdminVolcengineAssetsConfig } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

function getJsonState(value: string) {
    try {
        return { error: "", formatted: JSON.stringify(JSON.parse(value), null, 2) ?? value };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "JSON 格式无效", formatted: value };
    }
}

export default function AdminVolcengineAssets() {
    const { message } = App.useApp();
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
    const jsonState = useMemo(() => getJsonState(configText), [configText]);
    const isDirty = configText !== serverConfig;
    const saveMutation = useMutation({
        mutationFn: () => saveAdminVolcengineAssetsConfig(token, configText),
        onSuccess: async () => {
            message.success("配置已保存，已重新读取脱敏内容");
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : "保存配置失败，请稍后重试");
        },
    });

    useEffect(() => {
        if (!configQuery.data) return;
        const nextConfig = getJsonState(configQuery.data.config).formatted;
        setServerConfig(nextConfig);
        setConfigText(nextConfig);
        setHasLoadedConfig(true);
    }, [configQuery.data]);

    const formatConfig = () => {
        if (jsonState.error) {
            message.error("JSON 格式无效，无法格式化");
            return;
        }
        setConfigText(jsonState.formatted);
    };

    const resetConfig = () => {
        setConfigText(serverConfig);
        message.info("已恢复为服务器返回的脱敏配置");
    };

    const errorMessage = configQuery.error instanceof Error ? configQuery.error.message : "读取配置失败，请稍后重试";

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex align="center" justify="space-between" gap={16} wrap>
                        <Flex vertical gap={4}>
                            <Space size={8} wrap>
                                <Typography.Title level={4} style={{ margin: 0 }}>
                                    火山引擎资产
                                </Typography.Title>
                                <Tag color="processing">服务端已脱敏</Tag>
                            </Space>
                            <Typography.Text type="secondary">通过 JSON 管理上游素材库配置，不会在此页面回显凭据。</Typography.Text>
                        </Flex>
                        <Space wrap>
                            <Button icon={<FormatPainterOutlined />} disabled={!hasLoadedConfig || Boolean(jsonState.error)} onClick={formatConfig}>
                                格式化
                            </Button>
                            <Button icon={<ReloadOutlined />} disabled={!hasLoadedConfig || !isDirty} onClick={resetConfig}>
                                重置
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} disabled={!hasLoadedConfig || Boolean(jsonState.error)} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                                保存配置
                            </Button>
                        </Space>
                    </Flex>
                </Card>

                <Card variant="borderless">
                    <Flex vertical gap={16}>
                        <Alert
                            showIcon
                            type="info"
                            message="凭据保护"
                            description="服务端返回的配置已脱敏。secret_key、access_token 等敏感字段不会回显；如未更换凭据，保存时保持其为空，服务端会保留已有值。"
                        />

                        {configQuery.isLoading ? (
                            <Flex vertical align="center" justify="center" gap={12} style={{ minHeight: 420 }}>
                                <Spin size="large" />
                                <Typography.Text type="secondary">正在读取脱敏配置…</Typography.Text>
                            </Flex>
                        ) : configQuery.isError ? (
                            <Alert
                                showIcon
                                type="error"
                                message="读取配置失败"
                                description={errorMessage}
                                action={
                                    <Button size="small" onClick={() => void configQuery.refetch()}>
                                        重试
                                    </Button>
                                }
                            />
                        ) : !token ? (
                            <Alert showIcon type="warning" message="请先登录管理员账号后再管理配置。" />
                        ) : (
                            <>
                                <Flex align="center" justify="space-between" gap={12} wrap>
                                    <Typography.Text strong>配置 JSON</Typography.Text>
                                    {jsonState.error ? (
                                        <Tag color="error">JSON 无效，无法保存</Tag>
                                    ) : (
                                        <Tag color="success" icon={<CheckCircleOutlined />}>
                                            JSON 有效
                                        </Tag>
                                    )}
                                </Flex>
                                <Input.TextArea
                                    value={configText}
                                    autoSize={{ minRows: 20, maxRows: 32 }}
                                    placeholder="加载后可在此编辑 JSON 配置"
                                    spellCheck={false}
                                    status={jsonState.error ? "error" : undefined}
                                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", lineHeight: 1.6 }}
                                    onChange={(event) => setConfigText(event.target.value)}
                                />
                                {jsonState.error ? <Alert showIcon type="error" message="JSON 格式无效" description={jsonState.error} /> : null}
                                <Typography.Text type="secondary">{isDirty ? "当前内容尚未保存" : "当前内容与服务器返回的脱敏配置一致"}</Typography.Text>
                            </>
                        )}
                    </Flex>
                </Card>
            </Flex>
        </main>
    );
}
