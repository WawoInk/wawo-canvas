"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Play, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/pages/canvas/components/asset-picker-modal";
import { LazyVideo } from "@/components/lazy-media";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { accountStoreName } from "@/lib/account-storage";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { getVideoPoster } from "@/lib/video-poster";
import { boolConfig, normalizeSeedanceRatio, seedanceReferenceLabel, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, uploadMediaFile, resolveImageUrl, uploadImage } from "@/services/blob-storage";
import { uploadBlob, uploadUrlToS3 } from "@/services/upload-blob";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { patchGenerationTaskMetadata, recordGenerationTask } from "@/services/api/generation-tasks";
import { cancelVideoGenerationTask, createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { fetchVideoHistory, deleteGenerationTask, type VideoHistoryItem } from "@/services/api/generation-tasks";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey?: string;
    fileId?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "channelMode">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";

function logStoreForUser() {
    const user = useUserStore.getState().user;
    const userId = user?.id || "anonymous";
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("video_generation_logs", userId) });
}

// ponytail: module-level bridge between syncClient (singleton) and component (closure-scoped refreshLogs)
let refreshLogsHandler: (() => void) | null = null;
syncClient.onDelta("tasks", () => {
    if (refreshLogsHandler) refreshLogsHandler();
});

export default function VideoPage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const configHydrated = useConfigStore((state) => state.configHydrated);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
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

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean((prompt ?? "").trim());

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        // ponytail: re-register onDelta on mount so whichever page loaded last wins
        syncClient.onDelta("tasks", () => {
            if (refreshLogsHandler) refreshLogsHandler();
        });
        refreshLogsHandler = () => {
            void refreshLogs();
        };
        return () => {
            refreshLogsHandler = null;
        };
    }, []);

    useEffect(() => {
        if (!configHydrated) return;
        // Wait for user store to be ready (token may be hydrated but user not yet fetched)
        const checkAndRefresh = () => {
            const user = useUserStore.getState().user;
            const isReady = useUserStore.getState().isReady;
            if (isReady) {
                void refreshLogs();
            } else {
                // User not yet hydrated, wait for it
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
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考素材，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning("已忽略超过 50MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const dataUrl = URL.createObjectURL(file);
                const image = await uploadBlob(file, "images");
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl, url: image.url, storageKey: image.fileId };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadBlob(file, "videos");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadBlob(file, "audios");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, durationMs: audio.durationMs };
                }),
            ),
            message.warning,
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const dataUrl = URL.createObjectURL(blob);
                    const image = await uploadBlob(blob, "images");
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl, url: image.url, storageKey: image.fileId };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };
    const generate = async () => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setElapsedMs(0);
        setRunning(true);
        syncScheduler.onRunningTaskCountChange(1);
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: 0, status: "生成中", task });
            await saveLog(log);
            void pollGenerationLog(log, snapshot.config);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            await saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    videoReferences: snapshot.videoReferences,
                    audioReferences: snapshot.audioReferences,
                    durationMs: performance.now() - batchStartedAt,
                    status: "失败",
                    error: errorMessage,
                }),
            );
            message.error(errorMessage);
            setRunning(false);
            syncScheduler.onRunningTaskCountChange(0);
        }
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入视频提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = async (video: GeneratedVideo) => {
        let url = video.url;
        if (video.fileId) {
            const urlMap = await resolveFileUrls([video.fileId]);
            if (urlMap.has(video.fileId)) url = urlMap.get(video.fileId)!;
        }
        saveAs(url, "video.mp4");
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        let url = video.url;
        if (video.fileId) {
            const urlMap = await resolveFileUrls([video.fileId]);
            if (urlMap.has(video.fileId)) url = urlMap.get(video.fileId)!;
        }
        if (video.fileId && url) {
            try {
                await addAsset({
                    kind: "video",
                    title: "生成视频",
                    coverUrl: url,
                    tags: [],
                    source: "视频创作台",
                    data: { url, fileId: video.fileId, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                    metadata: { source: "video-page", prompt },
                });
                message.success("已加入我的素材");
            } catch {
                message.error("保存素材失败，请检查网络连接后重试");
            }
            return;
        }
        const blob = await getMediaBlob(video.storageKey!);
        if (!blob) return message.error("视频文件已丢失，请重新生成");
        const stored = await uploadBlob(blob, "videos");
        try {
            await addAsset({
                kind: "video",
                title: "生成视频",
                coverUrl: stored.url,
                tags: [],
                source: "视频创作台",
                data: { url: stored.url, fileId: stored.fileId, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "video-page", prompt },
            });
            message.success("已加入我的素材");
        } catch {
            message.error("保存素材失败，请检查网络连接后重试");
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height }].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = async () => {
        const ids = [...selectedLogIds];
        const mediaKeys = logs
            .filter((log) => selectedLogIds.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));

        // Delete from backend and local cache
        await Promise.all([deleteStoredMedia(mediaKeys), ...ids.map((id) => logStoreForUser().removeItem(id)), ...ids.map((id) => deleteGenerationTask(id).catch(() => {}))]);

        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        await refreshLogs();
    };

    const saveLog = async (log: GenerationLog) => {
        await logStoreForUser().setItem(log.id, serializeLog(log));
        // Sync to backend so refreshLogs can find it
        const user = useUserStore.getState().user;
        const channelMode = useConfigStore.getState().config.channelMode;
        // In remote mode the backend proxy already creates a complete generation_tasks
        // record via LogTaskStart → LogTaskCreated → SyncTaskStatus. Only create/upsert
        // one in local mode where the frontend calls external APIs directly.
        if (user?.id && channelMode !== "remote") {
            try {
                const status = log.status === "成功" ? "success" : log.status === "失败" ? "failed" : "pending";
                const result = await recordGenerationTask({
                    taskType: "video",
                    provider: "seedance",
                    model: log.model || "unknown",
                    status,
                    credits: "0",
                    latencyMs: log.durationMs,
                    upstreamTaskId: log.task?.id || "",
                    source: "video_workbench",
                    requestBody: JSON.stringify({
                        prompt: log.prompt,
                        model: log.model,
                        size: log.config.size,
                        vquality: log.config.vquality,
                        videoSeconds: log.config.videoSeconds,
                        genAudio: log.config.videoGenerateAudio,
                        watermark: log.config.videoWatermark,
                    }),
                    responseBody: JSON.stringify({
                        videoUrl: log.video?.url || "",
                    }),
                    metadata: log.video?.fileId ? JSON.stringify({ fileIds: [log.video.fileId] }) : "",
                    errorMessage: log.status === "失败" ? log.error || "" : "",
                });
                // If this is a new record (first saveLog call), update local log id to backend id
                if (result?.id && log.status === "生成中" && !log.task?.id) {
                    // Store the backend-assigned id so toGenerationLog can match this log later
                    // We keep the local nanoid for now; refreshLogs will add the backend version
                }
            } catch {
                /* non-blocking */
            }
        }
        // Sync video task result metadata (fileIds) to backend for presigned URL refresh
        const videos = [log.video].filter(Boolean);
        const fileIds = videos.map((v) => v?.fileId).filter((id): id is string => Boolean(id));
        if (fileIds.length) {
            await patchGenerationTaskMetadata(log.id, JSON.stringify({ fileIds })).catch(() => {});
        }
        await refreshLogs();
    };

    const refreshLogs = async () => {
        // Load from backend (source of truth) for online users
        const user = useUserStore.getState().user;
        if (user?.id) {
            try {
                const result = await fetchVideoHistory(1, 50, "video_workbench");
                const backendLogs = result.items.map(toGenerationLog);
                // Resolve presigned URLs for S3-backed videos
                const allFileIds = backendLogs.map((log) => log.video?.fileId).filter((id): id is string => Boolean(id));
                const urlMap = allFileIds.length ? await resolveFileUrls([...new Set(allFileIds)]) : new Map<string, string>();
                for (const log of backendLogs) {
                    if (log.video?.fileId && urlMap.has(log.video.fileId)) {
                        log.video.url = urlMap.get(log.video.fileId)!;
                    }
                }
                // Filter out invalid logs
                const validLogs = backendLogs.filter((log) => log.id);
                setLogs(validLogs);
                // Also cache locally for offline fallback
                for (const log of validLogs) {
                    await logStoreForUser().setItem(log.id, serializeLog(log));
                }
                resumePendingLogs(validLogs);
                return validLogs;
            } catch {
                // Fallback to local cache
            }
        }
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        resumePendingLogs(nextLogs);
        return nextLogs;
    };

    // Map VideoHistoryItem DTO to local GenerationLog type for backward compat.
    // Does NOT make extra HTTP requests — uses only the data already in the list response.
    function toGenerationLog(item: VideoHistoryItem): GenerationLog {
        const isPending = item.status === "pending";
        const fileId = item.fileIds?.[0];
        const log: GenerationLog = {
            id: item.id,
            createdAt: new Date(item.createdAt).getTime(),
            title: item.title,
            prompt: item.prompt || "",
            time: item.createdAt,
            model: item.model,
            config: {
                model: item.model,
                videoModel: item.model || "",
                size: item.size || "",
                vquality: item.vquality || "",
                videoSeconds: item.videoSeconds || "",
                videoGenerateAudio: item.genAudio || "true",
                videoWatermark: item.watermark || "false",
                channelMode: "remote",
            },
            references: [],
            videoReferences: [],
            audioReferences: [],
            durationMs: item.durationMs,
            size: item.size || "",
            resolution: item.vquality || "",
            seconds: item.videoSeconds || "",
            status: item.status === "success" ? "成功" : item.status === "failed" ? "失败" : "生成中",
            error: item.error,
            video: fileId ? { id: fileId, url: "", fileId, storageKey: "", durationMs: item.durationMs, width: 1280, height: 720, bytes: 0, mimeType: "video/mp4" } : undefined,
        };
        // Rebuild polling task from upstreamTaskId so pending tasks resume after refresh
        if (isPending && item.upstreamTaskId) {
            log.task = { id: item.upstreamTaskId, model: item.model };
        }
        return log;
    }

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "生成中" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        const abortController = new AbortController();
        abortControllersRef.current.set(log.id, abortController);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, { signal: abortController.signal });
                if (state.status === "completed") {
                    let stored;
                    if (state.result.blob) {
                        stored = await uploadBlob(state.result.blob, "results/videos");
                    } else if (state.result.url) {
                        stored = await uploadUrlToS3(state.result.url, "results/videos");
                    } else {
                        throw new Error("视频结果为空");
                    }
                    const nextVideo: GeneratedVideo = {
                        id: stored.fileId,
                        url: stored.url,
                        fileId: stored.fileId,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    // Resolve a fresh presigned URL so the result plays immediately
                    // without a page refresh (uploadUrlToS3 returns a raw S3 public URL
                    // that may require a proxy for playback).
                    {
                        const urlMap = await resolveFileUrls([stored.fileId]);
                        const resolvedUrl = urlMap.get(stored.fileId);
                        if (resolvedUrl) nextVideo.url = resolvedUrl;
                    }
                    setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                    const completedLog = { ...log, status: "成功" as const, durationMs: nextVideo.durationMs, video: nextVideo, error: undefined };
                    await saveLog(completedLog);
                    setLogs((prev) => prev.map((l) => (l.id === log.id ? completedLog : l)));
                    message.success("视频已生成");
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
                // ponytail: persist intermediate poll state so page reload / nav-away doesn't lose the task
                if (attempt % 3 === 0) {
                    logStoreForUser()
                        .setItem(log.id, serializeLog(log))
                        .catch(() => {});
                }
                await delay(5000, abortController.signal);
            }
        } catch (error) {
            const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
            const errorMessage = aborted ? "已取消" : error instanceof Error ? error.message : "生成失败";
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            const failedLog = { ...log, status: "失败" as const, durationMs: Date.now() - log.createdAt, error: errorMessage };
            await saveLog(failedLog);
            setLogs((prev) => prev.map((l) => (l.id === log.id ? failedLog : l)));
            if (!aborted) message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            abortControllersRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const cancelGenerationLog = async (log: GenerationLog) => {
        if (!log.task) return;
        const controller = abortControllersRef.current.get(log.id);
        if (!controller) return;
        controller.abort();
        abortControllersRef.current.delete(log.id);
        try {
            const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
            await cancelVideoGenerationTask(taskConfig, log.task);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "视频任务取消失败");
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        setResults(log.status === "生成中" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || "生成失败" }]);
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
                        onPreviewLog={previewGenerationLog}
                        onCancel={(id) => {
                            const log = logs.find((l) => l.id === id);
                            if (log) void cancelGenerationLog(log);
                        }}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-foreground">视频创作台</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    记录
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    参数
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">提示词</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            查看提示词库
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            查看我的素材
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder="描述镜头运动、主体动作、场景氛围和画面风格" />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考图</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain">
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("image", index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">暂无参考图，最多 9 张</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考视频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain">
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border bg-black">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考视频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">暂无参考视频，最多 3 个</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">参考音频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain">
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border bg-card px-2">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded px-1 text-[10px] text-muted-foreground bg-muted">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                            <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考音频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-muted-foreground">暂无参考音频，最多 3 个，mp3/wav，单个 15MB 内</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm sm:hidden">
                                <span className="truncate text-muted-foreground">
                                    {modelOptionLabel(effectiveConfig, model)} · {normalizeResolution(effectiveConfig.vquality)}p · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    调整
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                开始生成
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">生成结果</h2>
                            {running ? <Tag className="m-0 px-2 py-1">等待 {formatDuration(elapsedMs)}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || "生成失败"} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-center lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-muted-foreground" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成视频" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                    onCancel={(id) => {
                        const log = logs.find((l) => l.id === id);
                        if (log) void cancelGenerationLog(log);
                    }}
                />
            </Drawer>
            <Drawer title="参数" placement="bottom" size="large" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const [poster, setPoster] = useState("");
    useEffect(() => {
        if (video.url) {
            getVideoPoster(video.url)
                .then(setPoster)
                .catch(() => {});
        }
    }, [video.url]);
    return (
        <div className="overflow-hidden rounded-lg border bg-background">
            <LazyVideo src={video.url} poster={poster} className="aspect-video w-full object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        添加到素材
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed bg-muted/50">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
    onCancel,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
    onCancel?: (logId: string) => void;
}) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">生成记录</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新建
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
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
                        onCancel={onCancel}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick, onCancel }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void; onCancel?: (logId: string) => void }) {
    return (
        <div role="button" tabIndex={0} className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-foreground bg-accent" : "border bg-background hover:bg-accent/50"}`} onClick={onClick}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "成功" ? "blue" : log.status === "生成中" ? "processing" : "red"}>
                        {log.status}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                    {log.status === "生成中" ? (
                        <Button
                            size="small"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCancel?.(log.id);
                            }}
                        >
                            取消
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStoreForUser().iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    // Refresh presigned URLs for S3-backed videos
    let video = log.video;
    if (log.video?.fileId) {
        const urlMap = await resolveFileUrls([log.video.fileId]);
        video = { ...log.video, url: urlMap.get(log.video.fileId) || log.video.url };
    } else if (log.video?.storageKey) {
        video = { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) };
    }
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        channelMode: log.config?.channelMode || "local",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        channelMode: config.channelMode,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeSeedanceRatio(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
