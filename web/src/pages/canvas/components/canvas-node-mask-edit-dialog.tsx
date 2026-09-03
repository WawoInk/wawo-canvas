"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Modal, Slider, Tooltip } from "antd";
import { Brush, Eraser, ImagePlus, Redo2, RotateCcw, Undo2, WandSparkles, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDimensions, formatNumber } from "@/i18n/formatters";
import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageMaskEditPayload = {
    prompt: string;
    maskDataUrl: string;
    referenceDataUrl: string;
    generate: boolean;
};

type DrawMode = "paint" | "erase";
type Point = { x: number; y: number };
type MaskStroke = { mode: DrawMode; size: number; points: Point[] };
type BrushPreview = { x: number; y: number; size: number; adjusting: boolean };

const defaultBrushSize = 100;
const maskOverlayColor = "#2563eb";
const maskOverlayAlpha = 0.38;
const maskFillColor = "rgba(37, 99, 235, .38)";
const maskBorderColor = "rgba(255, 255, 255, .72)";

export function CanvasNodeMaskEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void }) {
    const { t } = useTranslation();
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const drawingRef = useRef<{ active: boolean; stroke: MaskStroke | null }>({ active: false, stroke: null });
    const brushAdjustRef = useRef<{ active: boolean; pointerId: number; startX: number; startSize: number; previewX: number; previewY: number } | null>(null);
    const historyRef = useRef<MaskStroke[]>([]);
    const redoRef = useRef<MaskStroke[]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [error, setError] = useState("");
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
    const viewport = useImageEditorViewport(image, open);

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setBrushSize(defaultBrushSize);
        setMode("paint");
        setError("");
        setHistorySize(0);
        setRedoSize(0);
        setBrushPreview(null);
        historyRef.current = [];
        redoRef.current = [];
        brushAdjustRef.current = null;
        drawingRef.current = { active: false, stroke: null };
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const maskCanvas = maskCanvasRef.current;
        const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
        const stroke = drawingRef.current.stroke;
        if (!maskCanvas || !context || !stroke) return;
        configureStrokeContext(context, stroke);
        const last = stroke.points.at(-1);
        drawMaskStroke(context, last || point, point, stroke.size);
        renderMaskPreview(maskCanvas, previewCanvasRef.current);
        stroke.points.push(point);
        if (stroke.mode === "paint") {
            setError("");
        }
    };

    const updateBrushPreview = (event: ReactPointerEvent<HTMLCanvasElement>, size = brushSize, adjusting = false) => {
        setBrushPreview({
            x: event.clientX,
            y: event.clientY,
            size,
            adjusting,
        });
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if ((event.button === 0 || event.button === 2) && event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            brushAdjustRef.current = {
                active: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startSize: brushSize,
                previewX: event.clientX,
                previewY: event.clientY,
            };
            updateBrushPreview(event, brushSize, true);
            return;
        }
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBrushPreview(event);
        drawingRef.current = { active: true, stroke: { mode, size: brushSize, points: [] } };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            const nextSize = clampBrushSize(brushAdjust.startSize + event.clientX - brushAdjust.startX);
            setBrushSize(nextSize);
            setBrushPreview({
                x: brushAdjust.previewX,
                y: brushAdjust.previewY,
                size: nextSize,
                adjusting: true,
            });
            return;
        }
        updateBrushPreview(event);
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            brushAdjustRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            updateBrushPreview(event, brushSize);
            return;
        }
        const stroke = drawingRef.current.stroke;
        drawingRef.current = { active: false, stroke: null };
        if (stroke?.points.length) {
            historyRef.current.push(stroke);
            setHistorySize(historyRef.current.length);
            redoRef.current = [];
            setRedoSize(0);
        }
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) renderMaskPreview(maskCanvas, previewCanvasRef.current, canvasHasPaint(maskCanvas));
    };

    const undoMask = useCallback(() => {
        if (drawingRef.current.active || !historyRef.current.length) return;
        const stroke = historyRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const redoMask = useCallback(() => {
        if (drawingRef.current.active || !redoRef.current.length) return;
        const stroke = redoRef.current.pop();
        if (stroke) historyRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const resetMask = () => {
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        setError("");
    };

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            const key = event.key.toLowerCase();
            const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
            const isUndo = modifier && !event.shiftKey && key === "z";
            const isRedo = modifier && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
            if (!isUndo && !isRedo) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isRedo) redoMask();
            else undoMask();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [open, redoMask, undoMask]);

    const submit = (generate: boolean) => {
        const nextPrompt = prompt.trim();
        const canvas = maskCanvasRef.current;
        const element = imageRef.current;
        if (!nextPrompt) return setError(t("canvas.maskEdit.errors.promptRequired"));
        if (!canvas || !element) return;
        if (!canvasHasPaint(canvas)) return setError(t("canvas.maskEdit.errors.maskRequired"));
        onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(canvas), referenceDataUrl: buildMaskOverlay(element, canvas), generate });
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_380px]" data-canvas-no-zoom>
                <div
                    ref={viewport.viewportRef}
                    {...viewport.panHandlers}
                    className={`relative h-[min(68vh,720px)] min-h-[360px] rounded-xl border border-black/10 bg-transparent dark:border-white/10 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                >
                    <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            {image ? (
                                <>
                                    <canvas ref={maskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                    <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                        <img ref={imageRef} src={dataUrl} alt="" className="absolute inset-0 block h-full w-full bg-transparent object-contain" draggable={false} />
                                        <canvas
                                            ref={previewCanvasRef}
                                            width={image.width}
                                            height={image.height}
                                            className="absolute inset-0 h-full w-full cursor-none touch-none"
                                            onPointerDown={startDraw}
                                            onPointerMove={moveDraw}
                                            onPointerUp={stopDraw}
                                            onPointerCancel={stopDraw}
                                            onPointerEnter={(event) => updateBrushPreview(event)}
                                            onPointerLeave={() => {
                                                if (!drawingRef.current.active && !brushAdjustRef.current?.active) setBrushPreview(null);
                                            }}
                                            onContextMenu={(event) => event.preventDefault()}
                                        />
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>
                {brushPreview
                    ? createPortal(
                          <div
                              className={`pointer-events-none fixed z-[1100] rounded-full border-2 ${brushPreview.adjusting ? "border-[#fbbf24] bg-black/10" : "border-white/90 bg-black/5"} shadow-[0_0_0_1px_rgba(0,0,0,.8)]`}
                              style={{ left: brushPreview.x, top: brushPreview.y, width: Math.max(4, brushPreview.size * viewport.imageScale), aspectRatio: 1, transform: "translate(-50%, -50%)" }}
                          >
                              {brushPreview.adjusting ? <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">{brushSize}px</span> : null}
                          </div>,
                          document.body,
                      )
                    : null}

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">{t("canvas.maskEdit.title")}</h2>
                        <div className="mt-2 text-sm opacity-60">{image ? t("canvas.units.pixelDimensions", { value: formatDimensions(image.width, image.height) }) : t("canvas.common.reading")}</div>
                        <div className="mt-2 text-xs leading-5 opacity-55">{t("canvas.maskEdit.hint", { defaultValue: "在图片上涂抹需要修改的区域，可用空格拖动画布、滚轮缩放。" })}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type={mode === "paint" ? "primary" : "default"} icon={<Brush className="size-4" />} onClick={() => setMode("paint")}>
                            {t("canvas.maskEdit.paint")}
                        </Button>
                        <Button type={mode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setMode("erase")}>
                            {t("canvas.maskEdit.erase")}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-black/10 px-2 py-1 dark:border-white/10">
                        <Tooltip title={t("canvas.maskEdit.undoHint", { defaultValue: "撤销上一步涂抹" })}>
                            <Button type="text" icon={<Undo2 className="size-4" />} disabled={!historySize} aria-label={t("canvas.maskEdit.undo", { defaultValue: "撤销" })} onClick={undoMask} />
                        </Tooltip>
                        <Tooltip title={t("canvas.maskEdit.redoHint", { defaultValue: "重做上一步涂抹" })}>
                            <Button type="text" icon={<Redo2 className="size-4" />} disabled={!redoSize} aria-label={t("canvas.maskEdit.redo", { defaultValue: "重做" })} onClick={redoMask} />
                        </Tooltip>
                        <div className="flex items-center gap-1">
                            <Tooltip title={t("canvas.maskEdit.zoomOut", { defaultValue: "缩小" })}>
                                <Button type="text" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut} aria-label={t("canvas.maskEdit.zoomOut", { defaultValue: "缩小" })} onClick={viewport.zoomOut} />
                            </Tooltip>
                            <button type="button" className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Tooltip title={t("canvas.maskEdit.zoomIn", { defaultValue: "放大" })}>
                                <Button type="text" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn} aria-label={t("canvas.maskEdit.zoomIn", { defaultValue: "放大" })} onClick={viewport.zoomIn} />
                            </Tooltip>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">{t("canvas.maskEdit.brushSize")}</span>
                            <span className="font-semibold">{t("canvas.units.pixelValue", { value: formatNumber(brushSize) })}</span>
                        </div>
                        <Slider min={8} max={160} step={2} value={brushSize} onChange={setBrushSize} />
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">{t("canvas.maskEdit.request")}</div>
                        <Input.TextArea
                            rows={6}
                            value={prompt}
                            status={error && !prompt.trim() ? "error" : undefined}
                            placeholder={t("canvas.maskEdit.placeholder")}
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={resetMask}>
                            {t("canvas.actions.reset")}
                        </Button>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                {t("canvas.actions.cancel")}
                            </Button>
                            <Button icon={<ImagePlus className="size-4" />} onClick={() => submit(false)}>
                                {t("canvas.maskEdit.export", { defaultValue: "导出到画布" })}
                            </Button>
                            <Button type="primary" icon={<WandSparkles className="size-4" />} onClick={() => submit(true)}>
                                {t("canvas.maskEdit.generate", { defaultValue: "立即生成" })}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clampBrushSize(value: number) {
    return Math.min(160, Math.max(8, Math.round(value / 2) * 2));
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function configureStrokeContext(context: CanvasRenderingContext2D, stroke: MaskStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
}

function replayMask(strokes: MaskStroke[], maskCanvas: HTMLCanvasElement | null, previewCanvas: HTMLCanvasElement | null) {
    const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
    if (!maskCanvas || !context || !previewCanvas) return;
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    for (const stroke of strokes) {
        configureStrokeContext(context, stroke);
        stroke.points.forEach((point, index) => drawMaskStroke(context, stroke.points[index - 1] || point, point, stroke.size));
    }
    renderMaskPreview(maskCanvas, previewCanvas, canvasHasPaint(maskCanvas));
}

function renderMaskPreview(maskCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement | null, withBorder = false) {
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.fillStyle = maskFillColor;
    context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(context: CanvasRenderingContext2D, maskCanvas: HTMLCanvasElement) {
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskContext) return;
    const { width, height } = maskCanvas;
    const data = maskContext.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
    const dash = step * 8;
    const gap = step * 5;
    const period = dash + gap;

    context.save();
    context.fillStyle = maskBorderColor;
    context.shadowColor = "rgba(0, 0, 0, .24)";
    context.shadowBlur = step * 1.5;
    for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
            const offset = (y * width + x) * 4 + 3;
            if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
            if ((x + y) % period > dash) continue;
            context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
        }
    }
    context.restore();
}

function isMaskEdge(data: Uint8ClampedArray, width: number, x: number, y: number, step: number) {
    return data[((y - step) * width + x) * 4 + 3] === 0 || data[((y + step) * width + x) * 4 + 3] === 0 || data[(y * width + x - step) * 4 + 3] === 0 || data[(y * width + x + step) * 4 + 3] === 0;
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function buildMaskOverlay(image: HTMLImageElement, selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return selectionCanvas.toDataURL("image/png");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const overlay = document.createElement("canvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return canvas.toDataURL("image/png");
    overlayContext.drawImage(selectionCanvas, 0, 0);
    overlayContext.globalCompositeOperation = "source-in";
    overlayContext.fillStyle = maskOverlayColor;
    overlayContext.fillRect(0, 0, overlay.width, overlay.height);
    context.globalAlpha = maskOverlayAlpha;
    context.drawImage(overlay, 0, 0);
    return canvas.toDataURL("image/png");
}


function buildEditMask(selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return selectionCanvas.toDataURL("image/png");
    const selectionContext = selectionCanvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!selectionContext) return canvas.toDataURL("image/png");
    const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < mask.data.length; index += 4) {
        if (selection.data[index] > 0) mask.data[index] = 0;
    }
    context.putImageData(mask, 0, 0);
    return canvas.toDataURL("image/png");
}

type ImageSize = { width: number; height: number };

const minZoom = 1;
const maxZoom = 4;
const zoomStep = 1.2;
const viewportPadding = 16;

function useImageEditorViewport(image: ImageSize | null, open: boolean) {
    const viewportNodeRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
    const zoomAnchorRef = useRef<{ zoom: number; ratioX: number; ratioY: number; viewportX: number; viewportY: number } | null>(null);
    const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
    const [viewportSize, setViewportSize] = useState<ImageSize>({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(minZoom);
    const [isPanning, setIsPanning] = useState(false);
    const [spacePressed, setSpacePressed] = useState(false);
    const spacePressedRef = useRef(false);
    const viewportRef = useCallback((node: HTMLDivElement | null) => {
        viewportNodeRef.current = node;
        setViewportElement(node);
    }, []);

    useEffect(() => {
        if (!open) return;
        zoomAnchorRef.current = null;
        setZoom(minZoom);
    }, [open, image?.width, image?.height]);

    useEffect(() => {
        if (!open) return;
        const releaseSpace = () => {
            spacePressedRef.current = false;
            setSpacePressed(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.repeat) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (document.activeElement instanceof HTMLElement && document.activeElement.matches("button,a,[role='button']")) document.activeElement.blur();
            spacePressedRef.current = true;
            setSpacePressed(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space" || !spacePressedRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            releaseSpace();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", releaseSpace);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", releaseSpace);
            spacePressedRef.current = false;
        };
    }, [open]);

    useEffect(() => {
        if (!open || !viewportElement) return;
        const updateSize = () => {
            const width = viewportElement.clientWidth;
            const height = viewportElement.clientHeight;
            setViewportSize((current) => (current.width === width && current.height === height ? current : { width, height }));
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(viewportElement);
        return () => observer.disconnect();
    }, [open, viewportElement]);

    const baseSize = fitImage(image, viewportSize);
    const stageSize = { width: baseSize.width * zoom, height: baseSize.height * zoom };
    const contentSize = {
        width: Math.max(viewportSize.width, stageSize.width),
        height: Math.max(viewportSize.height, stageSize.height),
    };
    const stageOffset = {
        left: Math.max(0, Math.round((contentSize.width - stageSize.width) / 2)),
        top: Math.max(0, Math.round((contentSize.height - stageSize.height) / 2)),
    };

    useLayoutEffect(() => {
        const viewport = viewportNodeRef.current;
        const anchor = zoomAnchorRef.current;
        if (!viewport || !anchor || Math.abs(anchor.zoom - zoom) > 0.001) return;
        const nextWidth = baseSize.width * zoom;
        const nextHeight = baseSize.height * zoom;
        const nextLeft = Math.max(0, (Math.max(viewport.clientWidth, nextWidth) - nextWidth) / 2);
        const nextTop = Math.max(0, (Math.max(viewport.clientHeight, nextHeight) - nextHeight) / 2);
        viewport.scrollLeft = nextLeft + anchor.ratioX * nextWidth - anchor.viewportX;
        viewport.scrollTop = nextTop + anchor.ratioY * nextHeight - anchor.viewportY;
        zoomAnchorRef.current = null;
    }, [baseSize.height, baseSize.width, zoom]);

    const setZoomAround = useCallback(
        (nextZoom: number, clientX?: number, clientY?: number) => {
            const viewport = viewportNodeRef.current;
            const stage = stageRef.current;
            const boundedZoom = clamp(nextZoom, minZoom, maxZoom);
            if (Math.abs(boundedZoom - zoom) < 0.001) return;
            if (!viewport || !stage || !baseSize.width || !baseSize.height) {
                setZoom(boundedZoom);
                return;
            }

            const viewportRect = viewport.getBoundingClientRect();
            const stageRect = stage.getBoundingClientRect();
            const pointerX = clientX ?? viewportRect.left + viewportRect.width / 2;
            const pointerY = clientY ?? viewportRect.top + viewportRect.height / 2;
            const ratioX = clamp((pointerX - stageRect.left) / Math.max(1, stageRect.width), 0, 1);
            const ratioY = clamp((pointerY - stageRect.top) / Math.max(1, stageRect.height), 0, 1);
            const viewportX = pointerX - viewportRect.left;
            const viewportY = pointerY - viewportRect.top;

            zoomAnchorRef.current = { zoom: boundedZoom, ratioX, ratioY, viewportX, viewportY };
            setZoom(boundedZoom);
        },
        [baseSize.height, baseSize.width, zoom],
    );

    useEffect(() => {
        if (!open || !viewportElement) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setZoomAround(event.deltaY < 0 ? zoom * zoomStep : zoom / zoomStep, event.clientX, event.clientY);
        };
        viewportElement.addEventListener("wheel", handleWheel, { passive: false });
        return () => viewportElement.removeEventListener("wheel", handleWheel);
    }, [open, setZoomAround, viewportElement, zoom]);

    const startPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 1 && !(event.button === 0 && spacePressedRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        const viewport = event.currentTarget;
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
        setIsPanning(true);
    }, []);
    const movePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = panRef.current;
        if (!pan || event.pointerId !== pan.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
        event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.y);
    }, []);
    const stopPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = panRef.current;
        if (!pan || event.pointerId !== pan.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        panRef.current = null;
        setIsPanning(false);
    }, []);
    const preventAuxClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    return {
        viewportRef,
        stageRef,
        zoom,
        isPanning,
        spacePressed,
        scrollClassName: zoom > minZoom + 0.001 ? "overflow-scroll" : "overflow-hidden",
        panHandlers: {
            onPointerDownCapture: startPan,
            onPointerMoveCapture: movePan,
            onPointerUpCapture: stopPan,
            onPointerCancelCapture: stopPan,
            onAuxClick: preventAuxClick,
        },
        canZoomIn: zoom < maxZoom,
        canZoomOut: zoom > minZoom,
        imageScale: image ? stageSize.width / image.width : 0,
        zoomIn: () => setZoomAround(zoom * zoomStep),
        zoomOut: () => setZoomAround(zoom / zoomStep),
        resetZoom: () => setZoomAround(minZoom),
        contentStyle: { width: contentSize.width, height: contentSize.height } satisfies CSSProperties,
        stageStyle: {
            left: stageOffset.left,
            top: stageOffset.top,
            width: stageSize.width,
            height: stageSize.height,
        } satisfies CSSProperties,
        mediaStyle: {
            width: baseSize.width,
            height: baseSize.height,
            transform: `translateZ(0) scale(${zoom})`,
            transformOrigin: "top left",
        } satisfies CSSProperties,
    };
}

function fitImage(image: ImageSize | null, viewport: ImageSize): ImageSize {
    if (!image || !viewport.width || !viewport.height) return { width: 0, height: 0 };
    const availableWidth = Math.max(1, viewport.width - viewportPadding * 2);
    const availableHeight = Math.max(1, viewport.height - viewportPadding * 2);
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height, 1);
    return { width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(image.height * scale)) };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
