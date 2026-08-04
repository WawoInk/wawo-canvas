"use client";

import { Copy, FolderPlus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Empty, Image, Input, Pagination, Spin, Tag, Typography } from "antd";
import axios from "axios";

import i18n from "@/i18n";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useAssetStore } from "@/stores/use-asset-store";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { uploadImage } from "@/services/blob-storage";

const PAGE_SIZE = 12;

export default function AssetLibraryPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const isAuthReady = useAuthReady();
    const [keyword, setKeyword] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [selectedAsset, setSelectedAsset] = useState<AssetLibraryItem | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);

    const query = useQuery({
        queryKey: ["asset-library", keyword, selectedType, selectedTags, page],
        queryFn: () => fetchAssetLibrary({ keyword, type: selectedType, tag: selectedTags, page, pageSize: PAGE_SIZE }),
        enabled: isAuthReady,
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : t("assetLibrary.errors.fetch"));
        }
    }, [message, query.error, query.isError, t]);

    const isReady = query.isFetched || query.isError;
    const items = query.data?.items || [];
    const availableTags = query.data?.tags || [];
    const total = query.data?.total || 0;

    const toggleTag = (tag: string) => {
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const saveToMyAssets = async (asset: AssetLibraryItem) => {
        try {
            if (asset.type === "image") {
                const dataUrl = await remoteImageToDataUrl(asset.url);
                const image = await uploadImage(dataUrl);
                addAsset({
                    kind: "image",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else {
                addAsset({
                    kind: "text",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    source: asset.category,
                    note: asset.description,
                    data: { content: asset.content },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            }
            message.success(t("assetLibrary.messages.added"));
        } catch {
            message.error(t("assetLibrary.messages.addFailed"));
        }
    };

    if (!isReady) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spin />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-muted-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-foreground">{t("assetLibrary.header.title")}</h1>
                        <p className="mt-3 text-sm text-muted-foreground">{t("assetLibrary.header.description")}</p>
                    </div>
                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input
                            size="large"
                            className="w-full"
                            prefix={<Search className="size-4 text-muted-foreground" />}
                            value={keyword}
                            placeholder={t("assetLibrary.searchPlaceholder")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                        />
                    </div>
                    <div className="mx-auto mt-6 max-w-6xl space-y-3">
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">{t("common.fields.type")}</div>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { label: t("common.all"), value: "" },
                                    { label: t("common.assetTypes.text"), value: "text" },
                                    { label: t("common.assetTypes.image"), value: "image" },
                                ].map((item) => (
                                    <Tag.CheckableTag
                                        key={item.value || "all"}
                                        checked={selectedType === item.value}
                                        className={cn("prompt-filter-tag", selectedType === item.value && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setSelectedType(item.value);
                                        }}
                                    >
                                        {item.label}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">{t("common.fields.tags")}</div>
                            <div className="flex flex-wrap gap-2">
                                <Tag.CheckableTag
                                    checked={selectedTags.length === 0}
                                    className={cn("prompt-filter-tag", selectedTags.length === 0 && "is-active")}
                                    onChange={() => {
                                        setPage(1);
                                        setSelectedTags([]);
                                    }}
                                >
                                    {t("common.all")}
                                </Tag.CheckableTag>
                                {availableTags.map((tag) => (
                                    <Tag.CheckableTag
                                        key={tag}
                                        checked={selectedTags.includes(tag)}
                                        className={cn("prompt-filter-tag", selectedTags.includes(tag) && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            toggleTag(tag);
                                        }}
                                    >
                                        {tag}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                        {items.map((asset) => (
                            <LibraryCard key={asset.id} asset={asset} onOpen={() => setSelectedAsset(asset)} onAdd={() => void saveToMyAssets(asset)} />
                        ))}
                    </div>

                    {!items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assetLibrary.empty")} className="py-20" /> : null}

                    <div className="flex justify-center">
                        <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={(nextPage) => setPage(nextPage)} />
                    </div>
                </div>
            </main>

            <Drawer title={t("assetLibrary.details.title")} open={Boolean(selectedAsset)} size="large" onClose={() => setSelectedAsset(null)}>
                {selectedAsset ? (
                    <div className="space-y-5">
                        {selectedAsset.coverUrl ? (
                            <Image src={selectedAsset.coverUrl} alt={selectedAsset.title} className="rounded-lg" />
                        ) : (
                            <div className="rounded-lg border bg-card p-5 text-sm leading-6 text-muted-foreground">{selectedAsset.content || t("common.states.noCover")}</div>
                        )}
                        <div>
                            <Typography.Title level={4} className="!mb-2">
                                {selectedAsset.title}
                            </Typography.Title>
                            <div className="flex flex-wrap gap-1.5">
                                <Tag>{t(`common.assetTypes.${selectedAsset.type}`)}</Tag>
                                {selectedAsset.tags.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-lg border p-4">
                            <Typography.Text type="secondary" className="block text-xs">
                                {t("common.fields.content")}
                            </Typography.Text>
                            {selectedAsset.type === "text" ? <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{selectedAsset.content}</Typography.Paragraph> : <Typography.Text className="mt-2 block">{selectedAsset.url}</Typography.Text>}
                        </div>
                        {selectedAsset.description ? <Typography.Paragraph type="secondary">{selectedAsset.description}</Typography.Paragraph> : null}
                        <div className="flex flex-wrap gap-2">
                            {selectedAsset.type === "text" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.content)}>
                                    {t("assetLibrary.actions.copyText")}
                                </Button>
                            ) : null}
                            {selectedAsset.type === "image" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.url)}>
                                    {t("assetLibrary.actions.copyLink")}
                                </Button>
                            ) : null}
                            <Button icon={<FolderPlus className="size-4" />} onClick={() => void saveToMyAssets(selectedAsset)}>
                                {t("common.actions.addToMyAssets")}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function LibraryCard({ asset, onOpen, onAdd }: { asset: AssetLibraryItem; onOpen: () => void; onAdd: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl;
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted p-5 text-center text-sm leading-6 text-muted-foreground">{asset.content || t("common.states.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-foreground">{asset.title}</h2>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`common.assetTypes.${asset.type}`)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {asset.type === "text" ? asset.content : asset.url}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {asset.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags.length ? <Tag className="m-0 text-[11px]">{t("common.states.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    {t("common.actions.view")}
                </Button>
                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={onAdd}>
                    {t("common.actions.addToMyAssets")}
                </Button>
            </div>
        </Card>
    );
}

async function remoteImageToDataUrl(url: string) {
    const response = await axios.get(url, { responseType: "blob" });
    const blob = response.data as Blob;
    return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("assetLibrary.errors.readImage")));
        reader.readAsDataURL(blob);
    });
}
