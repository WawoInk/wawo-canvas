import { FileText, Image as ImageIcon, Music2, Plus, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { getGroupResourceNodes } from "../utils/canvas-resource-references";

type CanvasNodeReferenceBarProps = {
    nodeId: string;
    nodes: CanvasNodeData[];
    connectedNodes: CanvasNodeData[];
    onDisconnect?: (fromNodeId: string, toNodeId: string) => void;
    onStartSelection?: (nodeId: string) => void;
};

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, onDisconnect, onStartSelection }: CanvasNodeReferenceBarProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const references = connectedNodes
        .flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })))
        .filter((reference, index, all) => all.findIndex((item) => item.node.id === reference.node.id) === index);
    if (!references.length && !onStartSelection) return null;

    return (
        <div className="mb-2" data-canvas-reference-bar>
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                {t("canvas.references.title", { defaultValue: "参考" })}
            </div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }) => (
                    <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} onRemove={onDisconnect ? () => onDisconnect(sourceNodeId, nodeId) : undefined} />
                ))}
                {onStartSelection ? (
                    <button
                        type="button"
                        data-canvas-reference-picker
                        className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                        aria-label={t("canvas.references.select", { defaultValue: "选择参考节点" })}
                        title={t("canvas.references.select", { defaultValue: "选择参考节点" })}
                        onClick={() => onStartSelection(nodeId)}
                    >
                        <Plus className="size-4" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function ReferenceItem({ node, onRemove }: { node: CanvasNodeData; onRemove?: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const content = browserPreviewUrl(node.metadata?.content);
    const Icon = node.type === CanvasNodeType.Image ? ImageIcon : node.type === CanvasNodeType.Video ? Video : node.type === CanvasNodeType.Audio ? Music2 : FileText;

    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} trigger={["hover", "focus"]} content={<ReferencePreview node={node} content={content} />}>
            <div
                tabIndex={0}
                data-canvas-reference-node-id={node.id}
                className="group relative grid size-12 shrink-0 place-items-center rounded-xl border outline-none"
                style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.text }}
                aria-label={node.title}
            >
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {node.type === CanvasNodeType.Image && content ? (
                        <img src={content} alt="" className="size-full object-cover" />
                    ) : node.type === CanvasNodeType.Video && content ? (
                        <video src={content} className="size-full object-cover" muted preload="metadata" />
                    ) : (
                        <Icon className="size-4 opacity-65" />
                    )}
                </span>
                {onRemove ? (
                    <button
                        type="button"
                        data-canvas-reference-remove
                        className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        aria-label={t("canvas.references.disconnect", { defaultValue: "移除参考连接" })}
                        title={t("canvas.references.disconnect", { defaultValue: "移除参考连接" })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRemove();
                        }}
                    >
                        <X className="size-3" />
                    </button>
                ) : null}
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    if (node.type === CanvasNodeType.Image && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if (node.type === CanvasNodeType.Video && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if (node.type === CanvasNodeType.Audio && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty", { defaultValue: "暂无内容" })}</div>;
}

function browserPreviewUrl(content?: string) {
    return content && !content.startsWith("asset://") ? content : undefined;
}
