"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, GalleryHorizontal, GalleryHorizontalEnd, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "../types";
import type { VideoFramePosition } from "../utils/canvas-video-frame";

export function CanvasNodeContextMenu({
    menu,
    canCaptureVideoFrame = false,
    onClose,
    onCaptureVideoFrame,
    onDuplicate,
    onDelete,
}: {
    menu: ContextMenuState;
    canCaptureVideoFrame?: boolean;
    onClose: () => void;
    onCaptureVideoFrame?: (position: VideoFramePosition) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" && canCaptureVideoFrame && onCaptureVideoFrame ? (
                <>
                    <MenuButton framePosition="first" icon={<BetweenHorizontalStart className="size-4" />} label={t("canvas.videoFrames.first", { defaultValue: "提取首帧" })} onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton framePosition="last" icon={<GalleryHorizontalEnd className="size-4" />} label={t("canvas.videoFrames.last", { defaultValue: "提取尾帧" })} onClick={() => onCaptureVideoFrame("last")} />
                    <MenuButton framePosition="current" icon={<GalleryHorizontal className="size-4" />} label={t("canvas.videoFrames.current", { defaultValue: "提取当前帧" })} onClick={() => onCaptureVideoFrame("current")} />
                    <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                </>
            ) : null}
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={t("canvas.contextMenu.duplicate")} onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.contextMenu.delete")} onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ framePosition, icon, label, onClick, danger = false }: { framePosition?: VideoFramePosition; icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" data-video-frame-position={framePosition} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
