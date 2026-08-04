"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Modal, Pagination, Tag } from "antd";
import { Play, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { LazyImage } from "@/components/lazy-media";
import { useAssetStore } from "@/stores/use-asset-store";
import { assetFileIdsToRefresh, assetInsertPayload, assetPreviewKind } from "./asset-picker";

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string; fileId?: string; width?: number; height?: number }
    | { kind: "video"; url: string; title: string; storageKey?: string; fileId?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, defaultTab: _defaultTab, onInsert, onClose }: Props) {
    const { t } = useTranslation();

    return (
        <Modal title={t("canvas.assets.picker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            <MyAssetsPanel active={open} onInsert={onInsert} />
        </Modal>
    );
}

export function MyAssetsPanel({ active, compact = false, onInsert }: { active: boolean; compact?: boolean; onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const refreshAssetUrls = useAssetStore((state) => state.refreshAssetUrls);
    const fileIdsKey = useMemo(() => assetFileIdsToRefresh(active, assets).join("\0"), [active, assets]);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (fileIdsKey) void refreshAssetUrls(fileIdsKey.split("\0"));
    }, [fileIdsKey, refreshAssetUrls]);

    const pageSize = compact ? 6 : 8;
    const kindOptions = [
        { label: t("canvas.assets.picker.filters.all"), value: "all" },
        { label: t("canvas.assets.picker.filters.text"), value: "text" },
        { label: t("canvas.assets.picker.filters.image"), value: "image" },
        { label: t("canvas.assets.picker.filters.video"), value: "video" },
    ];
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video")
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);
    const visible = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

    useEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / pageSize))));
    }, [filtered.length, pageSize]);

    return (
        <div className={compact ? "space-y-3" : "space-y-4"}>
            <div className={compact ? "space-y-2" : "flex flex-wrap items-center gap-3"}>
                <Input
                    className={compact ? "w-full" : "w-56"}
                    size="small"
                    prefix={<Search className="size-3.5 text-muted-foreground" />}
                    placeholder={t("canvas.assets.picker.searchPlaceholder")}
                    value={keyword}
                    allowClear
                    onChange={(event) => {
                        setPage(1);
                        setKeyword(event.target.value);
                    }}
                />
                <div className="flex flex-wrap gap-1">
                    {kindOptions.map((option) => (
                        <Tag.CheckableTag
                            key={option.value}
                            checked={kindFilter === option.value}
                            className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option.value);
                            }}
                        >
                            {option.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>
            {visible.length ? (
                <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-4 gap-3"}>
                    {visible.map((asset) => (
                        <PickerCard
                            key={asset.id}
                            title={asset.title}
                            kind={asset.kind}
                            source={asset.kind === "video" ? asset.data.url : asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")}
                            onClick={() => onInsert(assetInsertPayload(asset))}
                            compact={compact}
                        />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assets.picker.empty")} className="py-12" />
            )}
            {filtered.length > pageSize ? (
                <div className="flex justify-center">
                    <Pagination simple={compact} size="small" current={page} pageSize={pageSize} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            ) : null}
        </div>
    );
}

function PickerCard({ title, kind, source, compact = false, onClick }: { title: string; kind: string; source: string; compact?: boolean; onClick: () => void }) {
    const { t } = useTranslation();
    const preview = assetPreviewKind(kind, source);
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-muted-foreground hover:shadow-md dark:border-border dark:bg-card dark:hover:border-muted-foreground"
            onClick={onClick}
        >
            <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted dark:bg-card">
                {kind === "video" ? <Play className="size-6 text-muted-foreground" /> : preview === "icon" ? <span className="p-3 text-center text-xs leading-5 text-muted-foreground">{title}</span> : null}
                {preview === "image" ? <LazyImage src={source} alt={title} className="absolute inset-0 size-full" /> : null}
                {preview === "video" ? (
                    <video src={source} aria-label={t("canvas.assets.picker.previewAria", { title })} className="absolute inset-0 size-full object-cover" muted playsInline preload="auto" onError={(event) => event.currentTarget.remove()} />
                ) : null}
            </div>
            <div className={compact ? "p-1.5" : "p-2.5"}>
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-foreground dark:text-foreground">{title}</span>
                    {!compact ? <Tag className="m-0 shrink-0 text-[10px]">{t(`canvas.assets.picker.filters.${kind === "image" || kind === "video" ? kind : "text"}`)}</Tag> : null}
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-foreground/55 group-hover:opacity-100">
                {t("canvas.assets.picker.insert")}
            </div>
        </button>
    );
}
