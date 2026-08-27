"use client";

import { CircleAlert, ExternalLink, FileAudio, FileImage, FileVideo, PencilLine, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Modal, Pagination, Popconfirm, Result, Select, Skeleton, Spin, Tabs, Tag, Typography } from "antd";

import {
    createVolcengineAsset,
    deleteVolcengineAsset,
    fetchVolcengineAssetOutbounds,
    getVolcengineAsset,
    listVolcengineAssets,
    updateVolcengineAsset,
    volcengineAssetTypes,
    type VolcengineAsset,
    type VolcengineAssetInput,
    type VolcengineAssetType,
} from "@/services/api/volcengine-assets";
import { useUserStore } from "@/stores/use-user-store";

const PAGE_SIZE = 12;
const FORM_ID = "volcengine-asset-form";

type AssetScope = {
    userID: string;
    enterpriseID: string;
};

type AssetFormValues = VolcengineAssetInput;

function outboundsQueryKey(scope: AssetScope) {
    return ["volcengine-assets", "outbounds", scope.userID, scope.enterpriseID] as const;
}

function assetListQueryPrefix(scope: AssetScope, outboundID: string) {
    return ["volcengine-assets", "list", scope.userID, scope.enterpriseID, outboundID] as const;
}

function assetListQueryKey(scope: AssetScope, outboundID: string, page: number, keyword: string) {
    return [...assetListQueryPrefix(scope, outboundID), page, keyword] as const;
}

function assetDetailQueryPrefix(scope: AssetScope, outboundID: string) {
    return ["volcengine-assets", "detail", scope.userID, scope.enterpriseID, outboundID] as const;
}

function assetDetailQueryKey(scope: AssetScope, outboundID: string, assetID: string) {
    return [...assetDetailQueryPrefix(scope, outboundID), assetID] as const;
}

export default function VolcengineAssetsPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const scope = { userID: user?.id || "", enterpriseID: user?.enterpriseId || "" };
    const scopeKey = JSON.stringify([scope.userID, scope.enterpriseID]);
    const [selectedOutbound, setSelectedOutbound] = useState({ scopeKey: "", id: "" });
    const selectedOutboundID = selectedOutbound.scopeKey === scopeKey ? selectedOutbound.id : "";
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState("");
    const [keyword, setKeyword] = useState("");
    const [preview, setPreview] = useState<VolcengineAsset | null>(null);
    const [editing, setEditing] = useState<VolcengineAsset | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm<AssetFormValues>();

    const outboundsQuery = useQuery({
        queryKey: outboundsQueryKey(scope),
        queryFn: () => fetchVolcengineAssetOutbounds(token),
        enabled: Boolean(isReady && token && scope.userID),
        retry: false,
    });
    const outbounds = outboundsQuery.data || [];

    const assetsQuery = useQuery({
        queryKey: assetListQueryKey(scope, selectedOutboundID, page, keyword),
        queryFn: () => listVolcengineAssets(token, selectedOutboundID, page, PAGE_SIZE, keyword),
        enabled: Boolean(isReady && token && scope.userID && selectedOutboundID),
        retry: false,
    });

    const detailQuery = useQuery({
        queryKey: assetDetailQueryKey(scope, selectedOutboundID, preview?.Id || ""),
        queryFn: () => getVolcengineAsset(token, selectedOutboundID, preview?.Id || ""),
        enabled: Boolean(isReady && token && scope.userID && selectedOutboundID && preview?.Id),
        retry: false,
    });

    const invalidateAssets = (targetScope: AssetScope, outboundID: string) =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: assetListQueryPrefix(targetScope, outboundID) }),
            queryClient.invalidateQueries({ queryKey: assetDetailQueryPrefix(targetScope, outboundID) }),
        ]);

    const createMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, input }: { targetScope: AssetScope; outboundID: string; input: AssetFormValues }) => createVolcengineAsset(token, outboundID, input),
        onSuccess: async (_, variables) => {
            setFormOpen(false);
            setPage(1);
            message.success("素材已登记");
            await invalidateAssets(variables.targetScope, variables.outboundID);
        },
        onError: (error) => message.error(errorMessage(error, "登记素材失败")),
    });

    const renameMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, id, name }: { targetScope: AssetScope; outboundID: string; id: string; name: string }) => updateVolcengineAsset(token, outboundID, id, name),
        onSuccess: async (_, variables) => {
            setFormOpen(false);
            setEditing(null);
            message.success("素材名称已更新");
            await invalidateAssets(variables.targetScope, variables.outboundID);
        },
        onError: (error) => message.error(errorMessage(error, "重命名失败")),
    });

    const deleteMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, id }: { targetScope: AssetScope; outboundID: string; id: string }) => deleteVolcengineAsset(token, outboundID, id),
        onSuccess: async (_, variables) => {
            if (preview?.Id === variables.id) setPreview(null);
            if ((assetsQuery.data?.Items?.length || 0) === 1) setPage((current) => Math.max(1, current - 1));
            message.success("素材已删除");
            await invalidateAssets(variables.targetScope, variables.outboundID);
        },
        onError: (error) => message.error(errorMessage(error, "删除素材失败")),
    });

    const isMutating = createMutation.isPending || renameMutation.isPending || deleteMutation.isPending;
    const isFormSubmitting = createMutation.isPending || renameMutation.isPending;

    useEffect(() => {
        setPage(1);
        setSearchInput("");
        setKeyword("");
        setPreview(null);
        setEditing(null);
        setFormOpen(false);
        form.resetFields();
    }, [form, scopeKey]);

    useEffect(() => {
        if (!outbounds.length || outbounds.some((outbound) => outbound.id === selectedOutboundID)) return;
        setSelectedOutbound({ scopeKey, id: outbounds[0].id });
    }, [outbounds, scopeKey, selectedOutboundID]);

    useEffect(() => {
        if (!formOpen) return;
        form.setFieldsValue(editing ? { name: editing.Name } : { name: "", url: "", assetType: "Image" });
    }, [editing, form, formOpen]);

    if (!isReady) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spin />
            </div>
        );
    }

    if (!token || !scope.userID) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Result status="403" title="请先登录后使用火山素材库" />
            </div>
        );
    }

    const assets = assetsQuery.data?.Items || [];
    const total = assetsQuery.data?.TotalCount || 0;
    const deleteMutationID = deleteMutation.isPending ? deleteMutation.variables?.id || "" : "";
    const currentOutbound = outbounds.find((outbound) => outbound.id === selectedOutboundID);
    const refresh = () => void Promise.all([outboundsQuery.refetch(), assetsQuery.refetch()]);
    let content: ReactNode;
    if (outboundsQuery.isLoading) {
        content = <AssetSkeleton />;
    } else if (outboundsQuery.isError) {
        content = <Result status="error" title="无法加载素材库" subTitle={errorMessage(outboundsQuery.error, "请检查登录状态后重试。")} extra={<Button onClick={refresh}>重试</Button>} />;
    } else if (!outbounds.length) {
        content = <Result status="info" title="暂无可用的火山素材库" subTitle="请联系管理员配置可用的火山引擎资产出站。" />;
    } else if (!selectedOutboundID) {
        content = <AssetSkeleton />;
    } else {
        content = (
            <div className="p-5 sm:p-6">
                <Tabs
                    activeKey={selectedOutboundID}
                    onChange={(id) => {
                        if (formOpen || isMutating) return;
                        setSelectedOutbound({ scopeKey, id });
                        setPage(1);
                        setSearchInput("");
                        setKeyword("");
                        setPreview(null);
                    }}
                    items={outbounds.map((outbound) => ({ key: outbound.id, label: outbound.name || outbound.id }))}
                    className="[&_.ant-tabs-nav]:mb-5"
                />
                <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Typography.Title level={5} className="!mb-0 truncate">
                                {currentOutbound?.name || "素材库"}
                            </Typography.Title>
                            {currentOutbound?.format ? <Tag className="m-0">{currentOutbound.format}</Tag> : null}
                            {currentOutbound?.group_type ? <Tag className="m-0">{currentOutbound.group_type}</Tag> : null}
                        </div>
                        <Typography.Text type="secondary" className="mt-1 block text-xs">
                            每页展示 {PAGE_SIZE} 项素材
                        </Typography.Text>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <Input.Search
                            value={searchInput}
                            allowClear
                            enterButton={<Search className="size-4" />}
                            placeholder="按素材名称搜索"
                            className="sm:w-72"
                            onChange={(event) => setSearchInput(event.target.value)}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value.trim());
                            }}
                        />
                        <Button type="primary" icon={<Plus className="size-4" />} disabled={isMutating} onClick={() => {
                            setEditing(null);
                            setFormOpen(true);
                        }}>
                            登记素材
                        </Button>
                    </div>
                </div>

                {assetsQuery.isLoading ? <AssetSkeleton /> : null}
                {assetsQuery.isError ? <Result status="error" title="无法加载素材" subTitle={errorMessage(assetsQuery.error, "请稍后重试。")} extra={<Button onClick={refresh}>重试</Button>} /> : null}
                {!assetsQuery.isLoading && !assetsQuery.isError && !assets.length ? (
                    <Empty description={keyword ? "没有匹配的素材" : "当前素材库还没有素材"}>
                        {!keyword ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => {
                            setEditing(null);
                            setFormOpen(true);
                        }}>登记第一个素材</Button> : null}
                    </Empty>
                ) : null}
                {!assetsQuery.isLoading && !assetsQuery.isError && assets.length ? (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {assets.map((asset) => (
                                <VolcengineAssetCard
                                    key={asset.Id}
                                    asset={asset}
                                    disabled={isMutating}
                                    deleting={deleteMutationID === asset.Id}
                                    onPreview={setPreview}
                                    onEdit={(nextAsset) => {
                                        setEditing(nextAsset);
                                        setFormOpen(true);
                                    }}
                                    onDelete={(nextAsset) => deleteMutation.mutateAsync({ targetScope: scope, outboundID: selectedOutboundID, id: nextAsset.Id })}
                                />
                            ))}
                        </div>
                        <div className="mt-6 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <Typography.Text type="secondary" className="text-xs">
                                共 {total} 项素材
                            </Typography.Text>
                            <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} showQuickJumper={false} disabled={assetsQuery.isFetching || isMutating} onChange={setPage} />
                        </div>
                    </>
                ) : null}
            </div>
        );
    }

    const previewAsset = preview ? detailQuery.data || preview : null;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-muted-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="mx-auto w-full max-w-6xl">
                    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                        <div className="max-w-2xl">
                            <h1 className="text-4xl font-semibold tracking-tight text-foreground">火山素材库</h1>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">浏览和管理已配置素材库中的远端图片、视频与音频。素材保持在对应的远端素材库中。</p>
                        </div>
                        <Button icon={<RefreshCw className={outboundsQuery.isFetching || assetsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />} onClick={refresh}>
                            刷新
                        </Button>
                    </div>
                    <Card className="overflow-hidden border-border/70 bg-card/95" styles={{ body: { padding: 0 } }}>
                        {content}
                    </Card>
                </div>
            </main>

            <Modal
                open={formOpen}
                title={editing ? "重命名素材" : "登记 URL 素材"}
                okText={editing ? "保存名称" : "登记素材"}
                cancelText="取消"
                onCancel={() => {
                    if (isFormSubmitting) return;
                    setFormOpen(false);
                    setEditing(null);
                }}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button
                            disabled={isFormSubmitting}
                            onClick={() => {
                                setFormOpen(false);
                                setEditing(null);
                            }}
                        >
                            取消
                        </Button>
                        <Button type="primary" htmlType="submit" form={FORM_ID} loading={isFormSubmitting}>
                            {editing ? "保存名称" : "登记素材"}
                        </Button>
                    </div>
                }
            >
                <p className="mb-5 text-sm leading-6 text-muted-foreground">{editing ? "编辑仅会更新素材名称，不会修改 URL 或素材类型。" : "通过公开的 http 或 https 媒体 URL 将图片、视频或音频登记到当前素材库。"}</p>
                <Form
                    id={FORM_ID}
                    form={form}
                    layout="vertical"
                    onFinish={(values) => {
                        if (!selectedOutboundID) return;
                        if (editing) {
                            renameMutation.mutate({ targetScope: scope, outboundID: selectedOutboundID, id: editing.Id, name: values.name });
                            return;
                        }
                        createMutation.mutate({ targetScope: scope, outboundID: selectedOutboundID, input: values });
                    }}
                >
                    {!editing ? (
                        <>
                            <Form.Item name="url" label="媒体 URL" rules={[{ required: true, message: "请输入媒体 URL" }, { validator: validateMediaURL }]}>
                                <Input placeholder="https://example.com/media.jpg" autoComplete="url" />
                            </Form.Item>
                            <Form.Item name="assetType" label="素材类型" rules={[{ required: true, message: "请选择素材类型" }]}>
                                <Select options={volcengineAssetTypes.map((value) => ({ value, label: assetTypeLabel(value) }))} />
                            </Form.Item>
                        </>
                    ) : null}
                    <Form.Item name="name" label="素材名称" rules={[{ required: true, whitespace: true, message: "请输入素材名称" }]}>
                        <Input maxLength={200} placeholder="例如：品牌主视觉" autoComplete="off" />
                    </Form.Item>
                </Form>
            </Modal>

            <Drawer open={Boolean(previewAsset)} width={480} title="素材详情" onClose={() => setPreview(null)}>
                {previewAsset ? (
                    <div className="space-y-5">
                        <div className="overflow-hidden rounded-xl border bg-muted/35">
                            <AssetPreview asset={previewAsset} className="aspect-[4/3]" />
                        </div>
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <Typography.Title level={4} className="!mb-1 break-words">
                                        {previewAsset.Name || "未命名素材"}
                                    </Typography.Title>
                                    <Typography.Text type="secondary">{assetTypeLabel(previewAsset.AssetType)}</Typography.Text>
                                </div>
                                <Tag color={statusColor(previewAsset.Status)} className="m-0">
                                    {previewAsset.Status || "未知状态"}
                                </Tag>
                            </div>
                            {assetError(previewAsset) ? <Alert type="error" showIcon message={assetError(previewAsset)} /> : null}
                            {detailQuery.isError ? <Alert type="warning" showIcon message={errorMessage(detailQuery.error, "读取素材详情失败，正在显示列表中的信息。")} /> : null}
                        </div>
                        <div className="rounded-xl border p-4">
                            <Typography.Text type="secondary" className="block text-xs">
                                远端媒体 URL
                            </Typography.Text>
                            <div className="mt-2 flex items-start justify-between gap-3">
                                <Typography.Text className="min-w-0 break-all text-sm">{previewAsset.URL}</Typography.Text>
                                {isSafeMediaURL(previewAsset.URL) ? (
                                    <Button type="link" size="small" icon={<ExternalLink className="size-3.5" />} href={previewAsset.URL} target="_blank" rel="noreferrer">
                                        打开
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <InfoItem label="素材 ID" value={previewAsset.Id} />
                            <InfoItem label="分组 ID" value={previewAsset.GroupId} />
                            <InfoItem label="项目" value={previewAsset.ProjectName} />
                            <InfoItem label="创建时间" value={previewAsset.CreateTime} />
                            <InfoItem label="更新时间" value={previewAsset.UpdateTime} />
                        </div>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function VolcengineAssetCard({ asset, disabled, deleting, onPreview, onEdit, onDelete }: { asset: VolcengineAsset; disabled: boolean; deleting: boolean; onPreview: (asset: VolcengineAsset) => void; onEdit: (asset: VolcengineAsset) => void; onDelete: (asset: VolcengineAsset) => Promise<unknown> }) {
    const error = assetError(asset);
    return (
        <Card hoverable className="h-full overflow-hidden" styles={{ body: { padding: 0 } }}>
            <div className="border-b bg-muted/30">
                <AssetPreview asset={asset} className="aspect-[4/3]" />
            </div>
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => onPreview(asset)}>
                        <h2 className="line-clamp-1 text-sm font-semibold text-foreground">{asset.Name || "未命名素材"}</h2>
                        <span className="mt-1 block text-xs text-muted-foreground">{assetTypeLabel(asset.AssetType)}</span>
                    </button>
                    <Tag color={statusColor(asset.Status)} className="m-0 shrink-0 text-[11px]">
                        {asset.Status || "未知"}
                    </Tag>
                </div>
                {error ? <div className="mt-3 flex gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</div> : null}
                <div className="mt-4 flex items-center gap-2">
                    <Button size="small" onClick={() => onPreview(asset)}>
                        查看
                    </Button>
                    <Button size="small" icon={<PencilLine className="size-3.5" />} disabled={disabled} onClick={() => onEdit(asset)}>
                        重命名
                    </Button>
                    <Popconfirm title="删除此素材？" description="仅删除当前远端素材库中的引用，不会删除原始 URL 指向的媒体。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deleting }} onConfirm={() => onDelete(asset)}>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={disabled && !deleting} loading={deleting}>
                            删除
                        </Button>
                    </Popconfirm>
                </div>
            </div>
        </Card>
    );
}

function AssetPreview({ asset, className }: { asset: VolcengineAsset; className: string }) {
    const [failed, setFailed] = useState(false);
    const mediaURL = isSafeMediaURL(asset.URL) ? asset.URL : "";

    if (mediaURL && asset.AssetType === "Image" && !failed) {
        return <img src={mediaURL} alt={asset.Name || "素材预览"} className={`${className} w-full object-contain`} loading="lazy" onError={() => setFailed(true)} />;
    }

    if (mediaURL && asset.AssetType === "Video" && !failed) {
        return <video src={mediaURL} className={`${className} w-full object-contain`} controls preload="metadata" onError={() => setFailed(true)} />;
    }

    if (mediaURL && asset.AssetType === "Audio" && !failed) {
        return (
            <div className={`${className} flex flex-col items-center justify-center gap-4 px-5 text-muted-foreground`}>
                <FileAudio className="size-10" />
                <audio src={mediaURL} className="w-full" controls preload="metadata" onError={() => setFailed(true)} />
            </div>
        );
    }

    const Icon = asset.AssetType === "Audio" ? FileAudio : asset.AssetType === "Video" ? FileVideo : FileImage;
    return (
        <div className={`${className} flex flex-col items-center justify-center gap-3 px-5 text-center text-sm text-muted-foreground`}>
            <Icon className="size-10" />
            <span>{failed ? "预览加载失败" : "暂无可预览的媒体"}</span>
        </div>
    );
}

function AssetSkeleton() {
    return (
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} active className="h-64" />
            ))}
        </div>
    );
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-lg border p-3">
            <Typography.Text type="secondary" className="block text-xs">
                {label}
            </Typography.Text>
            <Typography.Text className="mt-1 block break-all text-xs">{value || "—"}</Typography.Text>
        </div>
    );
}

function assetTypeLabel(type: VolcengineAssetType) {
    return type === "Image" ? "图片" : type === "Video" ? "视频" : "音频";
}

function assetError(asset: VolcengineAsset) {
    return [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join(" · ");
}

function statusColor(status: string) {
    const value = status.toLowerCase();
    if (value.includes("success") || value.includes("ready") || value.includes("complete")) return "success";
    if (value.includes("fail") || value.includes("error")) return "error";
    if (value.includes("pending") || value.includes("process")) return "processing";
    return "default";
}

function isSafeMediaURL(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function validateMediaURL(_: unknown, value: string) {
    return !value || isSafeMediaURL(value) ? Promise.resolve() : Promise.reject(new Error("仅支持 http 或 https URL"));
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
