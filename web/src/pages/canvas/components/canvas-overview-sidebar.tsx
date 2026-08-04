"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "antd";
import { FileText, Image as ImageIcon, Layers3, Library, Music2, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatNumber } from "@/i18n/formatters";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "../types";
import { MyAssetsPanel, type InsertAssetPayload } from "./asset-picker-modal";
import { filterOverviewNodes, overviewPreviewKind } from "./canvas-overview";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
    onSelectNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

export function CanvasOverviewSidebar({ nodes, selectedNodeIds, collapsed, onCollapsedChange, onSelectNode, onInsertAsset }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<"canvas" | "assets">("canvas");
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("all");
    const visibleNodes = useMemo(() => filterOverviewNodes(nodes, keyword, type), [keyword, nodes, type]);
    const typeOptions = [
        { value: "all", label: t("canvas.overview.type.all") },
        { value: "image", label: t("canvas.nodeTypes.image") },
        { value: "text", label: t("canvas.nodeTypes.text") },
        { value: "config", label: t("canvas.nodeTypes.config") },
        { value: "video", label: t("canvas.nodeTypes.video") },
        { value: "audio", label: t("canvas.nodeTypes.audio") },
    ];

    if (collapsed)
        return (
            <aside className="relative z-[70] hidden w-10 shrink-0 justify-center border-r pt-3 md:flex" style={{ background: theme.canvas.background, borderColor: theme.toolbar.border }} aria-label={t("canvas.overview.label")}>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: theme.node.text }}
                    onClick={() => onCollapsedChange(false)}
                    aria-label={t("canvas.overview.expand")}
                    title={t("canvas.overview.expand")}
                >
                    <PanelLeftOpen className="size-4" />
                </button>
            </aside>
        );

    return (
        <aside
            data-canvas-no-zoom
            className="relative z-[70] hidden w-[280px] shrink-0 flex-col border-r md:flex"
            style={{ background: theme.canvas.background, borderColor: theme.toolbar.border, color: theme.node.text }}
            aria-label={t("canvas.overview.label")}
        >
            <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: theme.toolbar.border }} role="tablist" aria-label={t("canvas.overview.tabs.label")}>
                <TabButton active={tab === "canvas"} theme={theme} icon={<Layers3 className="size-3.5" />} onClick={() => setTab("canvas")}>
                    {t("canvas.overview.tabs.canvas")}
                </TabButton>
                <TabButton active={tab === "assets"} theme={theme} icon={<Library className="size-3.5" />} onClick={() => setTab("assets")}>
                    {t("canvas.overview.tabs.assets")}
                </TabButton>
                <button
                    type="button"
                    className="ml-auto grid size-8 place-items-center rounded-md transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2"
                    onClick={() => onCollapsedChange(true)}
                    aria-label={t("canvas.overview.collapse")}
                    title={t("canvas.overview.collapse")}
                >
                    <PanelLeftClose className="size-4" />
                </button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                {tab === "canvas" ? (
                    <div className="space-y-3">
                        <Input
                            size="small"
                            prefix={<Search className="size-3.5" />}
                            placeholder={t("canvas.overview.search.placeholder")}
                            value={keyword}
                            allowClear
                            onChange={(event) => setKeyword(event.target.value)}
                            aria-label={t("canvas.overview.search.ariaLabel")}
                        />
                        <Select size="small" className="w-full" value={type} options={typeOptions} onChange={setType} aria-label={t("canvas.overview.type.label")} />
                        <ul className="space-y-1" aria-label={t("canvas.overview.listLabel")}>
                            {visibleNodes.map((node) => (
                                <li key={node.id}>
                                    <button
                                        type="button"
                                        className="flex h-14 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-1"
                                        style={{ background: isSelected(node, selectedNodeIds) ? theme.toolbar.activeBg : "transparent", color: isSelected(node, selectedNodeIds) ? theme.toolbar.activeText : theme.node.text }}
                                        aria-current={isSelected(node, selectedNodeIds) ? "true" : undefined}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => onSelectNode(node.id)}
                                    >
                                        <NodePreview node={node} theme={theme} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-medium">{node.title || t(`canvas.nodeTypes.${node.type}`)}</span>
                                            <span className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: theme.node.muted }}>
                                                <span className="size-1.5 rounded-full" style={{ background: statusColor(node.metadata?.status, theme) }} />
                                                {t(`canvas.overview.status.${statusKey(node.metadata?.status)}`)}
                                                {node.metadata?.isBatchRoot && node.metadata.batchChildIds?.length
                                                    ? t("canvas.overview.batchResults", { count: node.metadata.batchChildIds.length, value: formatNumber(node.metadata.batchChildIds.length) })
                                                    : null}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {!visibleNodes.length ? (
                            <div className="py-10 text-center text-xs" style={{ color: theme.node.muted }}>
                                {t("canvas.overview.empty")}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <MyAssetsPanel active={tab === "assets"} compact onInsert={onInsertAsset} />
                )}
            </div>
        </aside>
    );
}

function TabButton({ active, theme, icon, onClick, children }: { active: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; onClick: () => void; children: string }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1"
            style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.toolbar.activeText : theme.node.muted }}
            onClick={onClick}
        >
            {icon}
            {children}
        </button>
    );
}

function NodePreview({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const Icon = node.type === "image" ? ImageIcon : node.type === "video" ? Video : node.type === "audio" ? Music2 : node.type === "config" ? SlidersHorizontal : FileText;
    const preview = overviewPreviewKind(node);
    return (
        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}>
            <Icon className="size-4" />
            {preview === "image" ? <img src={node.metadata?.content} alt="" className="absolute inset-0 size-full object-cover" onError={(event) => event.currentTarget.remove()} /> : null}
            {preview === "video" ? (
                <video
                    src={node.metadata?.content}
                    aria-label={t("canvas.overview.videoPreview", { title: node.title })}
                    className="absolute inset-0 size-full object-cover"
                    muted
                    playsInline
                    preload="auto"
                    onError={(event) => event.currentTarget.remove()}
                />
            ) : null}
        </span>
    );
}

function statusKey(status?: string) {
    return status === "loading" ? "processing" : status === "error" ? "failed" : status === "success" ? "completed" : "ready";
}

function statusColor(status: string | undefined, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    return status === "error" ? "#dc2626" : status === "loading" ? theme.node.activeStroke : status === "success" ? "#16a34a" : theme.node.muted;
}

function isSelected(node: CanvasNodeData, selectedNodeIds: Set<string>) {
    return selectedNodeIds.has(node.id) || Boolean(node.metadata?.batchChildIds?.some((id) => selectedNodeIds.has(id)));
}
