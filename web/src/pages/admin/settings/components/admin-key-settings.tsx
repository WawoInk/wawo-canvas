import { Alert, App, Button, Card, Flex, Input, Popconfirm, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { fetchAdminKeyStatus, generateAdminKey, revokeAdminKey, type AdminKeyStatus } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminKeySettings() {
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [snapshot, setSnapshot] = useState<{ token: string; status: AdminKeyStatus } | null>(null);
    const [loadError, setLoadError] = useState("");
    const [reload, setReload] = useState(0);
    const [busy, setBusy] = useState(false);
    const status = snapshot?.token === token ? snapshot.status : null;
    const loading = !status && !loadError;

    useEffect(() => {
        let active = true;
        setSnapshot(null);
        setLoadError("");
        setBusy(false);
        if (token) {
            fetchAdminKeyStatus(token)
                .then((data) => {
                    if (active) setSnapshot({ token, status: data });
                })
                .catch((error) => {
                    if (active) setLoadError(error instanceof Error ? error.message : "Admin Key 状态读取失败");
                });
        }
        return () => {
            active = false;
        };
    }, [token, reload]);

    const changeKey = async (action: "generate" | "revoke") => {
        if (!token || !status || busy) return;
        setBusy(true);
        setSnapshot({ token, status: { enabled: status.enabled, createdAt: status.createdAt } });
        try {
            let data: AdminKeyStatus;
            if (action === "generate") {
                data = await generateAdminKey(token);
            } else {
                await revokeAdminKey(token);
                data = { enabled: false };
            }
            if (useUserStore.getState().token !== token) return;
            setSnapshot({ token, status: data });
            message.success(action === "generate" ? "Admin Key 已生成，请立即复制保存" : "Admin Key 已撤销");
        } catch (error) {
            if (useUserStore.getState().token === token) message.error(error instanceof Error ? error.message : "Admin Key 操作失败，请重试");
        } finally {
            if (useUserStore.getState().token === token) setBusy(false);
        }
    };

    return (
        <Card title="管理员接口鉴权" variant="borderless" loading={loading} extra={status ? <Tag color={status.enabled ? "success" : "default"}>{status.enabled ? "已生成" : "未生成"}</Tag> : undefined}>
            <Flex vertical gap={16}>
                <Typography.Paragraph type="secondary" className="!mb-0">
                    Admin Key 具有系统管理员权限，用于调用企业、用户与积分管理接口。请求须携带 <Typography.Text code>X-Admin-Key</Typography.Text> Header，接口前缀为 <Typography.Text code>/api/v1/admin</Typography.Text>。
                </Typography.Paragraph>
                {loadError ? <Alert type="error" title={loadError} action={<Button onClick={() => setReload((value) => value + 1)}>重试</Button>} /> : null}
                {status?.key ? (
                    <Flex vertical gap={12}>
                        <Alert type="warning" showIcon title="密钥仅显示本次，请立即复制并妥善保管。离开页面后无法再次查看。" />
                        <Flex gap={8}>
                            <Input.Password aria-label="新生成的 Admin Key" value={status.key} readOnly autoComplete="off" />
                            <Button onClick={() => copyText(status.key!, "Admin Key 已复制")}>复制密钥</Button>
                        </Flex>
                    </Flex>
                ) : null}
                {status?.createdAt ? <Typography.Text type="secondary">最近生成时间：{status.createdAt}</Typography.Text> : null}
                <Space wrap>
                    {status?.enabled ? (
                        <Popconfirm title="重新生成 Admin Key？" description="旧密钥将立即失效，请同步更新外部调用方。" okText="重新生成" cancelText="取消" onConfirm={() => changeKey("generate")} disabled={busy}>
                            <Button loading={busy}>重新生成</Button>
                        </Popconfirm>
                    ) : (
                        <Button type="primary" disabled={!status} loading={busy} onClick={() => void changeKey("generate")}>
                            生成 Admin Key
                        </Button>
                    )}
                    {status?.enabled ? (
                        <Popconfirm title="撤销 Admin Key？" description="使用该密钥的外部请求将立即失去访问权限。" okText="撤销" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => changeKey("revoke")} disabled={busy}>
                            <Button danger disabled={busy}>
                                撤销密钥
                            </Button>
                        </Popconfirm>
                    ) : null}
                </Space>
            </Flex>
        </Card>
    );
}
