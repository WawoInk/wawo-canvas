"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, FileAudio, FileImage, FileVideo, Search, Upload } from "lucide-react";
import { Button, Empty, Input, Modal, Pagination, Result, Select, Skeleton, Spin, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";

import { fetchVolcengineAssetOutbounds, listVolcengineAssets, type VolcengineAsset, type VolcengineAssetList, type VolcengineAssetOutbound } from "@/services/api/volcengine-assets";
import { useUserStore } from "@/stores/use-user-store";

import type { CanvasNodeData } from "../types";

const PAGE_SIZE = 12;

type VolcengineAssetImportModalProps = {
    open: boolean;
    targetNode?: CanvasNodeData;
    onChooseLocal: () => void;
    onImport: (asset: VolcengineAsset, outbound: VolcengineAssetOutbound) => void;
    onClose: () => void;
};

export function VolcengineAssetImportModal({ open, targetNode, onChooseLocal, onImport, onClose }: VolcengineAssetImportModalProps) {
    const { t } = useTranslation();
    const token = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const [outbounds, setOutbounds] = useState<VolcengineAssetOutbound[]>([]);
    const [outboundsLoading, setOutboundsLoading] = useState(false);
    const [outboundsError, setOutboundsError] = useState("");
    const [selectedOutboundID, setSelectedOutboundID] = useState("");
    const [assets, setAssets] = useState<VolcengineAssetList | null>(null);
    const [assetsLoading, setAssetsLoading] = useState(false);
    const [assetsError, setAssetsError] = useState("");
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState("");
    const [keyword, setKeyword] = useState("");

    const loadOutbounds = useCallback(async () => {
        if (!token) return;
        setOutboundsLoading(true);
        setOutboundsError("");
        try {
            const next = await fetchVolcengineAssetOutbounds(token);
            setOutbounds(next);
            setSelectedOutboundID((current) => (next.some((outbound) => outbound.id === current) ? current : next[0]?.id || ""));
        } catch (error) {
            setOutboundsError(errorMessage(error, t("canvas.editor.materialImport.volcengine.loadLibrariesFailed")));
        } finally {
            setOutboundsLoading(false);
        }
    }, [t, token]);

    const loadAssets = useCallback(async () => {
        if (!token || !selectedOutboundID) return;
        setAssetsLoading(true);
        setAssetsError("");
        try {
            setAssets(await listVolcengineAssets(token, selectedOutboundID, page, PAGE_SIZE, keyword));
        } catch (error) {
            setAssetsError(errorMessage(error, t("canvas.editor.materialImport.volcengine.loadAssetsFailed")));
        } finally {
            setAssetsLoading(false);
        }
    }, [keyword, page, selectedOutboundID, t, token]);

    useEffect(() => {
        if (!open) return;
        setPage(1);
        setSearchInput("");
        setKeyword("");
    }, [open]);

    useEffect(() => {
        if (!open || !isReady || !token) return;
        void loadOutbounds();
    }, [isReady, loadOutbounds, open, token]);

    useEffect(() => {
        if (!open || !isReady || !token || !selectedOutboundID) return;
        void loadAssets();
    }, [isReady, loadAssets, open, selectedOutboundID, token]);

    const selectedOutbound = outbounds.find((outbound) => outbound.id === selectedOutboundID);
    const assetItems = assets?.Items || [];
    const total = assets?.TotalCount || 0;
    const actionKey = targetNode ? "replace" : "add";

    return (
        <Modal title={t("canvas.editor.materialImport.title")} open={open} centered footer={null} width={1080} onCancel={onClose} styles={{ body: { padding: 20, maxHeight: "78vh", overflowY: "auto" } }}>
            <p className="mb-5 text-sm text-muted-foreground">{targetNode ? t("canvas.editor.materialImport.replaceHint", { title: targetNode.title }) : t("canvas.editor.materialImport.description")}</p>
            <div className="grid gap-5 md:grid-cols-[minmax(220px,.34fr)_minmax(0,.66fr)]">
                <section className="flex min-h-[360px] flex-col rounded-2xl border bg-muted/20 p-5">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Upload className="size-5" />
                    </div>
                    <Typography.Title level={5} className="!mb-0 !mt-4">
                        {t("canvas.editor.materialImport.local.title")}
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 text-sm">
                        {t("canvas.editor.materialImport.local.description")}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" className="mt-3 text-xs">
                        {t("canvas.editor.materialImport.local.hint")}
                    </Typography.Text>
                    <Button type="primary" className="mt-auto" icon={<Upload className="size-4" />} onClick={onChooseLocal}>
                        {t(`canvas.editor.materialImport.actions.${actionKey}`)}
                    </Button>
                </section>

                <section className="min-w-0 rounded-2xl border p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Cloud className="size-5 text-sky-600 dark:text-sky-300" />
                                <Typography.Title level={5} className="!mb-0">
                                    {t("canvas.editor.materialImport.volcengine.title")}
                                </Typography.Title>
                            </div>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {t("canvas.editor.materialImport.volcengine.description")}
                            </Typography.Text>
                        </div>
                        <Button size="small" loading={outboundsLoading || assetsLoading} onClick={() => void Promise.all([loadOutbounds(), loadAssets()])}>
                            {t("canvas.editor.materialImport.actions.refresh")}
                        </Button>
                    </div>

                    {!isReady ? <div className="flex h-64 items-center justify-center"><Spin /></div> : null}
                    {isReady && !token ? <Result status="403" title={t("canvas.editor.materialImport.volcengine.loginRequired")} /> : null}
                    {isReady && token && outboundsLoading && !outbounds.length ? <AssetSkeleton /> : null}
                    {isReady && token && outboundsError ? <Result status="error" title={t("canvas.editor.materialImport.volcengine.loadLibrariesFailed")} subTitle={outboundsError} extra={<Button onClick={() => void loadOutbounds()}>{t("canvas.editor.materialImport.actions.retry")}</Button>} /> : null}
                    {isReady && token && !outboundsLoading && !outboundsError && !outbounds.length ? <Empty description={t("canvas.editor.materialImport.volcengine.noLibraries")} /> : null}
                    {isReady && token && !outboundsError && outbounds.length ? (
                        <div className="mt-5">
                            <Select
                                className="w-full"
                                value={selectedOutboundID || undefined}
                                placeholder={t("canvas.editor.materialImport.volcengine.selectLibrary")}
                                options={outbounds.map((outbound) => ({ value: outbound.id, label: outbound.name || outbound.id }))}
                                onChange={(id) => {
                                    setSelectedOutboundID(id);
                                    setPage(1);
                                    setSearchInput("");
                                    setKeyword("");
                                    setAssets(null);
                                }}
                            />
                            {selectedOutbound ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {selectedOutbound.format ? <Tag>{selectedOutbound.format}</Tag> : null}
                                    {selectedOutbound.group_type ? <Tag>{selectedOutbound.group_type}</Tag> : null}
                                </div>
                            ) : null}
                            {selectedOutboundID ? (
                                <>
                                    <Input.Search
                                        className="mt-4"
                                        value={searchInput}
                                        allowClear
                                        enterButton={<Search className="size-4" />}
                                        placeholder={t("canvas.editor.materialImport.volcengine.searchPlaceholder")}
                                        onChange={(event) => setSearchInput(event.target.value)}
                                        onSearch={(value) => {
                                            setPage(1);
                                            setKeyword(value.trim());
                                        }}
                                    />
                                    {assetsLoading ? <AssetSkeleton /> : null}
                                    {assetsError ? <Result status="error" title={t("canvas.editor.materialImport.volcengine.loadAssetsFailed")} subTitle={assetsError} extra={<Button onClick={() => void loadAssets()}>{t("canvas.editor.materialImport.actions.retry")}</Button>} /> : null}
                                    {!assetsLoading && !assetsError && !assetItems.length ? <Empty className="py-10" description={keyword ? t("canvas.editor.materialImport.volcengine.noMatch") : t("canvas.editor.materialImport.volcengine.empty")} /> : null}
                                    {!assetsLoading && !assetsError && assetItems.length ? (
                                        <>
                                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                {assetItems.map((asset) => (
                                                    <VolcengineAssetCard key={asset.Id} asset={asset} actionLabel={t(`canvas.editor.materialImport.actions.${actionKey}`)} onImport={() => {
                                                        if (selectedOutbound) onImport(asset, selectedOutbound);
                                                    }} />
                                                ))}
                                            </div>
                                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                                                <Typography.Text type="secondary" className="text-xs">
                                                    {t("canvas.editor.materialImport.volcengine.total", { count: total })}
                                                </Typography.Text>
                                                <Pagination current={page} pageSize={PAGE_SIZE} total={total} size="small" showSizeChanger={false} showQuickJumper={false} disabled={assetsLoading} onChange={setPage} />
                                            </div>
                                        </>
                                    ) : null}
                                </>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            </div>
        </Modal>
    );
}

function VolcengineAssetCard({ asset, actionLabel, onImport }: { asset: VolcengineAsset; actionLabel: string; onImport: () => void }) {
    const { t } = useTranslation();
    return (
        <article className="overflow-hidden rounded-xl border bg-card">
            <AssetPreview asset={asset} />
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-foreground">{asset.Name || t("canvas.editor.materialImport.volcengine.unnamed")}</h3>
                        <span className="mt-1 block text-xs text-muted-foreground">{t(`volcengineAssets.types.${asset.AssetType.toLowerCase()}`)}</span>
                    </div>
                    {asset.Status ? <Tag className="m-0 shrink-0 text-[10px]">{asset.Status}</Tag> : null}
                </div>
                <Button className="mt-3 w-full" size="small" type="primary" onClick={onImport}>
                    {actionLabel}
                </Button>
            </div>
        </article>
    );
}

function AssetPreview({ asset }: { asset: VolcengineAsset }) {
    const { t } = useTranslation();
    const [failed, setFailed] = useState(false);
    const url = isSafeMediaURL(asset.URL) ? asset.URL : "";
    const Icon = asset.AssetType === "Audio" ? FileAudio : asset.AssetType === "Video" ? FileVideo : FileImage;

    if (url && asset.AssetType === "Image" && !failed) return <img src={url} alt={asset.Name || t("canvas.editor.materialImport.volcengine.unnamed")} className="aspect-[4/3] w-full bg-muted/30 object-contain" loading="lazy" onError={() => setFailed(true)} />;
    if (url && asset.AssetType === "Video" && !failed) return <video src={url} className="aspect-[4/3] w-full bg-black object-contain" muted controls preload="metadata" onError={() => setFailed(true)} />;
    if (url && asset.AssetType === "Audio" && !failed) return <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted/30 px-3"><FileAudio className="size-9 text-muted-foreground" /><audio src={url} className="w-full" controls preload="metadata" onError={() => setFailed(true)} /></div>;
    return <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-muted/30 text-xs text-muted-foreground"><Icon className="size-8" /><span>{t(failed ? "canvas.editor.materialImport.volcengine.previewFailed" : "canvas.editor.materialImport.volcengine.previewUnavailable")}</span></div>;
}

function isSafeMediaURL(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
