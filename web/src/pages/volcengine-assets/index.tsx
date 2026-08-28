"use client";

import { CircleAlert, ExternalLink, FileAudio, FileImage, FileVideo, PencilLine, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Modal, Pagination, Popconfirm, Result, Select, Skeleton, Spin, Tabs, Tag, Typography, Upload, type UploadFile } from "antd";

import {
    createVolcengineAssets,
    deleteVolcengineAsset,
    fetchVolcengineAssetOutbounds,
    getVolcengineAsset,
    listVolcengineAssets,
    updateVolcengineAsset,
    uploadVolcengineAssets,
    volcengineAssetTypes,
    type VolcengineAsset,
    type VolcengineAssetBatchResult,
    type VolcengineAssetInput,
    type VolcengineLocalAssetInput,
    type VolcengineAssetType,
} from "@/services/api/volcengine-assets";
import { useUserStore } from "@/stores/use-user-store";

const PAGE_SIZE = 12;
const FORM_ID = "volcengine-asset-form";

type AssetScope = {
    userID: string;
    enterpriseID: string;
};

type AssetFormValues = VolcengineAssetInput & { file?: UploadFile[] };
type AssetUploadSource = "url" | "local";

function mediaURLs(value: string) {
    return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function mediaAssetType(mimeType: string): VolcengineAssetType | undefined {
    if (mimeType.startsWith("image/")) return "Image";
    if (mimeType.startsWith("video/")) return "Video";
    if (mimeType.startsWith("audio/")) return "Audio";
}

function batchAssetName(name: string, index: number, total: number) {
    const suffix = total === 1 ? "" : ` ${index + 1}`;
    return `${name.trim().slice(0, 200 - suffix.length)}${suffix}`;
}

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
    const { t } = useTranslation();
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
    const [uploadSource, setUploadSource] = useState<AssetUploadSource>("url");
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
        Promise.all([queryClient.invalidateQueries({ queryKey: assetListQueryPrefix(targetScope, outboundID) }), queryClient.invalidateQueries({ queryKey: assetDetailQueryPrefix(targetScope, outboundID) })]);

    const completeAssetBatch = async (result: VolcengineAssetBatchResult, variables: { targetScope: AssetScope; outboundID: string }) => {
        if (result.successCount) {
            setFormOpen(false);
            setPage(1);
        }
        if (!result.failedCount) message.success(t(result.total === 1 ? "volcengineAssets.messages.created" : "volcengineAssets.messages.batchCreated", { count: result.successCount }));
        else if (result.successCount) message.warning(t("volcengineAssets.messages.batchPartial", { success: result.successCount, failed: result.failedCount }));
        else message.error(errorMessage(result.firstError, t("volcengineAssets.messages.createFailed")));
        await invalidateAssets(variables.targetScope, variables.outboundID);
    };

    const createMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, input }: { targetScope: AssetScope; outboundID: string; input: VolcengineAssetInput[] }) => createVolcengineAssets(token, outboundID, input),
        onSuccess: completeAssetBatch,
        onError: (error) => message.error(errorMessage(error, t("volcengineAssets.messages.createFailed"))),
    });

    const localUploadMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, input }: { targetScope: AssetScope; outboundID: string; input: VolcengineLocalAssetInput[] }) => uploadVolcengineAssets(token, outboundID, input),
        onSuccess: completeAssetBatch,
        onError: (error) => message.error(errorMessage(error, t("volcengineAssets.messages.createFailed"))),
    });

    const renameMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, id, name }: { targetScope: AssetScope; outboundID: string; id: string; name: string }) => updateVolcengineAsset(token, outboundID, id, name),
        onSuccess: async (_, variables) => {
            setFormOpen(false);
            setEditing(null);
            message.success(t("volcengineAssets.messages.renamed"));
            await invalidateAssets(variables.targetScope, variables.outboundID);
        },
        onError: (error) => message.error(errorMessage(error, t("volcengineAssets.messages.renameFailed"))),
    });

    const deleteMutation = useMutation({
        mutationFn: ({ targetScope, outboundID, id }: { targetScope: AssetScope; outboundID: string; id: string }) => deleteVolcengineAsset(token, outboundID, id),
        onSuccess: async (_, variables) => {
            if (preview?.Id === variables.id) setPreview(null);
            if ((assetsQuery.data?.Items?.length || 0) === 1) setPage((current) => Math.max(1, current - 1));
            message.success(t("volcengineAssets.messages.deleted"));
            await invalidateAssets(variables.targetScope, variables.outboundID);
        },
        onError: (error) => message.error(errorMessage(error, t("volcengineAssets.messages.deleteFailed"))),
    });

    const isMutating = createMutation.isPending || localUploadMutation.isPending || renameMutation.isPending || deleteMutation.isPending;
    const isFormSubmitting = createMutation.isPending || localUploadMutation.isPending || renameMutation.isPending;

    useEffect(() => {
        setPage(1);
        setSearchInput("");
        setKeyword("");
        setPreview(null);
        setEditing(null);
        setFormOpen(false);
        setUploadSource("url");
        form.resetFields();
    }, [form, scopeKey]);

    useEffect(() => {
        if (!outbounds.length || outbounds.some((outbound) => outbound.id === selectedOutboundID)) return;
        setSelectedOutbound({ scopeKey, id: outbounds[0].id });
    }, [outbounds, scopeKey, selectedOutboundID]);

    useEffect(() => {
        if (!formOpen) return;
        setUploadSource("url");
        form.setFieldsValue(editing ? { name: editing.Name } : { name: "", url: "", assetType: "Image", file: [] });
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
                <Result status="403" title={t("volcengineAssets.states.loginRequired")} />
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
        content = (
            <Result status="error" title={t("volcengineAssets.states.loadFailed")} subTitle={errorMessage(outboundsQuery.error, t("volcengineAssets.states.checkLogin"))} extra={<Button onClick={refresh}>{t("volcengineAssets.actions.retry")}</Button>} />
        );
    } else if (!outbounds.length) {
        content = <Result status="info" title={t("volcengineAssets.states.noOutbound")} subTitle={t("volcengineAssets.states.noOutboundDescription")} />;
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
                                {currentOutbound?.name || t("volcengineAssets.fallbacks.library")}
                            </Typography.Title>
                            {currentOutbound?.format ? <Tag className="m-0">{currentOutbound.format}</Tag> : null}
                            {currentOutbound?.group_type ? <Tag className="m-0">{currentOutbound.group_type}</Tag> : null}
                        </div>
                        <Typography.Text type="secondary" className="mt-1 block text-xs">
                            {t("volcengineAssets.pagination.pageSize", { count: PAGE_SIZE })}
                        </Typography.Text>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <Input.Search
                            value={searchInput}
                            allowClear
                            enterButton={<Search className="size-4" />}
                            placeholder={t("volcengineAssets.search.placeholder")}
                            className="sm:w-72"
                            onChange={(event) => setSearchInput(event.target.value)}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value.trim());
                            }}
                        />
                        <Button
                            type="primary"
                            icon={<Plus className="size-4" />}
                            disabled={isMutating}
                            onClick={() => {
                                setEditing(null);
                                setFormOpen(true);
                            }}
                        >
                            {t("volcengineAssets.actions.create")}
                        </Button>
                    </div>
                </div>

                {assetsQuery.isLoading ? <AssetSkeleton /> : null}
                {assetsQuery.isError ? (
                    <Result
                        status="error"
                        title={t("volcengineAssets.states.assetLoadFailed")}
                        subTitle={errorMessage(assetsQuery.error, t("volcengineAssets.states.retry"))}
                        extra={<Button onClick={refresh}>{t("volcengineAssets.actions.retry")}</Button>}
                    />
                ) : null}
                {!assetsQuery.isLoading && !assetsQuery.isError && !assets.length ? (
                    <Empty description={keyword ? t("volcengineAssets.states.noMatch") : t("volcengineAssets.states.empty")}>
                        {!keyword ? (
                            <Button
                                type="primary"
                                icon={<Plus className="size-4" />}
                                onClick={() => {
                                    setEditing(null);
                                    setFormOpen(true);
                                }}
                            >
                                {t("volcengineAssets.actions.createFirst")}
                            </Button>
                        ) : null}
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
                                    t={t}
                                    onDelete={(nextAsset) => deleteMutation.mutateAsync({ targetScope: scope, outboundID: selectedOutboundID, id: nextAsset.Id })}
                                />
                            ))}
                        </div>
                        <div className="mt-6 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <Typography.Text type="secondary" className="text-xs">
                                {t("volcengineAssets.pagination.total", { count: total })}
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
                            <h1 className="text-4xl font-semibold tracking-tight text-foreground">{t("volcengineAssets.title")}</h1>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("volcengineAssets.description")}</p>
                        </div>
                        <Button icon={<RefreshCw className={outboundsQuery.isFetching || assetsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />} onClick={refresh}>
                            {t("volcengineAssets.actions.refresh")}
                        </Button>
                    </div>
                    <Card className="overflow-hidden border-border/70 bg-card/95" styles={{ body: { padding: 0 } }}>
                        {content}
                    </Card>
                </div>
            </main>

            <Modal
                open={formOpen}
                title={editing ? t("volcengineAssets.actions.rename") : uploadSource === "local" ? t("volcengineAssets.actions.uploadLocal") : t("volcengineAssets.actions.registerURL")}
                okText={editing ? t("volcengineAssets.actions.saveName") : t("volcengineAssets.actions.create")}
                cancelText={t("volcengineAssets.actions.cancel")}
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
                            {t("volcengineAssets.actions.cancel")}
                        </Button>
                        <Button type="primary" htmlType="submit" form={FORM_ID} loading={isFormSubmitting}>
                            {editing ? t("volcengineAssets.actions.saveName") : t("volcengineAssets.actions.create")}
                        </Button>
                    </div>
                }
            >
                <p className="mb-5 text-sm leading-6 text-muted-foreground">{editing ? t("volcengineAssets.form.editDescription") : uploadSource === "local" ? t("volcengineAssets.form.localDescription") : t("volcengineAssets.form.createDescription")}</p>
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
                        if (uploadSource === "local") {
                            const files = values.file?.flatMap((item) => (item.originFileObj ? [item.originFileObj] : [])) || [];
                            if (!files.length) {
                                message.error(t("volcengineAssets.form.fileRequired"));
                                return;
                            }
                            if (files.some((file) => mediaAssetType(file.type) !== values.assetType)) {
                                message.error(t("volcengineAssets.form.fileTypeMismatch"));
                                return;
                            }
                            localUploadMutation.mutate({
                                targetScope: scope,
                                outboundID: selectedOutboundID,
                                input: files.map((file, index) => ({ file, name: batchAssetName(values.name, index, files.length), assetType: values.assetType })),
                            });
                            return;
                        }
                        const urls = mediaURLs(values.url);
                        createMutation.mutate({
                            targetScope: scope,
                            outboundID: selectedOutboundID,
                            input: urls.map((url, index) => ({ url, name: batchAssetName(values.name, index, urls.length), assetType: values.assetType })),
                        });
                    }}
                >
                    {!editing ? (
                        <>
                            <Tabs
                                activeKey={uploadSource}
                                className="mb-4"
                                items={[
                                    { key: "url", label: t("volcengineAssets.form.urlSource") },
                                    { key: "local", label: t("volcengineAssets.form.localSource") },
                                ]}
                                onChange={(value) => {
                                    setUploadSource(value as AssetUploadSource);
                                    form.setFieldValue("file", []);
                                }}
                            />
                            {uploadSource === "url" ? (
                                <Form.Item name="url" label={t("volcengineAssets.form.url")} extra={t("volcengineAssets.form.urlDescription")} rules={[{ required: true, message: t("volcengineAssets.form.urlRequired") }, { validator: (_, value) => validateMediaURL(_, value, t) }]}>
                                    <Input.TextArea placeholder={"https://example.com/media-1.jpg\nhttps://example.com/media-2.jpg"} autoSize={{ minRows: 3, maxRows: 6 }} />
                                </Form.Item>
                            ) : (
                                <Form.Item name="file" label={t("volcengineAssets.form.file")} valuePropName="fileList" getValueFromEvent={(event) => event?.fileList || []} rules={[{ required: true, message: t("volcengineAssets.form.fileRequired") }]}>
                                    <Upload
                                        accept="image/*,video/*,audio/*"
                                        multiple
                                        beforeUpload={(file) => {
                                            const fileType = mediaAssetType(file.type);
                                            const selectedType = form.getFieldValue("assetType") as VolcengineAssetType | undefined;
                                            if (!fileType || (selectedType && fileType !== selectedType)) {
                                                message.error(t("volcengineAssets.form.fileTypeMismatch"));
                                                return Upload.LIST_IGNORE;
                                            }
                                            if (!selectedType) form.setFieldValue("assetType", fileType);
                                            if (!form.getFieldValue("name")) form.setFieldValue("name", file.name.replace(/\.[^/.]+$/, ""));
                                            return false;
                                        }}
                                    >
                                        <Button>{t("volcengineAssets.form.selectFile")}</Button>
                                    </Upload>
                                </Form.Item>
                            )}
                            <Form.Item name="assetType" label={t("volcengineAssets.form.type")} rules={[{ required: true, message: t("volcengineAssets.form.typeRequired") }]}>
                                <Select options={volcengineAssetTypes.map((value) => ({ value, label: assetTypeLabel(value, t) }))} />
                            </Form.Item>
                        </>
                    ) : null}
                    <Form.Item name="name" label={t("volcengineAssets.form.name")} rules={[{ required: true, whitespace: true, message: t("volcengineAssets.form.nameRequired") }]}>
                        <Input maxLength={200} placeholder={t("volcengineAssets.form.namePlaceholder")} autoComplete="off" />
                    </Form.Item>
                </Form>
            </Modal>

            <Drawer open={Boolean(previewAsset)} width={480} title={t("volcengineAssets.detail.title")} onClose={() => setPreview(null)}>
                {previewAsset ? (
                    <div className="space-y-5">
                        <div className="overflow-hidden rounded-xl border bg-muted/35">
                            <AssetPreview asset={previewAsset} className="aspect-[4/3]" t={t} />
                        </div>
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <Typography.Title level={4} className="!mb-1 break-words">
                                        {previewAsset.Name || t("volcengineAssets.fallbacks.unnamed")}
                                    </Typography.Title>
                                    <Typography.Text type="secondary">{assetTypeLabel(previewAsset.AssetType, t)}</Typography.Text>
                                </div>
                                <Tag color={statusColor(previewAsset.Status)} className="m-0">
                                    {previewAsset.Status || t("volcengineAssets.fallbacks.unknownStatus")}
                                </Tag>
                            </div>
                            {assetError(previewAsset) ? <Alert type="error" showIcon message={assetError(previewAsset)} /> : null}
                            {detailQuery.isError ? <Alert type="warning" showIcon message={errorMessage(detailQuery.error, t("volcengineAssets.detail.loadFailed"))} /> : null}
                        </div>
                        <div className="rounded-xl border p-4">
                            <Typography.Text type="secondary" className="block text-xs">
                                {t("volcengineAssets.detail.mediaURL")}
                            </Typography.Text>
                            <div className="mt-2 flex items-start justify-between gap-3">
                                <Typography.Text className="min-w-0 break-all text-sm">{previewAsset.URL}</Typography.Text>
                                {isSafeMediaURL(previewAsset.URL) ? (
                                    <Button type="link" size="small" icon={<ExternalLink className="size-3.5" />} href={previewAsset.URL} target="_blank" rel="noreferrer">
                                        {t("volcengineAssets.actions.open")}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <InfoItem label={t("volcengineAssets.detail.assetID")} value={previewAsset.Id} t={t} />
                            <InfoItem label={t("volcengineAssets.detail.groupID")} value={previewAsset.GroupId} t={t} />
                            <InfoItem label={t("volcengineAssets.detail.project")} value={previewAsset.ProjectName} t={t} />
                            <InfoItem label={t("volcengineAssets.detail.createdAt")} value={previewAsset.CreateTime} t={t} />
                            <InfoItem label={t("volcengineAssets.detail.updatedAt")} value={previewAsset.UpdateTime} t={t} />
                        </div>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function VolcengineAssetCard({
    asset,
    disabled,
    deleting,
    onPreview,
    onEdit,
    onDelete,
    t,
}: {
    asset: VolcengineAsset;
    disabled: boolean;
    deleting: boolean;
    onPreview: (asset: VolcengineAsset) => void;
    onEdit: (asset: VolcengineAsset) => void;
    onDelete: (asset: VolcengineAsset) => Promise<unknown>;
    t: (key: string, options?: Record<string, unknown>) => string;
}) {
    const error = assetError(asset);
    return (
        <Card hoverable className="h-full overflow-hidden" styles={{ body: { padding: 0 } }}>
            <div className="border-b bg-muted/30">
                <AssetPreview asset={asset} className="aspect-[4/3]" t={t} />
            </div>
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => onPreview(asset)}>
                        <h2 className="line-clamp-1 text-sm font-semibold text-foreground">{asset.Name || t("volcengineAssets.fallbacks.unnamed")}</h2>
                        <span className="mt-1 block text-xs text-muted-foreground">{assetTypeLabel(asset.AssetType, t)}</span>
                    </button>
                    <Tag color={statusColor(asset.Status)} className="m-0 shrink-0 text-[11px]">
                        {asset.Status || t("volcengineAssets.fallbacks.unknownStatus")}
                    </Tag>
                </div>
                {error ? (
                    <div className="mt-3 flex gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive">
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                        {error}
                    </div>
                ) : null}
                <div className="mt-4 flex items-center gap-2">
                    <Button size="small" onClick={() => onPreview(asset)}>
                        {t("volcengineAssets.actions.view")}
                    </Button>
                    <Button size="small" icon={<PencilLine className="size-3.5" />} disabled={disabled} onClick={() => onEdit(asset)}>
                        {t("volcengineAssets.actions.rename")}
                    </Button>
                    <Popconfirm
                        title={t("volcengineAssets.delete.title")}
                        description={t("volcengineAssets.delete.description")}
                        okText={t("volcengineAssets.actions.delete")}
                        cancelText={t("volcengineAssets.actions.cancel")}
                        okButtonProps={{ danger: true, loading: deleting }}
                        onConfirm={() => onDelete(asset)}
                    >
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={disabled && !deleting} loading={deleting}>
                            {t("volcengineAssets.actions.delete")}
                        </Button>
                    </Popconfirm>
                </div>
            </div>
        </Card>
    );
}

function AssetPreview({ asset, className, t }: { asset: VolcengineAsset; className: string; t: (key: string) => string }) {
    const [failed, setFailed] = useState(false);
    const mediaURL = isSafeMediaURL(asset.URL) ? asset.URL : "";

    if (mediaURL && asset.AssetType === "Image" && !failed) {
        return <img src={mediaURL} alt={asset.Name || t("volcengineAssets.preview.alt")} className={`${className} w-full object-contain`} loading="lazy" onError={() => setFailed(true)} />;
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
            <span>{failed ? t("volcengineAssets.preview.failed") : t("volcengineAssets.preview.unavailable")}</span>
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

function InfoItem({ label, value, t }: { label: string; value: string; t: (key: string) => string }) {
    return (
        <div className="min-w-0 rounded-lg border p-3">
            <Typography.Text type="secondary" className="block text-xs">
                {label}
            </Typography.Text>
            <Typography.Text className="mt-1 block break-all text-xs">{value || t("volcengineAssets.fallbacks.emptyValue")}</Typography.Text>
        </div>
    );
}

function assetTypeLabel(type: VolcengineAssetType, t: (key: string) => string) {
    return t(`volcengineAssets.types.${type.toLowerCase()}`);
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

function validateMediaURL(_: unknown, value: string, t: (key: string) => string) {
    const urls = mediaURLs(value || "");
    return !value || (urls.length > 0 && urls.every(isSafeMediaURL)) ? Promise.resolve() : Promise.reject(new Error(t("volcengineAssets.form.urlInvalid")));
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
