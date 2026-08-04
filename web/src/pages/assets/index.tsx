"use client";

import { Copy, Download, PencilLine, Play, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { App, Button, Card, Drawer, Empty, Form, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";

import { LazyImage, LazyVideo } from "@/components/lazy-media";
import { formatNumber } from "@/i18n/formatters";
import { getVideoPoster } from "@/lib/video-poster";

import { useCopyText } from "@/hooks/use-copy-text";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { uploadBlob } from "@/services/upload-blob";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = (ImageAsset["data"] | VideoAsset["data"]) | null;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const isAuthReady = useAuthReady();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const hydrated = useAssetStore((state) => state.hydrated);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const removeAssetWithFile = useAssetStore((state) => state.removeAssetWithFile);
    const refreshAssetUrls = useAssetStore((state) => state.refreshAssetUrls);
    const refreshFromServer = useAssetStore((state) => state.refreshFromServer);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);
    const kindOptions = [
        { label: t("common.all"), value: "all" },
        { label: t("common.assetTypes.text"), value: "text" },
        { label: t("common.assetTypes.image"), value: "image" },
        { label: t("common.assetTypes.video"), value: "video" },
    ];

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    // Refresh presigned URLs for all S3-backed assets on mount (after IndexedDB rehydration)
    useEffect(() => {
        if (!hydrated) return;
        const fileIds = assets.filter((a): a is Asset & { data: ImageAsset["data"] | VideoAsset["data"] } => (a.kind === "image" || a.kind === "video") && Boolean(a.data.fileId)).map((a) => a.data.fileId!);
        if (fileIds.length) void refreshAssetUrls(fileIds);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated]);

    // ponytail: 进入"我的素材"页面时直接从 PostgreSQL 拉取最新列表，
    // 不依赖 sync 机制（sync 在 userId 就绪前静默跳过，导致新设备无数据）。
    // sync 仍用于后台增量更新，本调用覆盖首次加载和跨设备场景。
    // Guard on isAuthReady to prevent silent skip when token isn't ready on first paint.
    useEffect(() => {
        if (isAuthReady) void refreshFromServer();
    }, [isAuthReady, refreshFromServer]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.form.defaultSource"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" || asset.kind === "video" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind !== "text" && imageDraft ? ((imageDraft as Record<string, unknown>).dataUrl as string) || ((imageDraft as Record<string, unknown>).url as string) || "" : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        try {
            if (values.kind === "text") {
                const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
                if (editingAsset) await updateAsset(editingAsset.id, asset as Parameters<typeof updateAsset>[1]);
                else await addAsset(asset);
            } else if (values.kind === "video") {
                if (!imageDraft) {
                    message.error(t("assets.messages.videoRequired"));
                    return;
                }
                const asset = { ...base, kind: "video" as const, data: imageDraft as VideoAsset["data"] };
                if (editingAsset) await updateAsset(editingAsset.id, asset as Parameters<typeof updateAsset>[1]);
                else await addAsset(asset);
            } else {
                if (!imageDraft) {
                    message.error(t("assets.messages.imageRequired"));
                    return;
                }
                const asset = { ...base, kind: "image" as const, data: imageDraft as ImageAsset["data"] };
                if (editingAsset) await updateAsset(editingAsset.id, asset as Parameters<typeof updateAsset>[1]);
                else await addAsset(asset);
            }
            message.success(editingAsset ? t("assets.messages.updated") : t("assets.messages.saved"));
            setIsAssetOpen(false);
        } catch {
            message.error(editingAsset ? t("assets.messages.updateFailed") : t("assets.messages.saveFailed"));
        }
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        try {
            // ponytail: server-side upload via POST /api/v1/files avoids S3 CORS
            const result = await uploadBlob(file, "images");
            setImageDraft({ dataUrl: result.url, fileId: result.fileId, width: result.width, height: result.height, bytes: result.bytes, mimeType: result.mimeType });
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", result.url);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch {
            message.error(t("assets.messages.imageUploadFailed"));
        }
    };

    const readVideoFile = async (file?: File) => {
        if (!file || !file.type.startsWith("video/")) return;
        try {
            const result = await uploadBlob(file, "videos");
            const draft: VideoAsset["data"] = {
                url: result.url,
                fileId: result.fileId,
                width: result.width || 1280,
                height: result.height || 720,
                bytes: result.bytes,
                mimeType: result.mimeType || file.type || "video/mp4",
            };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", result.url);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch {
            message.error(t("assets.messages.videoUploadFailed"));
        }
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.messages.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        // Refresh presigned URL before download if the asset has a fileId
        if (asset.data.fileId) {
            await refreshAssetUrls([asset.data.fileId]);
            const updated = useAssetStore.getState().assets.find((a) => a.id === asset.id);
            if (updated) {
                if (updated.kind === "video") {
                    saveAs(updated.data.url, `${updated.title || t("assets.download.defaultFileName")}.${updated.data.mimeType.split("/")[1] || "mp4"}`);
                    return;
                }
                if (updated.kind === "image") {
                    saveAs(updated.data.dataUrl, `${updated.title || t("assets.download.defaultFileName")}.${updated.data.mimeType.split("/")[1] || "png"}`);
                    return;
                }
            }
        }
        saveAs(asset.kind === "video" ? asset.data.url : asset.data.dataUrl, `${asset.title || t("assets.download.defaultFileName")}.${asset.data.mimeType.split("/")[1] || "png"}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.messages.nothingToExport"));
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            let imported = 0;
            for (const asset of importedAssets) {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                try {
                    await addAsset(payload as Parameters<typeof addAsset>[0]);
                    imported++;
                } catch {
                    /* 单条导入失败不中断批量 */
                }
            }
            if (imported > 0) message.success(t("assets.messages.importSuccess", { count: imported, value: formatNumber(imported) }));
            else message.error(t("assets.messages.invalidPackage"));
        } catch {
            message.error(t("assets.messages.invalidPackage"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        // @ts-expect-error -- fileId only exists on image/video data, guarded below
        const fileId = deletingAsset.data?.fileId;
        try {
            if (fileId) {
                await removeAssetWithFile(deletingAsset.id, fileId);
            } else {
                await removeAsset(deletingAsset.id);
            }
            message.success(t("assets.messages.deleted"));
        } catch {
            message.error(t("assets.messages.deleteFailed"));
        }
        setDeletingAsset(null);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-foreground">{t("assets.header.title")}</h1>
                        <p className="mt-3 text-sm text-muted-foreground">{t("assets.header.description")}</p>
                    </div>

                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input.Search
                            className="w-full"
                            size="large"
                            allowClear
                            prefix={<Search className="size-4 text-muted-foreground" />}
                            value={keyword}
                            placeholder={t("assets.searchPlaceholder")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value);
                            }}
                        />
                    </div>

                    <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                                <div className="text-xs font-medium text-muted-foreground">{t("common.fields.type")}</div>
                                <div className="flex flex-wrap gap-2">
                                    {kindOptions.map((option) => (
                                        <Tag.CheckableTag
                                            key={option.value}
                                            checked={kindFilter === option.value}
                                            className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")}
                                            onChange={() => {
                                                setPage(1);
                                                setKindFilter(option.value as AssetKind | "all");
                                            }}
                                        >
                                            {option.label}
                                        </Tag.CheckableTag>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <button type="button" className="cursor-pointer text-sm font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline" onClick={() => void exportAllAssets()}>
                                    {t("assets.actions.export")}
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
                                    onClick={() => assetInputRef.current?.click()}
                                >
                                    {t("assets.actions.import")}
                                </button>
                                <button type="button" className="cursor-pointer text-sm font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline" onClick={openCreate}>
                                    {t("assets.actions.create")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                        ))}
                    </div>

                    {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                    <div className="flex justify-center">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[10, 20, 50, 100]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </div>
            </main>

            <Modal
                title={editingAsset ? t("assets.form.editTitle") : t("assets.form.createTitle")}
                open={isAssetOpen}
                width={980}
                onCancel={() => setIsAssetOpen(false)}
                onOk={() => void saveAsset()}
                okText={t("common.actions.save")}
                cancelText={t("common.actions.cancel")}
                destroyOnHidden
            >
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("common.fields.type")}>
                            <Select
                                options={[
                                    { label: t("common.assetTypes.text"), value: "text" },
                                    { label: t("common.assetTypes.image"), value: "image" },
                                    { label: t("common.assetTypes.video"), value: "video" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("common.fields.title")} rules={[{ required: true, message: t("assets.form.validation.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.form.placeholders.title")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.form.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.form.placeholders.coverUrl")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.actions.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("common.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.form.placeholders.tags")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("common.fields.source")}>
                                <Input placeholder={t("assets.form.placeholders.source")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("common.fields.note")}>
                                <Input placeholder={t("common.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.form.fields.textContent")} rules={[{ required: true, message: t("assets.form.validation.contentRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.form.placeholders.content")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={formKind === "video" ? t("assets.form.fields.videoFile") : t("assets.form.fields.imageFile")} required>
                                <div className="rounded-lg border border-dashed p-4">
                                    {formKind === "video" ? (
                                        <Button icon={<Upload className="size-4" />} onClick={() => videoInputRef.current?.click()}>
                                            {t("assets.actions.selectVideo")}
                                        </Button>
                                    ) : (
                                        <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                            {t("assets.actions.selectImage")}
                                        </Button>
                                    )}
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {`${formatDimensions(imageDraft.width, imageDraft.height)} · ${formatBytes(imageDraft.bytes)}`}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.preview.noFile")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border bg-card p-4">
                        <Typography.Text strong>{t("assets.preview.title")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border bg-background">
                            {coverUrl || (imageDraft && ("dataUrl" in imageDraft ? imageDraft.dataUrl : imageDraft.url)) ? (
                                formKind === "video" && imageDraft && "url" in imageDraft && !coverUrl ? (
                                    <LazyVideo src={imageDraft.url} className="aspect-[4/3] w-full" />
                                ) : (
                                    <LazyImage src={coverUrl || (imageDraft && ("dataUrl" in imageDraft ? imageDraft.dataUrl : imageDraft.url)) || ""} alt="" className="aspect-[4/3] w-full" />
                                )
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-muted p-5 text-center text-sm text-muted-foreground">{content || t("common.states.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.preview.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.preview.noTags")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(event) => {
                        void readVideoFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.delete.title")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.actions.delete")} okButtonProps={{ danger: true }} cancelText={t("common.actions.cancel")}>
                {t("assets.delete.description", { title: deletingAsset?.title })}
            </Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [poster, setPoster] = useState("");
    useEffect(() => {
        if (asset.kind === "video" && asset.data.url && !poster) {
            getVideoPoster(asset.data.url)
                .then(setPoster)
                .catch(() => {});
        }
        // @ts-expect-error -- asset.data.url only exists on VideoAsset; dependency is safe since kind guards usage
    }, [asset.kind, asset.data.url]);
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => {
                        if (asset.kind !== "video") onOpen();
                    }}
                >
                    {asset.kind === "video" && !videoPlaying ? (
                        <div className="relative aspect-[4/3] w-full bg-black" onClick={() => setVideoPlaying(true)}>
                            {poster ? <img src={poster} alt="" className="size-full object-cover opacity-80" /> : <div className="flex size-full items-center justify-center bg-muted" />}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="flex size-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80">
                                    <Play className="size-5 fill-white" />
                                </div>
                            </div>
                        </div>
                    ) : asset.kind === "video" && videoPlaying ? (
                        <video src={asset.data.url} controls autoPlay className="aspect-[4/3] w-full bg-black object-contain" preload="metadata" onClick={(e) => e.stopPropagation()} />
                    ) : cover ? (
                        <LazyImage src={cover} alt={asset.title} className="aspect-[4/3] w-full" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted p-5 text-center text-sm leading-6 text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("common.states.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-foreground">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("assets.card.unknownSource")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`common.assetTypes.${asset.kind}`)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {summary}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[11px]">{t("common.states.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    {t("common.actions.view")}
                </Button>
                {asset.kind !== "video" ? (
                    <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.actions.edit")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.actions.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.actions.download")}
                    </Button>
                ) : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("common.actions.delete")}
                </Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details.title")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {asset.kind === "video" ? null : cover ? (
                        <div className="aspect-[4/3] w-full">
                            <LazyImage src={cover} alt={asset.title} className="size-full" />
                        </div>
                    ) : (
                        <div className="rounded-lg border bg-card p-5 text-sm leading-6 text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("common.states.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`common.assetTypes.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border p-4">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("common.fields.content")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <LazyVideo src={asset.data.url} className="aspect-video w-full rounded-lg" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {formatDimensions(asset.data.width, asset.data.height)} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("common.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.actions.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.actions.downloadVideo") : t("assets.actions.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${formatDimensions(asset.data.width, asset.data.height)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function formatDimensions(width: number, height: number) {
    const options: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };
    return `${formatNumber(width, options)} × ${formatNumber(height, options)}`;
}
