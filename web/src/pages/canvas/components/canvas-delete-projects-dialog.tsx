"use client";

import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { formatNumber } from "@/i18n/formatters";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = () => {
        deleteProjects(ids);
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <Modal
            title={t("canvas.library.deleteDialog.title")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("canvas.library.deleteDialog.cancel")}</Button>
                    <Button danger type="primary" onClick={confirm}>
                        {t("canvas.library.deleteDialog.confirm")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-muted-foreground">{t("canvas.library.deleteDialog.description", { count: ids.length, value: formatNumber(ids.length) })}</p>
        </Modal>
    );
}
