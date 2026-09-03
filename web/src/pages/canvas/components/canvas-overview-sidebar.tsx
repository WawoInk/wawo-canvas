"use client";

import { useMemo, useState } from "react";
import { App, Input, Select } from "antd";
import { Check, ChevronRight, Download, FileText, Image as ImageIcon, Layers3, Library, ListChecks, Music2, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Square, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatNumber } from "@/i18n/formatters";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { exportCanvasNodes } from "../utils/canvas-export";
import { MyAssetsPanel, type InsertAssetPayload } from "./asset-picker-modal";
import { buildOverviewTree, filterOverviewNodes, overviewPreviewKind } from "./canvas-overview";

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
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<"canvas" | "assets">("canvas");
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checkedNodeIds, setCheckedNodeIds] = useState<Set<string>>(new Set());
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const filteredNodes = useMemo(() => filterOverviewNodes(nodes, keyword, type), [keyword, nodes, type]);
    const visibleRows = useMemo(() => buildOverviewTree(nodes, keyword, type, collapsedGroupIds), [collapsedGroupIds, keyword, nodes, type]);
    const typeOptions = [
        { value: "all", label: t("canvas.overview.type.all") },
        { value: CanvasNodeType.Image, label: t("canvas.nodeTypes.image") },
        { value: CanvasNodeType.Text, label: t("canvas.nodeTypes.text") },
        { value: CanvasNodeType.Config, label: t("canvas.nodeTypes.config") },
        { value: CanvasNodeType.Video, label: t("canvas.nodeTypes.video") },
        { value: CanvasNodeType.Audio, label: t("canvas.nodeTypes.audio") },
        { value: CanvasNodeType.Group, label: t("canvas.nodeTypes.group", { defaultValue: "分组" }) },
    ];
    const allChecked = filteredNodes.length > 0 && filteredNodes.every((node) => checkedNodeIds.has(node.id));

    const exitSelectMode = () => {
        setSelectMode(false);
        setCheckedNodeIds(new Set());
    };
    const toggleChecked = (nodeId: string) =>
        setCheckedNodeIds((current) => {
            const next = new Set(current);
            next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
            return next;
        });
    const toggleAll = () => setCheckedNodeIds(allChecked ? new Set() : new Set(filteredNodes.map((node) => node.id)));
    const toggleGroup = (nodeId: string) =>
        setCollapsedGroupIds((current) => {
            const next = new Set(current);
            next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
            return next;
        });
    const handleExport = async () => {
        const targets = nodes.filter((node) => checkedNodeIds.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.overview.exporting", { defaultValue: "正在导出选中元素…" }), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.overview.exportName", { count: targets.length, defaultValue: "画布元素-{{count}}个" }));
            message.success(t("canvas.overview.exported", { count: targets.length, defaultValue: "已导出 {{count}} 个元素" }));
            exitSelectMode();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.overview.exportFailed", { defaultValue: "导出失败，请重试" }));
        } finally {
            hide();
            setExporting(false);
        }
    };

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
            {tab === "canvas" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="space-y-3 p-3 pb-2">
                        <Input
                            size="small"
                            prefix={<Search className="size-3.5" />}
                            placeholder={t("canvas.overview.search.placeholder")}
                            value={keyword}
                            allowClear
                            onChange={(event) => setKeyword(event.target.value)}
                            aria-label={t("canvas.overview.search.ariaLabel")}
                        />
                        <div className="flex items-center gap-2">
                            <Select size="small" className="min-w-0 flex-1" value={type} options={typeOptions} onChange={setType} aria-label={t("canvas.overview.type.label")} />
                            <button
                                type="button"
                                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-1"
                                style={{ color: selectMode ? theme.toolbar.activeText : theme.node.muted }}
                                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                            >
                                <ListChecks className="size-3.5" />
                                {selectMode ? t("common.actions.cancel") : t("canvas.overview.select", { defaultValue: "选择" })}
                            </button>
                        </div>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                        <ul className="space-y-1" aria-label={t("canvas.overview.listLabel")}>
                            {visibleRows.map(({ node, depth, hasChildren }) => {
                                const active = selectMode ? checkedNodeIds.has(node.id) : isSelected(node, selectedNodeIds);
                                return (
                                    <li key={node.id} className={depth ? "relative ml-5" : undefined}>
                                        {depth ? <span className="pointer-events-none absolute -left-3 top-[-4px] h-[calc(50%+4px)] w-3 rounded-bl-md border-b border-l opacity-45" style={{ borderColor: theme.node.stroke }} /> : null}
                                        <div className="flex min-w-0 items-center rounded-md transition" style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.toolbar.activeText : theme.node.text }}>
                                            {node.type === CanvasNodeType.Group && hasChildren ? (
                                                <button
                                                    type="button"
                                                    className="ml-1 grid size-6 shrink-0 place-items-center transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-1"
                                                    aria-expanded={!collapsedGroupIds.has(node.id)}
                                                    aria-label={t("canvas.overview.toggleGroup", { title: node.title, defaultValue: "展开或折叠{{title}}" })}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => toggleGroup(node.id)}
                                                >
                                                    <ChevronRight className={`size-3.5 transition-transform ${collapsedGroupIds.has(node.id) ? "" : "rotate-90"}`} />
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                className="flex h-14 min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1"
                                                aria-current={active ? "true" : undefined}
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => (selectMode ? toggleChecked(node.id) : onSelectNode(node.id))}
                                            >
                                                {selectMode ? <CheckMark checked={checkedNodeIds.has(node.id)} theme={theme} /> : null}
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
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        {!visibleRows.length ? (
                            <div className="py-10 text-center text-xs" style={{ color: theme.node.muted }}>
                                {t("canvas.overview.empty")}
                            </div>
                        ) : null}
                    </div>
                    {selectMode ? (
                        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                            <button type="button" className="text-xs font-medium transition hover:opacity-70" onClick={toggleAll}>
                                {allChecked ? t("image.actions.deselectAll", { defaultValue: "取消全选" }) : t("image.actions.selectAll", { defaultValue: "全选" })}
                            </button>
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                {t("canvas.overview.selected", { count: checkedNodeIds.size, defaultValue: "已选 {{count}}" })}
                            </span>
                            <button
                                type="button"
                                className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                                style={{ color: theme.toolbar.activeText }}
                                disabled={!checkedNodeIds.size || exporting}
                                onClick={() => void handleExport()}
                            >
                                <Download className="size-3.5" />
                                {t("canvas.overview.exportSelected", { defaultValue: "导出选中" })}
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                    <MyAssetsPanel active compact onInsert={onInsertAsset} />
                </div>
            )}
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

function CheckMark({ checked, theme }: { checked: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

function NodePreview({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const Icon =
        node.type === CanvasNodeType.Image
            ? ImageIcon
            : node.type === CanvasNodeType.Video
              ? Video
              : node.type === CanvasNodeType.Audio
                ? Music2
                : node.type === CanvasNodeType.Config
                  ? SlidersHorizontal
                  : node.type === CanvasNodeType.Group
                    ? Square
                    : FileText;
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
