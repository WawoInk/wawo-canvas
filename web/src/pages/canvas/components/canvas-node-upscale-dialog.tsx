"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Modal, Segmented } from "antd";
import { ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDimensions, formatNumber } from "@/i18n/formatters";
import { readImageMeta } from "@/lib/image-utils";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize, type ImageUpscaleAlgorithm, type ImageUpscaleParams } from "../utils/canvas-image-data";

export type CanvasImageUpscaleParams = ImageUpscaleParams;

const algorithms: Array<{ value: ImageUpscaleAlgorithm; titleKey: string; descriptionKey: string }> = [
    { value: "high", titleKey: "canvas.upscale.algorithms.high.title", descriptionKey: "canvas.upscale.algorithms.high.description" },
    { value: "bilinear", titleKey: "canvas.upscale.algorithms.bilinear.title", descriptionKey: "canvas.upscale.algorithms.bilinear.description" },
    { value: "nearest", titleKey: "canvas.upscale.algorithms.nearest.title", descriptionKey: "canvas.upscale.algorithms.nearest.description" },
];

const targetOptions = [
    { label: "1K", value: 1024 },
    { label: "2K", value: 2048 },
    { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
];

const defaultParams: CanvasImageUpscaleParams = {
    targetLongEdge: 2048,
    algorithm: "high",
};

export function CanvasNodeUpscaleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageUpscaleParams) => Promise<void> }) {
    const { t } = useTranslation();
    const runningRef = useRef(false);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const [params, setParams] = useState<CanvasImageUpscaleParams>(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const canUpscale = Boolean(image && sourceLongEdge < params.targetLongEdge && params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE);
    const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);

    useEffect(() => {
        if (!open) return;
        setParams(defaultParams);
        setImage(null);
        setError("");
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image) return;
        const nextTarget = targetOptions.find((option) => sourceLongEdge < option.value)?.value || MAX_UPSCALE_LONG_EDGE;
        setParams((current) => ({ ...current, targetLongEdge: nextTarget }));
    }, [image, sourceLongEdge]);

    useEffect(() => {
        if (!open) return;
        const blockShortcuts = (event: KeyboardEvent) => {
            if (!runningRef.current || event.key === "Tab") return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener("keydown", blockShortcuts, true);
        return () => window.removeEventListener("keydown", blockShortcuts, true);
    }, [open]);

    const confirm = async () => {
        if (runningRef.current) return;
        runningRef.current = true;
        setRunning(true);
        setError("");
        try {
            await onConfirm(params);
        } catch (error) {
            setError(error instanceof Error ? error.message : t("errors.upload.failed"));
        } finally {
            runningRef.current = false;
            setRunning(false);
        }
    };

    return (
        <Modal
            title={null}
            open={open && Boolean(dataUrl)}
            onCancel={() => {
                if (!runningRef.current) onClose();
            }}
            closable={!running}
            keyboard={!running}
            mask={{ closable: !running }}
            footer={null}
            width={820}
            centered
            destroyOnHidden
        >
            <div className="space-y-5" aria-busy={running}>
                {error && <Alert type="error" showIcon title={error} />}
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.upscale.title")}</h2>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">{t("canvas.upscale.source")}</span>
                            <span className="font-semibold">{image ? t("canvas.units.pixelDimensions", { value: formatDimensions(image.width, image.height) }) : t("canvas.common.reading")}</span>
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.upscale.targetPixels")}</div>
                            <Segmented
                                disabled={running}
                                block
                                value={params.targetLongEdge}
                                options={targetOptions.map((option) => ({
                                    label: `${option.label} · ${t("canvas.units.pixelValue", { value: formatNumber(option.value) })}`,
                                    value: option.value,
                                    disabled: Boolean(image && sourceLongEdge >= option.value),
                                }))}
                                onChange={(value) => setParams((current) => ({ ...current, targetLongEdge: Number(value) }))}
                            />
                            {image && !canUpscale ? <div className="text-xs font-medium text-[#ef4444]">{t(reachedMax ? "canvas.upscale.errors.reachedMax" : "canvas.upscale.errors.reachedTarget")}</div> : null}
                        </div>
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.upscale.algorithm")}</div>
                            <Segmented
                                disabled={running}
                                block
                                value={params.algorithm}
                                options={algorithms.map((item) => ({
                                    value: item.value,
                                    label: (
                                        <span className="flex min-h-12 flex-col justify-center text-left leading-5">
                                            <span className="font-medium">{t(item.titleKey)}</span>
                                            <span className="text-xs opacity-55">{t(item.descriptionKey)}</span>
                                        </span>
                                    ),
                                }))}
                                onChange={(value) => setParams((current) => ({ ...current, algorithm: value as ImageUpscaleAlgorithm }))}
                            />
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.upscale.outputSize")}</span>
                                <span className="font-semibold">{outputSize ? t("canvas.units.pixelDimensions", { value: formatDimensions(outputSize.width, outputSize.height) }) : t("canvas.common.unknown")}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<ImagePlus className="size-4" />} disabled={running || !canUpscale} loading={running} onClick={() => void confirm()}>
                        {t("canvas.upscale.generate")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
