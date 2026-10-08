"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/pages/canvas/components/asset-picker-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { accountStoreName } from "@/lib/account-storage";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { pollAsyncImageTask } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/blob-storage";
import { uploadBlob, uploadUrlToS3 } from "@/services/upload-blob";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { patchGenerationTaskMetadata } from "@/services/api/generation-tasks";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import { fetchImageHistory, deleteGenerationTask, recordGenerationTask, type ImageHistoryItem } from "@/services/api/generation-tasks";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { formatDateTime, formatDimensions, formatNumber } from "@/i18n/formatters";
import {
    completeImageWorkbenchTask,
    cancelImageWorkbenchTask,
    createImageWorkbenchTask,
    imageWorkbenchReference,
    imageWorkbenchDeletionIds,
    imageWorkbenchTaskStatusForError,
    imageWorkbenchTaskRecord,
    resumableImageWorkbenchTasks,
    restoreImageWorkbenchSlots,
    upsertImageWorkbenchTaskRecord,
    type ImageWorkbenchTask,
    type ImageWorkbenchTaskRecord,
} from "./image-async-task";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    fileId?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    slotIndex?: number;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "pending" | "success" | "failed";
    error?: string;
    images: GeneratedImage[];
    thumbnails: string[];
    tasks?: ImageWorkbenchTaskRecord[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "background" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";

function logStoreForUser() {
    const user = useUserStore.getState().user;
    const userId = user?.id || "anonymous";
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("image_generation_logs", userId) });
}

export function getImageWorkbenchGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export default function ImagePage() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageTasksRef = useRef<Map<string, { controller: AbortController; task?: ImageWorkbenchTask }>>(new Map());
    const cancellationRef = useRef(new Set<string>());
    const unmountingRef = useRef(false);
    const workbenchLogsRef = useRef(new Map<string, GenerationLog>());
    const refreshLogsRef = useRef<() => void>(() => {});
    const activeLogIdRef = useRef<string | null>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = getImageWorkbenchGenerationCount(config.count);

    const rememberLog = (log: GenerationLog) => {
        workbenchLogsRef.current.set(log.id, log);
        setLogs((value) => (value.some((item) => item.id === log.id) ? value.map((item) => (item.id === log.id ? log : item)) : [log, ...value]));
    };

    const replaceLogs = (nextLogs: GenerationLog[]) => {
        workbenchLogsRef.current.clear();
        nextLogs.forEach((log) => workbenchLogsRef.current.set(log.id, log));
        setLogs(nextLogs);
    };

    const patchLog = (id: string, update: (log: GenerationLog) => GenerationLog) => {
        const current = workbenchLogsRef.current.get(id);
        if (!current) return null;
        const next = update(current);
        rememberLog(next);
        return next;
    };

    const updateSlot = (logId: string, index: number, recordPatch: Partial<ImageWorkbenchTaskRecord>, image?: GeneratedImage) =>
        patchLog(logId, (current) => {
            const currentTask = current.tasks?.find((task) => task.index === index);
            const nextTask = {
                ...(currentTask || { index, source: "image_workbench" as const, status: "pending" as const }),
                ...recordPatch,
            } as ImageWorkbenchTaskRecord;
            const tasks = upsertImageWorkbenchTaskRecord(current.tasks || [], nextTask);
            const images = image ? [...current.images.filter((item) => item.slotIndex !== index), { ...image, slotIndex: index }].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0)) : current.images;
            const successCount = tasks.filter((task) => task.status === "succeeded").length;
            const failCount = tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length;
            const hasPending = tasks.some((task) => task.status === "pending");
            const hasErrorPatch = Object.prototype.hasOwnProperty.call(recordPatch, "error");
            return {
                ...current,
                tasks,
                images,
                thumbnails: images.map((item) => item.dataUrl).filter(Boolean),
                successCount,
                failCount,
                status: hasPending ? "pending" : successCount ? "success" : "failed",
                error: hasErrorPatch ? recordPatch.error : hasPending ? current.error : undefined,
            };
        });

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        unmountingRef.current = false;
        return () => {
            unmountingRef.current = true;
            for (const { controller } of imageTasksRef.current.values()) controller.abort();
        };
    }, []);

    const configHydrated = useConfigStore((state) => state.configHydrated);

    useEffect(() => {
        syncClient.onDelta("tasks", () => refreshLogsRef.current());
        return () => {
            refreshLogsRef.current = () => {};
        };
    }, []);

    useEffect(() => {
        if (!configHydrated) return;
        const checkAndRefresh = () => {
            const { isReady } = useUserStore.getState();
            if (isReady) {
                void refreshLogs();
            } else {
                const unsub = useUserStore.subscribe((state) => {
                    if (state.isReady) {
                        unsub();
                        void refreshLogs();
                    }
                });
                return () => unsub();
            }
        };
        return checkAndRefresh();
    }, [configHydrated]);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const dataUrl = URL.createObjectURL(file);
                const image = await uploadBlob(file, "images");
                return imageWorkbenchReference({ id: nanoid(), name: file.name, type: image.mimeType, dataUrl, fileId: image.fileId });
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.references.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const dataUrl = URL.createObjectURL(blob);
                    const image = await uploadBlob(blob, "images");
                    return imageWorkbenchReference({
                        id: nanoid(),
                        name: t("imageWorkbench.references.clipboardFileName", { index: formatNumber(index + 1, { useGrouping: false }) }),
                        type: image.mimeType,
                        dataUrl,
                        fileId: image.fileId,
                    });
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(t("imageWorkbench.references.clipboardRead", { count: nextReferences.length, value: formatNumber(nextReferences.length) }));
        } catch {
            message.error(t("imageWorkbench.references.clipboardEmpty"));
        }
    };

    const generate = async () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.prompt.required"));
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("imageWorkbench.configRequired"));
            openConfigDialog(true);
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;

        setElapsedMs(0);
        setRunning(true);
        syncScheduler.onRunningTaskCountChange(1);
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        // Keep one durable batch record while each output owns its async task.
        const pendingLog = buildLog({
            prompt: text,
            model,
            config: { ...snapshot.config, count: String(generationCount) },
            references: snapshot.references,
            durationMs: 0,
            successCount: 0,
            failCount: 0,
            status: "pending",
            images: [],
            tasks: Array.from({ length: generationCount }, (_, index) => ({
                index,
                source: "image_workbench",
                taskModel: model,
                status: "pending" as const,
            })),
        });
        activeLogIdRef.current = pendingLog.id;
        await saveLog(pendingLog, false).catch(() => {});

        const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot, { logId: pendingLog.id }));

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const errorMessage = failed?.reason instanceof Error ? failed.reason.message : t("errors.image.generationFailed");

        try {
            const currentLog = workbenchLogsRef.current.get(pendingLog.id) || pendingLog;
            const successCount = currentLog.tasks?.filter((task) => task.status === "succeeded").length ?? successImages.length;
            const failCount = currentLog.tasks?.filter((task) => task.status === "failed" || task.status === "cancelled").length ?? generationCount - successCount;
            const hasPending = currentLog.tasks?.some((task) => task.status === "pending") ?? false;
            const finalLog: GenerationLog = {
                ...currentLog,
                durationMs: performance.now() - batchStartedAt,
                successCount,
                failCount,
                status: hasPending ? "pending" : successCount ? "success" : "failed",
                images: currentLog.images.length ? currentLog.images : successImages,
                thumbnails: (currentLog.images.length ? currentLog.images : successImages).map((image) => image.dataUrl).filter(Boolean),
            };
            finalLog.error = hasPending ? currentLog.error || errorMessage : successCount ? undefined : errorMessage;
            try {
                await saveLog(finalLog, finalLog.status !== "pending");
            } catch {
                // ponytail: saveLog failure shouldn't block the generation result
            }
            if (finalLog.status === "success") message.success(t("imageWorkbench.results.generated"));
            if (finalLog.status === "failed") message.error(errorMessage);
        } finally {
            setRunning(false);
            syncScheduler.onRunningTaskCountChange(0);
        }
    };

    const downloadImage = async (image: GeneratedImage, index: number) => {
        let url = image.dataUrl;
        if (image.fileId) {
            const urlMap = await resolveFileUrls([image.fileId]);
            if (urlMap.has(image.fileId)) url = urlMap.get(image.fileId)!;
        }
        saveAs(url, t("imageWorkbench.results.downloadFileName", { index: formatNumber(index + 1, { useGrouping: false }) }));
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        let dataUrl = image.dataUrl;
        if (image.fileId) {
            const urlMap = await resolveFileUrls([image.fileId]);
            dataUrl = urlMap.get(image.fileId) || dataUrl;
        }
        if (image.fileId) {
            setReferences((value) => [
                ...value,
                imageWorkbenchReference({
                    id: nanoid(),
                    name: t("imageWorkbench.references.resultFileName", { index: formatNumber(index + 1, { useGrouping: false }) }),
                    type: image.mimeType || "image/png",
                    dataUrl,
                    fileId: image.fileId,
                }),
            ]);
        } else {
            const stored = await uploadImage(dataUrl);
            setReferences((value) => [
                ...value,
                imageWorkbenchReference({
                    id: nanoid(),
                    name: t("imageWorkbench.references.resultFileName", { index: formatNumber(index + 1, { useGrouping: false }) }),
                    type: stored.mimeType,
                    dataUrl: stored.url,
                    storageKey: stored.storageKey,
                }),
            ]);
        }
        message.success(t("imageWorkbench.references.added"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        let dataUrl = image.dataUrl;
        if (image.fileId) {
            const urlMap = await resolveFileUrls([image.fileId]);
            if (urlMap.has(image.fileId)) dataUrl = urlMap.get(image.fileId)!;
        }
        // Already stored in S3 — reuse fileId directly
        if (image.fileId && dataUrl) {
            try {
                await addAsset({
                    kind: "image",
                    title: t("imageWorkbench.assets.generatedTitle", { index: formatNumber(index + 1, { useGrouping: false }) }),
                    coverUrl: dataUrl,
                    tags: [],
                    source: t("imageWorkbench.assets.source"),
                    data: { dataUrl, fileId: image.fileId, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/png" },
                    metadata: { source: "image-page", prompt },
                });
                message.success(t("imageWorkbench.assets.saved"));
            } catch {
                message.error(t("imageWorkbench.assets.saveFailed"));
            }
            return;
        }
        const blob = await (await fetch(image.dataUrl)).blob();
        const stored = await uploadBlob(blob, "results/images");
        try {
            await addAsset({
                kind: "image",
                title: t("imageWorkbench.assets.generatedTitle", { index: formatNumber(index + 1, { useGrouping: false }) }),
                coverUrl: stored.url,
                tags: [],
                source: t("imageWorkbench.assets.source"),
                data: { dataUrl: stored.url, fileId: stored.fileId, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "image-page", prompt },
            });
            message.success(t("imageWorkbench.assets.saved"));
        } catch {
            message.error(t("imageWorkbench.assets.saveFailed"));
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            setReferences((value) => [
                ...value,
                imageWorkbenchReference({
                    id: nanoid(),
                    name: payload.title,
                    type: "image/png",
                    dataUrl: payload.dataUrl,
                    fileId: payload.fileId,
                    storageKey: payload.storageKey,
                }),
            ]);
        } else {
            message.warning(t("imageWorkbench.assets.unsupportedType"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        activeLogIdRef.current = null;
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = async () => {
        const ids = [...selectedLogIds];
        const selectedLogs = logs.filter((log) => selectedLogIds.includes(log.id));
        const imageKeys = selectedLogs.flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        const generationTaskIds = [...new Set(selectedLogs.flatMap(imageWorkbenchDeletionIds))];
        await Promise.all([deleteStoredImages(imageKeys), ...ids.map((id) => logStoreForUser().removeItem(id)), ...generationTaskIds.map((id) => deleteGenerationTask(id).catch(() => {}))]);
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        await refreshLogs();
    };

    const saveLog = async (log: GenerationLog, refresh = true): Promise<void> => {
        // Save to local cache first
        rememberLog(log);
        await logStoreForUser().setItem(log.id, serializeLog(log));
        if (refresh) await refreshLogs();
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            for (const { record, task } of resumableImageWorkbenchTasks(log.tasks || [])) {
                const key = `${log.id}:${record.index}`;
                if (imageTasksRef.current.has(key)) continue;
                const taskConfig = {
                    ...effectiveConfig,
                    ...log.config,
                    model: task.upstreamTask.model,
                    imageModel: task.upstreamTask.model,
                    count: "1",
                };
                void runGenerationSlot(record.index, { text: log.prompt, config: taskConfig, references: log.references || [] }, { logId: log.id, task, key }).catch(() => {});
            }
        }
    };

    const refreshLogs = async () => {
        const localLogs = await readStoredLogs();
        const user = useUserStore.getState().user;
        if (user?.id) {
            try {
                const result = await fetchImageHistory(1, 50, "image_workbench");
                const backendLogs = result.items.map(toGenerationLog);
                const allFileIds = backendLogs.flatMap((log) => log.images.map((img) => img.fileId).filter((id): id is string => Boolean(id)));
                const urlMap = allFileIds.length ? await resolveFileUrls([...new Set(allFileIds)]) : new Map<string, string>();
                for (const log of backendLogs) {
                    for (const img of log.images) {
                        if (img.fileId && urlMap.has(img.fileId)) img.dataUrl = urlMap.get(img.fileId)!;
                    }
                }

                const durableLogs = localLogs.filter((log) => log.tasks?.length);
                const platformTaskIds = new Set(durableLogs.flatMap((log) => (log.tasks || []).map((task) => task.platformTaskId).filter((id): id is string => Boolean(id))));
                const mergedLogs = [...durableLogs, ...backendLogs.filter((log) => !platformTaskIds.has(log.id))].sort((a, b) => b.createdAt - a.createdAt);
                replaceLogs(mergedLogs);
                for (const log of backendLogs) {
                    await logStoreForUser().setItem(log.id, serializeLog(log));
                }
                resumePendingLogs(mergedLogs);
                return;
            } catch {
                // Fallback to local cache
            }
        }
        replaceLogs(localLogs);
        resumePendingLogs(localLogs);
    };

    refreshLogsRef.current = () => {
        void refreshLogs();
    };

    function toGenerationLog(item: ImageHistoryItem): GenerationLog {
        const isSuccess = item.status === "success";
        const isPending = item.status === "pending";
        const images = item.fileIds?.length
            ? item.fileIds.map((fileId) => ({
                  id: fileId,
                  dataUrl: "",
                  fileId,
                  durationMs: item.durationMs,
                  width: 1024,
                  height: 1024,
                  bytes: 0,
              }))
            : item.imageUrls?.map((url) => ({
                  id: nanoid(),
                  dataUrl: url,
                  durationMs: item.durationMs,
                  width: 1024,
                  height: 1024,
                  bytes: 0,
              })) || [];
        return {
            id: item.id,
            createdAt: new Date(item.createdAt).getTime(),
            title: item.title,
            prompt: item.prompt,
            model: item.model,
            config: {
                model: item.model,
                imageModel: item.model || "",
                quality: item.quality || "",
                size: item.size || "",
                background: "",
                count: item.count || "1",
            },
            references: [],
            images,
            thumbnails: images.map((img) => img.dataUrl).filter(Boolean),
            durationMs: item.durationMs,
            successCount: isSuccess ? 1 : 0,
            failCount: isSuccess || isPending ? 0 : 1,
            imageCount: images.length || 1,
            size: item.size || "",
            quality: item.quality || "",
            status: item.status === "success" ? "success" : item.status === "failed" ? "failed" : "pending",
            error: item.error,
        };
    }

    const previewGenerationLog = async (log: GenerationLog) => {
        activeLogIdRef.current = log.id;
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        updateConfig("background", log.config.background);
        if (log.config.count) updateConfig("count", log.config.count);
        const restoredSlots = restoreImageWorkbenchSlots(log.tasks || [], log.images);
        setResults(
            restoredSlots.length
                ? restoredSlots.map((slot) => ({
                      id: slot.image?.id || `${log.id}:${slot.index}`,
                      status: slot.status,
                      ...(slot.image ? { image: slot.image } : {}),
                      ...(slot.error ? { error: slot.error } : {}),
                  }))
                : log.images.map((image) => ({ id: image.id, status: "success", image })),
        );
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.prompt.required"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("imageWorkbench.configRequired"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const syncLocalWorkbenchTask = async (task: ImageWorkbenchTask, snapshot: { text: string; config: AiConfig }, status: "pending" | "success" | "failed" | "cancelled", result?: { url: string; fileId?: string }, errorMessage = "") => {
        if (snapshot.config.channelMode === "remote" || !useUserStore.getState().user?.id) return task;
        try {
            const recorded = await recordGenerationTask({
                taskType: "image",
                provider: "openai",
                model: task.upstreamTask.model,
                status,
                credits: "0",
                latencyMs: 0,
                upstreamTaskId: task.upstreamTask.id,
                source: "image_workbench",
                requestBody: JSON.stringify({
                    prompt: snapshot.text,
                    model: task.upstreamTask.model,
                    size: snapshot.config.size,
                    quality: snapshot.config.quality,
                    count: "1",
                }),
                responseBody: result ? JSON.stringify({ data: [{ url: result.url }] }) : "",
                metadata: result?.fileId ? JSON.stringify({ fileIds: [result.fileId] }) : "",
                errorMessage,
            });
            return recorded?.id && !task.platformTaskId ? { ...task, platformTaskId: recorded.id } : task;
        } catch {
            return task;
        }
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, context: { logId?: string; task?: ImageWorkbenchTask; key?: string } = {}) => {
        const itemStartedAt = performance.now();
        const key = context.key || `${context.logId || "session"}:${index}:${nanoid()}`;
        const controller = new AbortController();
        let task = context.task;
        imageTasksRef.current.set(key, { controller, task });
        try {
            task ||= await createImageWorkbenchTask(snapshot.config, snapshot.text, snapshot.references);
            task = await syncLocalWorkbenchTask(task, snapshot, "pending");
            imageTasksRef.current.set(key, { controller, task });
            if (context.logId) {
                const taskRecord = imageWorkbenchTaskRecord(index, task);
                const updated = updateSlot(context.logId, index, { ...taskRecord, status: "pending", error: undefined });
                if (updated) await saveLog(updated, false).catch(() => {});
            }

            const activeTask = task;
            const stored = await completeImageWorkbenchTask(activeTask, {
                poll: () => pollAsyncImageTask(snapshot.config, activeTask.upstreamTask, { signal: controller.signal }),
                materialize: (dataUrl) =>
                    dataUrl.startsWith("data:")
                        ? fetch(dataUrl)
                              .then((response) => response.blob())
                              .then((blob) => uploadBlob(blob, "results/images"))
                        : uploadUrlToS3(dataUrl, "results/images"),
                patchMetadata: patchGenerationTaskMetadata,
                cancel: (taskToCancel) => (unmountingRef.current ? Promise.resolve() : cancelImageWorkbenchTask(snapshot.config, taskToCancel)),
                signal: controller.signal,
            });
            await syncLocalWorkbenchTask(activeTask, snapshot, "success", stored);
            const nextImage: GeneratedImage = {
                id: stored.fileId,
                dataUrl: stored.url,
                fileId: stored.fileId,
                durationMs: performance.now() - itemStartedAt,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                slotIndex: index,
            };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            const updated = context.logId ? updateSlot(context.logId, index, { status: "succeeded", fileId: stored.fileId, error: undefined }, nextImage) : null;
            if (updated) await saveLog(updated, false).catch(() => {});
            return nextImage;
        } catch (error) {
            const explicitCancellation = cancellationRef.current.has(key);
            const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
            const taskStatus = imageWorkbenchTaskStatusForError(error, explicitCancellation);
            const errorMessage = aborted ? t("errors.requestCancelled") : error instanceof Error ? error.message : t("errors.image.generationFailed");
            if (task && (!controller.signal.aborted || explicitCancellation) && taskStatus !== "pending") {
                await syncLocalWorkbenchTask(task, snapshot, taskStatus, undefined, errorMessage);
            }
            if (context.logId && (!controller.signal.aborted || explicitCancellation)) {
                const updated = updateSlot(context.logId, index, { status: taskStatus, error: errorMessage });
                if (updated) await saveLog(updated, false).catch(() => {});
            }
            if (!unmountingRef.current || explicitCancellation) {
                setResults((value) => updateResultAt(value, index, { status: taskStatus === "pending" ? "pending" : "failed", error: errorMessage }));
            }
            throw error;
        } finally {
            imageTasksRef.current.delete(key);
            cancellationRef.current.delete(key);
        }
    };

    const cancelGeneration = () => {
        for (const [key, { controller }] of imageTasksRef.current) {
            cancellationRef.current.add(key);
            controller.abort();
        }
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        const logId = activeLogIdRef.current || previewLog?.id;
        setRunning(true);
        syncScheduler.onRunningTaskCountChange(1);
        setStartedAt(performance.now());
        setElapsedMs(0);
        setPreviewLog(null);
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        if (logId) {
            const updated = updateSlot(logId, index, {
                status: "pending",
                upstreamTaskId: undefined,
                taskModel: undefined,
                platformTaskId: undefined,
                images: undefined,
                fileId: undefined,
                error: undefined,
            });
            if (updated) await saveLog(updated, false).catch(() => {});
        }
        void runGenerationSlot(index, snapshot, logId ? { logId } : {})
            .catch(() => {})
            .finally(() => {
                setRunning(false);
                syncScheduler.onRunningTaskCountChange(0);
            });
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-foreground">{t("imageWorkbench.title")}</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        {t("imageWorkbench.mobile.logs")}
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        {t("imageWorkbench.parameters")}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.prompt.label")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("imageWorkbench.prompt.openLibrary")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("imageWorkbench.prompt.openAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.prompt.placeholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.references.title")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("imageWorkbench.references.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("common.actions.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain"
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label={t("imageWorkbench.references.remove")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">{t("imageWorkbench.references.empty")}</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm sm:hidden">
                                <span className="truncate text-muted-foreground">
                                    {modelOptionLabel(effectiveConfig, model)} · {imageSizeLabel(effectiveConfig.size)} · {imageQualityLabel(effectiveConfig.quality)}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("imageWorkbench.actions.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                disabled={!canGenerate && !running}
                                onClick={() => (running ? cancelGeneration() : void generate())}
                            >
                                {running ? t("common.actions.cancel") : t("imageWorkbench.actions.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold">{t("imageWorkbench.results.title")}</h2>
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">{t("imageWorkbench.results.waiting", { duration: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("errors.image.generationFailed")} onRetry={() => retryResult(index)} />
                                    ) : (
                                        <PendingImageCard key={result.id} error={result.error} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-center lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-muted-foreground" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.results.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("imageWorkbench.logs.title")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer title={t("imageWorkbench.parameters")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal
                title={t("imageWorkbench.logs.deleteTitle")}
                open={deleteConfirmOpen}
                onCancel={() => setDeleteConfirmOpen(false)}
                onOk={deleteSelectedLogs}
                okText={t("common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.actions.cancel")}
            >
                {t("imageWorkbench.logs.deleteConfirm", { count: selectedLogIds.length, value: formatNumber(selectedLogIds.length) })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("imageWorkbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={{ ...config, model }} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={15} />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="overflow-hidden rounded-lg border bg-background">
            <Image src={image.dataUrl} alt={t("imageWorkbench.results.alt", { index: formatNumber(index + 1, { useGrouping: false }) })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t px-3 py-2.5">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDimensions(image.width, image.height)}</span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={t("imageWorkbench.actions.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("imageWorkbench.actions.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.actions.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.actions.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.actions.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.actions.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ error }: { error?: string }) {
    const { t } = useTranslation();

    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed bg-muted/50">
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: "radial-gradient(circle, currentColor 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                    opacity: 0.18,
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                {error ? null : <LoaderCircle className="size-6 animate-spin" />}
                <span role={error ? "alert" : undefined} className="px-4 text-center">
                    {error || t("imageWorkbench.results.pending")}
                </span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();

    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("imageWorkbench.results.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("imageWorkbench.actions.retry")}
                </Button>
            </div>
        </div>
    );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("imageWorkbench.logs.title")}</h2>
                </div>
                <Tag className="m-0">{formatNumber(logs.length)}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("imageWorkbench.actions.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("imageWorkbench.actions.deselectAll") : t("imageWorkbench.actions.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.actions.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">{t("imageWorkbench.logs.empty")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
    const title = log.title || t("imageWorkbench.logs.untitled");
    const statusColor = log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red";

    return (
        <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-foreground bg-accent" : "border bg-background hover:bg-accent/50"}`} onClick={onClick}>
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox aria-label={t("imageWorkbench.logs.select", { title })} className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={statusColor}>
                        {t(`imageWorkbench.logs.status.${log.status}`)}
                    </Tag>
                    {log.status !== "pending" ? (
                        <div className="flex gap-1">
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                                {t("imageWorkbench.logs.successCount", { count: log.successCount ?? log.imageCount, value: formatNumber(log.successCount ?? log.imageCount) })}
                            </Tag>
                            {log.failCount ? (
                                <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                    {t("imageWorkbench.logs.failedCount", { count: log.failCount, value: formatNumber(log.failCount) })}
                                </Tag>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("imageSettings.imageCount", { count: log.imageCount, value: formatNumber(log.imageCount) })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{formatDateTime(log.createdAt)}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStoreForUser().iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const fileIds = [...(log.images || []), ...(log.references || [])].map((item) => item.fileId).filter((id): id is string => Boolean(id));
    const urlMap = fileIds.length ? await resolveFileUrls([...new Set(fileIds)]) : new Map<string, string>();

    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: item.fileId && urlMap.has(item.fileId) ? urlMap.get(item.fileId)! : await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: item.fileId && urlMap.has(item.fileId) ? urlMap.get(item.fileId)! : await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeImageWorkbenchLogConfig(log);
    const tasks = log.tasks?.map((task) => ({ ...task }));
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "",
        prompt: log.prompt || log.title || "",
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? tasks?.filter((task) => task.status === "succeeded").length ?? log.imageCount ?? 0,
        failCount: log.failCount ?? tasks?.filter((task) => task.status === "failed").length ?? 0,
        imageCount: log.imageCount || Number(config.count) || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        error: log.error,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        tasks,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.fileId || item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.fileId || image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

export function normalizeImageWorkbenchLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        background: log.config?.background === "transparent" ? "transparent" : "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    const { t } = useTranslation();
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button aria-label={t("imageWorkbench.references.movePrevious")} size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button
                aria-label={t("imageWorkbench.references.moveNext")}
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
        </div>
    );
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    tasks,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    tasks?: ImageWorkbenchTaskRecord[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        background: config.background,
        count: config.count,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12),
        prompt,
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        tasks,
    };
}
