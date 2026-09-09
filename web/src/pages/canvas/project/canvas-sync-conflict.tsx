import { useState } from "react";
import { App, Button } from "antd";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasStore } from "../stores/use-canvas-store";

export function CanvasSyncConflict({ projectId }: { projectId: string }) {
    const conflict = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.syncConflict);
    const resolve = useCanvasStore((state) => state.resolveProjectConflict);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [saving, setSaving] = useState(false);
    if (!conflict) return null;
    return (
        <div role="status" className="absolute left-4 right-4 top-16 z-30 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <span>{t("canvas.sync.conflict")}</span>
            <Button
                type="text"
                loading={saving}
                onClick={async () => {
                    if (saving) return;
                    setSaving(true);
                    try {
                        const copyId = await resolve(projectId);
                        if (copyId) message.success(t("canvas.sync.resolved"));
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t("canvas.sync.failed"));
                    } finally {
                        setSaving(false);
                    }
                }}
            >
                {t("canvas.sync.keepCopy")}
            </Button>
        </div>
    );
}
