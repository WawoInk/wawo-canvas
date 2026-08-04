"use client";

import { Download, FolderPlus, PencilLine, Plus, Search, Trash2, Upload as UploadIcon } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm, Result, Select, Skeleton, Space, Tag, Typography, Upload, type UploadFile } from "antd";

import i18n from "@/i18n";
import { formatDateTime, formatNumber } from "@/i18n/formatters";
import { useCopyText } from "@/hooks/use-copy-text";
import { enterpriseCapabilities } from "@/lib/account-access";
import { formatBytes } from "@/lib/image-utils";
import { fetchEnterpriseAccountSummary } from "@/services/api/auth";
import {
    createEnterpriseAsset,
    copyEnterpriseAsset,
    deleteEnterpriseAsset,
    deleteEnterpriseFile,
    downloadEnterpriseFile,
    fetchEnterpriseAssets,
    replaceEnterpriseFile,
    updateEnterpriseAsset,
    uploadEnterpriseFile,
    type EnterpriseAsset,
    type EnterpriseAssetType,
} from "@/services/api/enterprise-assets";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { buildEnterpriseAssetInput, type EnterpriseAssetFormDraft, type EnterpriseAssetMedia } from "./enterprise-asset-form";
import { defaultEnterpriseAssetQuery, enterpriseAssetQueryKey, updateEnterpriseAssetQuery, type EnterpriseAssetQuery } from "./enterprise-asset-query";

type AssetFormValues = EnterpriseAssetFormDraft & { file?: UploadFile[] };

export default function EnterpriseAssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const refreshPersonalAssets = useAssetStore((state) => state.refreshFromServer);
    const capabilities = enterpriseCapabilities(user);
    const [query, setQuery] = useState<EnterpriseAssetQuery>(defaultEnterpriseAssetQuery);
    const [keyword, setKeyword] = useState("");
    const [preview, setPreview] = useState<EnterpriseAsset | null>(null);
    const [editing, setEditing] = useState<EnterpriseAsset | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm<AssetFormValues>();
    const formType = Form.useWatch("type", form) || "text";
    const assetTypeLabels: Record<EnterpriseAssetType, string> = {
        text: t("common.assetTypes.text"),
        image: t("common.assetTypes.image"),
        video: t("common.assetTypes.video"),
    };

    useEffect(() => {
        setQuery(defaultEnterpriseAssetQuery);
        setKeyword("");
        setPreview(null);
        setEditing(null);
        setFormOpen(false);
        form.resetFields();
    }, [form, user?.enterpriseId, user?.id]);

    const summaryQuery = useQuery({
        queryKey: ["enterprise-summary", user?.id || "", user?.enterpriseId || ""],
        queryFn: () => fetchEnterpriseAccountSummary(token),
        enabled: Boolean(token && user?.id),
        retry: false,
    });
    const enterpriseID = summaryQuery.data?.id || "";
    const assetsQuery = useQuery({
        queryKey: enterpriseAssetQueryKey(user?.id || "", enterpriseID, query),
        queryFn: () => fetchEnterpriseAssets(token, query),
        enabled: Boolean(token && user?.id && enterpriseID),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: async ({ asset, values }: { asset: EnterpriseAsset | null; values: AssetFormValues }) => {
            const file = values.file?.[0]?.originFileObj as File | undefined;
            let media = asset && asset.type !== "text" ? enterpriseAssetMedia(asset) : undefined;
            let newFileID = "";
            if (values.type !== "text" && file) {
                const size = await readMediaSize(file, values.type);
                const uploaded = asset?.fileId ? await replaceEnterpriseFile(token, asset.fileId, values.type === "image" ? "images" : "videos", file) : await uploadEnterpriseFile(token, values.type === "image" ? "images" : "videos", file);
                media = { ...uploaded, ...size };
                if (!asset?.fileId) newFileID = uploaded.id;
            }
            const input = buildEnterpriseAssetInput(values, media);
            try {
                return asset ? await updateEnterpriseAsset(token, asset.id, input) : await createEnterpriseAsset(token, input);
            } catch (error) {
                if (newFileID) await deleteEnterpriseFile(token, newFileID).catch(() => undefined);
                throw error;
            }
        },
        onSuccess: async (asset, variables) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            setFormOpen(false);
            setEditing(null);
            form.resetFields();
            if (preview?.id === asset.id) setPreview(asset);
            message.success(variables.asset ? t("enterpriseAssets.messages.saved") : t("enterpriseAssets.messages.created"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("enterpriseAssets.messages.saveFailed")),
    });
    const deleteMutation = useMutation({
        mutationFn: (asset: EnterpriseAsset) => deleteEnterpriseAsset(token, asset.id),
        onSuccess: async (_, asset) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            if (preview?.id === asset.id) setPreview(null);
            message.success(t("enterpriseAssets.messages.deleted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("enterpriseAssets.messages.deleteFailed")),
    });
    const copyMutation = useMutation({
        mutationFn: (asset: EnterpriseAsset) => copyEnterpriseAsset(token, asset.id),
        onSuccess: async (_, asset) => {
            await refreshPersonalAssets();
            message.success(t("enterpriseAssets.messages.copiedToPersonal", { title: asset.title }));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("enterpriseAssets.messages.copyFailed")),
    });
    const downloadMutation = useMutation({
        mutationFn: async (asset: EnterpriseAsset) => {
            if (!asset.fileId) throw new Error(t("enterpriseAssets.errors.noDownloadFile"));
            saveAs(await downloadEnterpriseFile(token, asset.fileId), assetFileName(asset));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("enterpriseAssets.messages.downloadFailed")),
    });

    const openForm = (asset?: EnterpriseAsset) => {
        setEditing(asset || null);
        form.resetFields();
        form.setFieldsValue(asset ? { type: asset.type, title: asset.title, tags: asset.tags, description: asset.description, content: asset.content, file: [] } : { type: "text", title: "", tags: [], description: "", content: "", file: [] });
        setFormOpen(true);
    };
    const updateQuery = (patch: Partial<EnterpriseAssetQuery>) => setQuery((current) => updateEnterpriseAssetQuery(current, patch));
    const error = summaryQuery.error || assetsQuery.error;

    if (summaryQuery.isLoading) {
        return (
            <main className="h-full overflow-auto bg-background text-foreground">
                <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                    <Skeleton active paragraph={{ rows: 8 }} />
                </div>
            </main>
        );
    }
    if (summaryQuery.isError || !capabilities.canAccessAssets) {
        return <Result status="403" title={t("enterpriseAssets.access.denied")} subTitle={error instanceof Error ? error.message : t("enterpriseAssets.access.invalidAccount")} />;
    }

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="text-xs text-muted-foreground">{summaryQuery.data?.name}</p>
                        <h1 className="mt-2 text-3xl font-semibold">{t("enterpriseAssets.header.title")}</h1>
                        <p className="mt-2 text-sm text-muted-foreground">{t("enterpriseAssets.header.description")}</p>
                    </div>
                    {capabilities.canManageAssets ? (
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openForm()}>
                            {t("enterpriseAssets.actions.create")}
                        </Button>
                    ) : (
                        <Tag color="blue">{t("enterpriseAssets.header.readOnly")}</Tag>
                    )}
                </header>

                <section className="flex flex-wrap items-center gap-3">
                    <Input.Search
                        className="w-full sm:w-72"
                        prefix={<Search className="size-4 text-muted-foreground" />}
                        placeholder={t("enterpriseAssets.searchPlaceholder")}
                        value={keyword}
                        allowClear
                        enterButton={t("common.actions.search")}
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={(value) => updateQuery({ keyword: value.trim() })}
                    />
                    <Select
                        className="w-32"
                        value={query.type || "all"}
                        options={[
                            { label: t("enterpriseAssets.filters.allTypes"), value: "all" },
                            { label: t("common.assetTypes.text"), value: "text" },
                            { label: t("common.assetTypes.image"), value: "image" },
                            { label: t("common.assetTypes.video"), value: "video" },
                        ]}
                        onChange={(type) => updateQuery({ type: type === "all" ? "" : type, tag: [] })}
                    />
                    <Select
                        className="min-w-48 flex-1 sm:max-w-80"
                        mode="multiple"
                        placeholder={t("enterpriseAssets.filters.tagsPlaceholder")}
                        value={query.tag}
                        options={(assetsQuery.data?.tags || []).map((tag) => ({ label: tag, value: tag }))}
                        allowClear
                        onChange={(tag) => updateQuery({ tag })}
                    />
                </section>

                {assetsQuery.isError ? (
                    <Result
                        status="error"
                        title={t("enterpriseAssets.load.errorTitle")}
                        subTitle={error instanceof Error ? error.message : t("enterpriseAssets.load.retryHint")}
                        extra={<Button onClick={() => assetsQuery.refetch()}>{t("common.actions.reload")}</Button>}
                    />
                ) : assetsQuery.isLoading ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 6 }, (_, index) => (
                            <Card key={index}>
                                <Skeleton active paragraph={{ rows: 4 }} />
                            </Card>
                        ))}
                    </div>
                ) : assetsQuery.data?.items.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {assetsQuery.data.items.map((asset) => (
                            <Card key={asset.id} className="h-full overflow-hidden" styles={{ body: { height: "100%" } }}>
                                <div className="flex h-full min-h-56 flex-col">
                                    {asset.type === "image" && asset.url ? <img src={asset.url} alt={asset.title} className="mb-4 aspect-video w-full rounded-lg bg-muted object-contain" /> : null}
                                    {asset.type === "video" && asset.url ? <video src={asset.url} className="mb-4 aspect-video w-full rounded-lg bg-muted object-contain" controls preload="metadata" /> : null}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <Typography.Title level={4} className="!mb-1 line-clamp-1">
                                                {asset.title}
                                            </Typography.Title>
                                            <Typography.Text type="secondary" className="text-xs">
                                                {t("enterpriseAssets.card.createdBy", { name: asset.creatorName || t("enterpriseAssets.defaultCreator") })}
                                            </Typography.Text>
                                        </div>
                                        <Tag className="m-0 shrink-0">{assetTypeLabels[asset.type]}</Tag>
                                    </div>
                                    <Typography.Paragraph type="secondary" className="!my-4 line-clamp-4 whitespace-pre-wrap">
                                        {asset.description || (asset.type === "text" ? asset.content : formatBytes(asset.bytes))}
                                    </Typography.Paragraph>
                                    <div className="mt-auto flex flex-wrap gap-1">
                                        {asset.tags?.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                                        <span>{formatDateTime(asset.updatedAt)}</span>
                                        <Space size={4}>
                                            <Button type="link" size="small" onClick={() => setPreview(asset)}>
                                                {t("common.actions.view")}
                                            </Button>
                                            <Button type="link" size="small" icon={<FolderPlus className="size-4" />} loading={copyMutation.isPending && copyMutation.variables?.id === asset.id} onClick={() => copyMutation.mutate(asset)}>
                                                {t("common.actions.addToMyAssets")}
                                            </Button>
                                            {asset.type !== "text" ? (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<Download className="size-4" />}
                                                    loading={downloadMutation.isPending && downloadMutation.variables?.id === asset.id}
                                                    onClick={() => downloadMutation.mutate(asset)}
                                                    aria-label={t("enterpriseAssets.aria.download", { title: asset.title })}
                                                />
                                            ) : null}
                                            {capabilities.canManageAssets ? (
                                                <>
                                                    <Button type="text" size="small" icon={<PencilLine className="size-4" />} onClick={() => openForm(asset)} aria-label={t("enterpriseAssets.aria.edit", { title: asset.title })} />
                                                    <Popconfirm
                                                        title={t("enterpriseAssets.delete.title")}
                                                        description={t("enterpriseAssets.delete.description")}
                                                        okText={t("common.actions.delete")}
                                                        cancelText={t("common.actions.cancel")}
                                                        onConfirm={() => deleteMutation.mutate(asset)}
                                                    >
                                                        <Button type="text" danger size="small" icon={<Trash2 className="size-4" />} aria-label={t("enterpriseAssets.aria.delete", { title: asset.title })} />
                                                    </Popconfirm>
                                                </>
                                            ) : null}
                                        </Space>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="flex min-h-80 items-center justify-center border-y border-border">
                        <Empty description={t("enterpriseAssets.empty")} />
                    </div>
                )}

                {(assetsQuery.data?.total || 0) > 0 ? (
                    <div className="flex justify-center">
                        <Pagination
                            current={query.page}
                            pageSize={query.pageSize}
                            total={assetsQuery.data?.total || 0}
                            showSizeChanger
                            pageSizeOptions={[12, 24, 48]}
                            onChange={(page, pageSize) => updateQuery(pageSize === query.pageSize ? { page } : { pageSize })}
                        />
                    </div>
                ) : null}

                <Modal
                    title={editing ? t("enterpriseAssets.form.editTitle") : t("enterpriseAssets.form.createTitle")}
                    open={formOpen}
                    confirmLoading={saveMutation.isPending}
                    okText={t("common.actions.save")}
                    cancelText={t("common.actions.cancel")}
                    destroyOnHidden
                    onCancel={() => setFormOpen(false)}
                    onOk={() => form.submit()}
                >
                    <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate({ asset: editing, values })}>
                        <Form.Item name="type" label={t("common.fields.type")} rules={[{ required: true, message: t("enterpriseAssets.form.validation.typeRequired") }]}>
                            <Select
                                disabled={Boolean(editing)}
                                options={[
                                    { label: t("common.assetTypes.text"), value: "text" },
                                    { label: t("common.assetTypes.image"), value: "image" },
                                    { label: t("common.assetTypes.video"), value: "video" },
                                ]}
                                onChange={() => form.setFieldValue("file", [])}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("common.fields.title")} rules={[{ required: true, whitespace: true, message: t("enterpriseAssets.form.validation.titleRequired") }]}>
                            <Input maxLength={100} showCount />
                        </Form.Item>
                        <Form.Item name="tags" label={t("common.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("enterpriseAssets.form.tagsPlaceholder")} />
                        </Form.Item>
                        <Form.Item name="description" label={t("enterpriseAssets.form.fields.description")}>
                            <Input.TextArea rows={2} maxLength={300} showCount />
                        </Form.Item>
                        {formType === "text" ? (
                            <Form.Item name="content" label={t("enterpriseAssets.form.fields.textContent")} rules={[{ required: true, whitespace: true, message: t("enterpriseAssets.form.validation.contentRequired") }]}>
                                <Input.TextArea rows={10} />
                            </Form.Item>
                        ) : (
                            <Form.Item
                                name="file"
                                label={editing ? t("enterpriseAssets.form.fields.replacementFile") : t("enterpriseAssets.form.fields.mediaFile")}
                                valuePropName="fileList"
                                getValueFromEvent={(event) => (Array.isArray(event) ? event : event?.fileList)}
                                rules={editing ? [] : [{ required: true, message: t("enterpriseAssets.form.validation.fileRequired", { type: assetTypeLabels[formType] }) }]}
                                extra={editing ? t("enterpriseAssets.form.replacementHint") : undefined}
                            >
                                <Upload accept={formType === "image" ? "image/*" : "video/*"} beforeUpload={() => false} maxCount={1}>
                                    <Button icon={<UploadIcon className="size-4" />}>{editing ? t("enterpriseAssets.actions.selectReplacement") : t("enterpriseAssets.actions.selectFile")}</Button>
                                </Upload>
                            </Form.Item>
                        )}
                    </Form>
                </Modal>

                <Modal
                    title={preview?.title || t("enterpriseAssets.preview.defaultTitle")}
                    open={Boolean(preview)}
                    footer={
                        <Space>
                            {preview?.type === "text" ? (
                                <Button type="primary" onClick={() => copyText(preview.content, t("enterpriseAssets.messages.contentCopied"))}>
                                    {t("enterpriseAssets.actions.copyContent")}
                                </Button>
                            ) : (
                                <Button type="primary" icon={<Download className="size-4" />} loading={downloadMutation.isPending && downloadMutation.variables?.id === preview?.id} onClick={() => preview && downloadMutation.mutate(preview)}>
                                    {t("enterpriseAssets.actions.downloadFile")}
                                </Button>
                            )}
                            <Button icon={<FolderPlus className="size-4" />} loading={copyMutation.isPending && copyMutation.variables?.id === preview?.id} onClick={() => preview && copyMutation.mutate(preview)}>
                                {t("common.actions.addToMyAssets")}
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                    onCancel={() => setPreview(null)}
                >
                    {preview ? (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-1">
                                {preview.tags?.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                            {preview.description ? <Typography.Paragraph type="secondary">{preview.description}</Typography.Paragraph> : null}
                            {preview.type === "text" ? <Typography.Paragraph className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-4">{preview.content}</Typography.Paragraph> : null}
                            {preview.type === "image" && preview.url ? <img src={preview.url} alt={preview.title} className="max-h-[55vh] w-full rounded-lg bg-muted object-contain" /> : null}
                            {preview.type === "video" && preview.url ? <video src={preview.url} className="max-h-[55vh] w-full rounded-lg bg-muted" controls autoPlay /> : null}
                            {preview.type !== "text" ? (
                                <Typography.Text type="secondary">
                                    {[preview.width && preview.height ? `${formatNumber(preview.width, { useGrouping: false })} × ${formatNumber(preview.height, { useGrouping: false })}` : "", formatBytes(preview.bytes), preview.mimeType]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </Typography.Text>
                            ) : null}
                            <Typography.Text type="secondary" className="block text-xs">
                                {t("enterpriseAssets.preview.metadata", { creator: preview.creatorName || t("enterpriseAssets.defaultCreator"), updatedAt: formatDateTime(preview.updatedAt) })}
                            </Typography.Text>
                        </div>
                    ) : null}
                </Modal>
            </div>
        </main>
    );
}

function enterpriseAssetMedia(asset: EnterpriseAsset): EnterpriseAssetMedia {
    return { id: asset.fileId, width: asset.width, height: asset.height, bytes: asset.bytes, mimeType: asset.mimeType };
}

async function readMediaSize(file: File, type: Exclude<EnterpriseAssetType, "text">) {
    if (type === "image") {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    }
    const url = URL.createObjectURL(file);
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const video = document.createElement("video");
        const done = (error?: Error) => {
            URL.revokeObjectURL(url);
            error ? reject(error) : resolve({ width: video.videoWidth, height: video.videoHeight });
        };
        video.onloadedmetadata = () => done();
        video.onerror = () => done(new Error(i18n.t("enterpriseAssets.errors.readVideoMetadata")));
        video.preload = "metadata";
        video.src = url;
    });
}

function assetFileName(asset: EnterpriseAsset) {
    const extension = asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType.split("/")[1]?.split("+")[0] || (asset.type === "image" ? "png" : "mp4");
    return asset.title.toLowerCase().endsWith(`.${extension}`) ? asset.title : `${asset.title}.${extension}`;
}
