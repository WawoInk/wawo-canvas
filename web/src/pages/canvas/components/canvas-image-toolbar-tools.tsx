"use client";

import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Grid2x2, Lock, LockOpen, Maximize2, Scissors, Sparkles, Upload, ZoomIn } from "lucide-react";
import type { TFunction } from "i18next";

import type { CanvasNodeData } from "../types";

export type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "maskEdit" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "view";
export type ImageQuickToolId = "info" | "delete" | "saveAsset" | "download" | "edit" | ImageNodeActionToolId;

export type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

export type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    defaultVisible: boolean;
    panelLabelKey: string;
    labelKey: string | ((node: CanvasNodeData) => string);
    titleKey: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

export type ImageQuickToolsConfig = {
    ids: ImageQuickToolId[];
    showLabels: boolean;
};

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools-v6";

const defaultBaseToolIds: ImageQuickToolId[] = ["info", "delete", "saveAsset", "download", "edit"];

export const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.copyPrompt.label",
        labelKey: "canvas.toolbar.imageTools.copyPrompt.label",
        titleKey: "canvas.toolbar.imageTools.copyPrompt.title",
        icon: () => <Copy className="size-4" />,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.reversePrompt.label",
        labelKey: "canvas.toolbar.imageTools.reversePrompt.label",
        titleKey: "canvas.toolbar.imageTools.reversePrompt.title",
        icon: () => <FileText className="size-4" />,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.replace.label",
        labelKey: "canvas.toolbar.imageTools.replace.label",
        titleKey: "canvas.toolbar.imageTools.replace.title",
        icon: () => <Upload className="size-4" />,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        defaultVisible: false,
        panelLabelKey: "canvas.toolbar.imageTools.resize.lockedLabel",
        labelKey: (node) => (node.metadata?.freeResize ? "canvas.toolbar.imageTools.resize.freeLabel" : "canvas.toolbar.imageTools.resize.lockedLabel"),
        titleKey: (node) => (node.metadata?.freeResize ? "canvas.toolbar.imageTools.resize.toLockedTitle" : "canvas.toolbar.imageTools.resize.toFreeTitle"),
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />),
        active: (node) => Boolean(node.metadata?.freeResize),
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "maskEdit",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.maskEdit.label",
        labelKey: "canvas.toolbar.imageTools.maskEdit.label",
        titleKey: "canvas.toolbar.imageTools.maskEdit.title",
        icon: () => <Brush className="size-4" />,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "crop",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.crop.label",
        labelKey: "canvas.toolbar.imageTools.crop.label",
        titleKey: "canvas.toolbar.imageTools.crop.title",
        icon: () => <Scissors className="size-4" />,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.split.label",
        labelKey: "canvas.toolbar.imageTools.split.label",
        titleKey: "canvas.toolbar.imageTools.split.title",
        icon: () => <Grid2x2 className="size-4" />,
        run: (node, handlers) => handlers.onSplit(node),
    },
    {
        id: "upscale",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.upscale.label",
        labelKey: "canvas.toolbar.imageTools.upscale.label",
        titleKey: "canvas.toolbar.imageTools.upscale.title",
        icon: () => <ZoomIn className="size-4" />,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "superResolve",
        defaultVisible: false,
        panelLabelKey: "canvas.toolbar.imageTools.superResolve.label",
        labelKey: "canvas.toolbar.imageTools.superResolve.label",
        titleKey: "canvas.toolbar.imageTools.superResolve.title",
        icon: () => <Sparkles className="size-4" />,
        run: (node, handlers) => handlers.onSuperResolve(node),
    },
    {
        id: "angle",
        defaultVisible: false,
        panelLabelKey: "canvas.toolbar.imageTools.angle.label",
        labelKey: "canvas.toolbar.imageTools.angle.label",
        titleKey: "canvas.toolbar.imageTools.angle.title",
        icon: () => <Camera className="size-4" />,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "view",
        defaultVisible: true,
        panelLabelKey: "canvas.toolbar.imageTools.view.label",
        labelKey: "canvas.toolbar.imageTools.view.label",
        titleKey: "canvas.toolbar.imageTools.view.title",
        icon: () => <Maximize2 className="size-4" />,
        run: (node, handlers) => handlers.onViewImage(node),
    },
];

export const defaultImageQuickToolIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolDefinitions.filter((tool) => tool.defaultVisible).map((tool) => tool.id)];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers, t: TFunction) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.labelKey, node, t),
        title: resolveToolText(tool.titleKey, node, t),
        icon: tool.icon(node),
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export function normalizeImageQuickToolIds(value: unknown[]) {
    const allIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolDefinitions.map((tool) => tool.id)];
    const ids = new Set(allIds);
    return allIds.filter((id) => value.includes(id) && ids.has(id));
}

export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig {
    if (Array.isArray(value)) return { ids: normalizeImageQuickToolIds(value), showLabels: true };
    if (!value || typeof value !== "object") return { ids: defaultImageQuickToolIds, showLabels: true };
    const data = value as Partial<ImageQuickToolsConfig>;
    return {
        ids: Array.isArray(data.ids) ? normalizeImageQuickToolIds(data.ids) : defaultImageQuickToolIds,
        showLabels: data.showLabels !== false,
    };
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData, t: TFunction) {
    return t(typeof value === "function" ? value(node) : value);
}
