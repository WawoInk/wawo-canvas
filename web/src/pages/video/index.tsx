"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, Play, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Select, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetPickerModal, type InsertAssetPayload } from "@/pages/canvas/components/asset-picker-modal";
import { LazyVideo } from "@/components/lazy-media";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { accountStoreName } from "@/lib/account-storage";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { getVideoPoster } from "@/lib/video-poster";
import { boolConfig, normalizeSeedanceRatio, seedanceReferenceLabel, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { deleteStoredMedia, getImageBlob, getMediaBlob, resolveMediaUrl, resolveImageUrl } from "@/services/blob-storage";
import { uploadBlob, uploadUrlToS3 } from "@/services/upload-blob";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { recordGenerationTask } from "@/services/api/generation-tasks";
import { cancelVideoGenerationTask, pollVideoGenerationTask } from "@/services/api/video";
import { fetchVideoHistory, deleteGenerationTask, type VideoHistoryItem } from "@/services/api/generation-tasks";
import { cancelGeneration, GenerationPollingPausedError, generationQueryErrorMessage, getGenerationProfiles, type GenerationProfile, type ShortDramaAssetRole } from "@/services/api/generations";
import { completeVideoWorkbenchTask, createVideoWorkbenchTask, type VideoWorkbenchTask } from "./video-async-task";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";
import { formatDateTime, formatDimensions, formatNumber } from "@/i18n/formatters";

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
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoWorkbenchTask;
    video?: GeneratedVideo;
    error?: string;
    dramaTitle?: string;
    dramaAssetRoles?: Record<string, ShortDramaAssetRole>;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoMode" | "videoGenerateAudio" | "videoWatermark" | "channelMode">;

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
    const { t } = useTranslation();
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
    const userReady = useUserStore((state) => state.isReady);
    const [prompt, setPrompt] = useState("");
    const [dramaTitle, setDramaTitle] = useState("");
    const [dramaAssetRoles, setDramaAssetRoles] = useState<Record<string, ShortDramaAssetRole>>({});
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
    const [profiles, setProfiles] = useState<GenerationProfile[]>([]);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean((prompt ?? "").trim());
    const profile = profiles.find((item) => item.id === model);
    const isShortDrama = effectiveConfig.channelMode === "remote" && profile?.intents.includes("video.short-drama");

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

    useEffect(() => {
        if (effectiveConfig.channelMode !== "remote" || !userReady) {
            setProfiles([]);
            return;
        }
        void getGenerationProfiles()
            .then(setProfiles)
            .catch(() => setProfiles([]));
    }, [configHydrated, effectiveConfig.channelMode, userReady]);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning(t("videoWorkbench.references.unsupported"));
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning(t("videoWorkbench.references.imageTooLarge"));
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning(t("videoWorkbench.references.videoTooLarge"));
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning(t("videoWorkbench.references.audioTooLarge"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const dataUrl = URL.createObjectURL(file);
                const image = await uploadBlob(file, "images");
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl, url: image.url, storageKey: image.fileId, fileId: image.fileId };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadBlob(file, "videos");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.fileId, fileId: video.fileId, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadBlob(file, "audios");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.fileId, fileId: audio.fileId, durationMs: audio.durationMs };
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
                message.error(t("imageWorkbench.references.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const dataUrl = URL.createObjectURL(blob);
                    const image = await uploadBlob(blob, "images");
                    return { id: nanoid(), name: t("imageWorkbench.references.clipboardFileName", { index: formatNumber(index + 1, { useGrouping: false }) }), type: image.mimeType, dataUrl, url: image.url, storageKey: image.fileId, fileId: image.fileId };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(t("imageWorkbench.references.clipboardRead", { count: nextReferences.length, value: formatNumber(nextReferences.length) }));
        } catch {
            message.error(t("imageWorkbench.references.clipboardEmpty"));
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
            const availableProfiles = snapshot.config.channelMode === "remote" ? await getGenerationProfiles() : [];
            const selectedProfile = snapshot.config.channelMode === "remote" ? availableProfiles.find((item) => item.id === snapshot.config.videoModel) : undefined;
            const firstPartyReferences = selectedProfile ? await ensurePlatformReferences(snapshot.references, snapshot.videoReferences, snapshot.audioReferences) : snapshot;
            const task = await createVideoWorkbenchTask(snapshot.config, snapshot.text, firstPartyReferences.references, firstPartyReferences.videoReferences, firstPartyReferences.audioReferences, {
                profile: selectedProfile,
                title: snapshot.dramaTitle,
                dramaAssetRoles: snapshot.dramaAssetRoles,
            });
            const log = buildLog({
                id: task.firstParty ? task.id : task.platformTaskId,
                prompt: snapshot.text,
                model: snapshot.config.videoModel,
                config: snapshot.config,
                references: firstPartyReferences.references,
                videoReferences: firstPartyReferences.videoReferences,
                audioReferences: firstPartyReferences.audioReferences,
                durationMs: 0,
                status: "pending",
                task,
                dramaTitle: snapshot.dramaTitle,
                dramaAssetRoles: snapshot.dramaAssetRoles,
            });
            await saveLog(log);
            void pollGenerationLog(log, snapshot.config);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("errors.video.generationFailed");
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
                    status: "failed",
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
            message.error(t("videoWorkbench.prompt.required"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("videoWorkbench.configRequired"));
            openConfigDialog(true);
            return null;
        }
        return {
            text,
            config: buildVideoConfig(effectiveConfig, model),
            references: [...references],
            videoReferences: [...videoReferences],
            audioReferences: [...audioReferences],
            dramaTitle: dramaTitle.trim(),
            dramaAssetRoles: { ...dramaAssetRoles },
        };
    };

    const ensurePlatformReferences = async (imageItems: ReferenceImage[], videoItems: ReferenceVideo[], audioItems: ReferenceAudio[]) => {
        const references = await Promise.all(
            imageItems.map(async (item) => {
                const fileId = platformFileID(item.fileId, item.storageKey);
                if (fileId) return { ...item, fileId };
                const stored = item.storageKey
                    ? await uploadStoredReference(getImageBlob(item.storageKey), "images", item.name)
                    : item.dataUrl.startsWith("data:") || item.dataUrl.startsWith("blob:")
                      ? await uploadBlob(await (await fetch(item.dataUrl)).blob(), "images")
                      : await uploadUrlToS3(item.url || item.dataUrl, "images");
                return { ...item, dataUrl: stored.url, url: stored.url, fileId: stored.fileId };
            }),
        );
        const videoReferences = await Promise.all(
            videoItems.map(async (item) => {
                const fileId = platformFileID(item.fileId, item.storageKey);
                if (fileId) return { ...item, fileId };
                const stored = item.storageKey ? await uploadStoredReference(getMediaBlob(item.storageKey), "videos", item.name) : await uploadUrlToS3(item.url, "videos");
                return { ...item, url: stored.url, fileId: stored.fileId, bytes: stored.bytes, width: stored.width, height: stored.height, durationMs: stored.durationMs };
            }),
        );
        const audioReferences = await Promise.all(
            audioItems.map(async (item) => {
                const fileId = platformFileID(item.fileId, item.storageKey);
                if (fileId) return { ...item, fileId };
                const stored = item.storageKey ? await uploadStoredReference(getMediaBlob(item.storageKey), "audios", item.name) : await uploadUrlToS3(item.url, "audios");
                return { ...item, url: stored.url, fileId: stored.fileId, durationMs: stored.durationMs };
            }),
        );
        return { references, videoReferences, audioReferences };
    };

    const uploadStoredReference = async (blob: Promise<Blob | null>, fileType: "images" | "videos" | "audios", name: string) => {
        const value = await blob;
        if (!value) throw new Error(t("errors.video.firstPartyReferenceNotUploaded", { name }));
        return uploadBlob(value, fileType);
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
        saveAs(url, t("videoWorkbench.results.downloadFileName"));
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
                    title: t("videoWorkbench.assets.generatedTitle"),
                    coverUrl: url,
                    tags: [],
                    source: t("videoWorkbench.assets.source"),
                    data: { url, fileId: video.fileId, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                    metadata: { source: "video-page", prompt },
                });
                message.success(t("videoWorkbench.assets.saved"));
            } catch {
                message.error(t("videoWorkbench.assets.saveFailed"));
            }
            return;
        }
        const blob = await getMediaBlob(video.storageKey!);
        if (!blob) return message.error(t("videoWorkbench.assets.missingFile"));
        const stored = await uploadBlob(blob, "videos");
        try {
            await addAsset({
                kind: "video",
                title: t("videoWorkbench.assets.generatedTitle"),
                coverUrl: stored.url,
                tags: [],
                source: t("videoWorkbench.assets.source"),
                data: { url: stored.url, fileId: stored.fileId, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "video-page", prompt },
            });
            message.success(t("videoWorkbench.assets.saved"));
        } catch {
            message.error(t("videoWorkbench.assets.saveFailed"));
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = payload.fileId ? { fileId: payload.fileId, url: payload.dataUrl, mimeType: "image/png" } : await uploadBlob(await (await fetch(payload.dataUrl)).blob(), "images");
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: payload.storageKey || stored.fileId, fileId: stored.fileId }].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            const stored = payload.fileId ? { fileId: payload.fileId, url: payload.url, mimeType: "video/mp4", bytes: 0, width: payload.width || 0, height: payload.height || 0 } : await uploadUrlToS3(payload.url, "videos");
            setVideoReferences((value) =>
                [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, url: stored.url, storageKey: payload.storageKey || stored.fileId, fileId: stored.fileId, width: stored.width, height: stored.height, bytes: stored.bytes }].slice(
                    0,
                    SEEDANCE_REFERENCE_LIMITS.videos,
                ),
            );
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setDramaTitle("");
        setDramaAssetRoles({});
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
        await logStoreForUser()
            .setItem(log.id, serializeLog(log))
            .catch(() => {});
        const user = useUserStore.getState().user;
        const channelMode = useConfigStore.getState().config.channelMode;
        // Remote first-party and compatibility routes already own task persistence.
        if (user?.id && channelMode !== "remote") {
            try {
                const result = await recordGenerationTask({
                    taskType: "video",
                    provider: "seedance",
                    model: log.model || "unknown",
                    status: log.status,
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
                    errorMessage: log.status === "failed" ? log.error || "" : "",
                });
                // If this is a new record (first saveLog call), update local log id to backend id
                if (result?.id && log.status === "pending" && !log.task?.id) {
                    // Store the backend-assigned id so toGenerationLog can match this log later
                    // We keep the local nanoid for now; refreshLogs will add the backend version
                }
            } catch {
                /* non-blocking */
            }
        }
        await refreshLogs().catch(() => {});
    };

    const refreshLogs = async () => {
        // Load from backend (source of truth) for online users
        const user = useUserStore.getState().user;
        if (user?.id) {
            try {
                const result = await fetchVideoHistory(1, 50, "video_workbench");
                const profileCatalog = profiles.length ? profiles : await getGenerationProfiles().catch(() => []);
                const backendLogs = result.items.map((item) => toGenerationLog(item, profileCatalog));
                // Resolve presigned URLs for S3-backed videos
                const allFileIds = backendLogs.map((log) => log.video?.fileId).filter((id): id is string => Boolean(id));
                const urlMap = allFileIds.length ? await resolveFileUrls([...new Set(allFileIds)]) : new Map<string, string>();
                for (const log of backendLogs) {
                    if (log.video?.fileId && urlMap.has(log.video.fileId)) {
                        log.video.url = urlMap.get(log.video.fileId)!;
                    }
                }
                const localLogs = await readStoredLogs();
                const localByID = new Map(localLogs.map((log) => [log.id, log]));
                const validLogs = backendLogs.filter((log) => log.id).map((log) => mergeGenerationLog(log, localByID.get(log.id)));
                const knownIDs = new Set(validLogs.map((log) => log.id));
                validLogs.push(...localLogs.filter((log) => !knownIDs.has(log.id)));
                validLogs.sort((a, b) => b.createdAt - a.createdAt);
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
    function toGenerationLog(item: VideoHistoryItem, profileCatalog: GenerationProfile[] = profiles): GenerationLog {
        const isPending = item.status === "pending";
        const fileId = item.fileIds?.[0];
        const model = item.modelProfileId || item.model;
        const modelProfile = profileCatalog.find((profile) => profile.id === item.modelProfileId);
        const log: GenerationLog = {
            id: item.id,
            createdAt: new Date(item.createdAt).getTime(),
            title: item.title,
            prompt: item.prompt || "",
            model,
            config: {
                model,
                videoModel: model,
                size: item.size || "",
                vquality: item.vquality || "",
                videoSeconds: item.videoSeconds || "",
                videoMode: "reference",
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
            status: item.status === "success" ? "success" : item.status === "failed" ? "failed" : "pending",
            error: item.error,
            video: fileId ? { id: fileId, url: "", fileId, storageKey: "", durationMs: item.durationMs, width: 1280, height: 720, bytes: 0, mimeType: "video/mp4" } : undefined,
        };
        if (isPending && item.modelProfileId) {
            log.task = { id: item.id, model: item.modelProfileId, firstParty: true, cancellation: Boolean(modelProfile?.capabilities.cancellation) };
        } else if (isPending && item.upstreamTaskId) {
            log.task = { id: item.upstreamTaskId, model: item.model, platformTaskId: item.id };
        }
        return log;
    }

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
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
            if (log.task.firstParty) {
                const nextVideo = await completeVideoWorkbenchTask(log.task, {
                    resolveFile: async (fileId) => {
                        const url = (await resolveFileUrls([fileId])).get(fileId);
                        if (!url) throw new Error(t("errors.video.emptyResult"));
                        return { id: fileId, url, fileId, storageKey: "", durationMs: Date.now() - log.createdAt, width: 1280, height: 720, bytes: 0, mimeType: "video/mp4" };
                    },
                    sleep: () => delay(5000, abortController.signal),
                    signal: abortController.signal,
                });
                setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                const completedLog = { ...log, status: "success" as const, durationMs: nextVideo.durationMs, video: nextVideo, error: undefined };
                await saveLog(completedLog);
                setLogs((prev) => prev.map((item) => (item.id === log.id ? completedLog : item)));
                message.success(t("videoWorkbench.results.generated"));
                return;
            }
            if (taskConfig.channelMode === "remote" && log.task.platformTaskId) {
                const nextVideo = await completeVideoWorkbenchTask(log.task, {
                    resolveFile: async (fileId) => {
                        const url = (await resolveFileUrls([fileId])).get(fileId);
                        if (!url) throw new Error(t("errors.video.emptyResult"));
                        return { id: fileId, url, fileId, storageKey: "", durationMs: Date.now() - log.createdAt, width: 1280, height: 720, bytes: 0, mimeType: "video/mp4" };
                    },
                    sleep: () => delay(5000, abortController.signal),
                });
                setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                const completedLog = { ...log, status: "success" as const, durationMs: nextVideo.durationMs, video: nextVideo, error: undefined };
                await saveLog(completedLog);
                setLogs((prev) => prev.map((item) => (item.id === log.id ? completedLog : item)));
                message.success(t("videoWorkbench.results.generated"));
                return;
            }
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, { signal: abortController.signal });
                if (state.status === "completed") {
                    let stored;
                    if (state.result.blob) {
                        stored = await uploadBlob(state.result.blob, "results/videos");
                    } else if (state.result.url) {
                        stored = await uploadUrlToS3(state.result.url, "results/videos");
                    } else {
                        throw new Error(t("errors.video.emptyResult"));
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
                    const completedLog = { ...log, status: "success" as const, durationMs: nextVideo.durationMs, video: nextVideo, error: undefined };
                    await saveLog(completedLog);
                    setLogs((prev) => prev.map((l) => (l.id === log.id ? completedLog : l)));
                    message.success(t("videoWorkbench.results.generated"));
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error(t("errors.video.timeout"));
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
            const errorMessage = aborted ? t("errors.requestCancelled") : error instanceof Error ? error.message : t("errors.video.generationFailed");
            if (error instanceof GenerationPollingPausedError) {
                const pausedLog = { ...log, status: "pending" as const, durationMs: Date.now() - log.createdAt, error: generationQueryErrorMessage(error.queryError) };
                await logStoreForUser().setItem(pausedLog.id, serializeLog(pausedLog));
                setLogs((prev) => prev.map((item) => (item.id === log.id ? pausedLog : item)));
                setResults([{ id: log.id, status: "pending" }]);
                message.warning(pausedLog.error);
                return;
            }
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            const failedLog = { ...log, status: "failed" as const, durationMs: Date.now() - log.createdAt, error: errorMessage };
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
        if (log.task.firstParty && !log.task.cancellation) return;
        const controller = abortControllersRef.current.get(log.id);
        controller?.abort();
        abortControllersRef.current.delete(log.id);
        try {
            const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
            if (log.task.firstParty) await cancelGeneration(log.task.id);
            else await cancelVideoGenerationTask(taskConfig, log.task);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : t("errors.video.cancelFailed"));
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setDramaTitle(log.dramaTitle || "");
        setDramaAssetRoles(log.dramaAssetRoles || {});
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        updateConfig("videoMode", log.config.videoMode);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || t("errors.video.generationFailed") }]);
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
                            <h1 className="text-2xl font-semibold text-foreground">{t("videoWorkbench.title")}</h1>
                            <div className="flex shrink-0 gap-2 lg:hidden">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    {t("videoWorkbench.mobile.logs")}
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("videoWorkbench.parameters")}
                                </Button>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t(isShortDrama ? "videoWorkbench.shortDrama.script.label" : "videoWorkbench.prompt.label")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("videoWorkbench.prompt.openLibrary")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("videoWorkbench.prompt.openAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t(isShortDrama ? "videoWorkbench.shortDrama.script.placeholder" : "videoWorkbench.prompt.placeholder")} />
                            </div>

                            {isShortDrama ? (
                                <div>
                                    <span className="mb-2 block text-base font-semibold">{t("videoWorkbench.shortDrama.title.label")}</span>
                                    <Input value={dramaTitle} maxLength={20} onChange={(event) => setDramaTitle(event.target.value)} placeholder={t("videoWorkbench.shortDrama.title.placeholder")} />
                                </div>
                            ) : null}

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("videoWorkbench.references.images.title")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("imageWorkbench.references.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("common.actions.upload")}
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
                                                aria-label={t("videoWorkbench.references.images.remove")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? (
                                        <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">
                                            {t("videoWorkbench.references.images.empty", { count: SEEDANCE_REFERENCE_LIMITS.images, value: formatNumber(SEEDANCE_REFERENCE_LIMITS.images) })}
                                        </div>
                                    ) : null}
                                </div>
                                {isShortDrama && references.length ? (
                                    <div className="mt-3 space-y-2">
                                        {references.map((item) => (
                                            <div key={item.id} className="flex min-w-0 items-center gap-3">
                                                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                                                <Select
                                                    aria-label={t("videoWorkbench.shortDrama.roleAria", { name: item.name })}
                                                    className="w-32 shrink-0"
                                                    size="small"
                                                    value={dramaAssetRoles[item.id]}
                                                    placeholder={t("videoWorkbench.shortDrama.rolePlaceholder")}
                                                    options={[
                                                        { value: "character", label: t("videoWorkbench.shortDrama.roles.character") },
                                                        { value: "scene", label: t("videoWorkbench.shortDrama.roles.scene") },
                                                        { value: "tool", label: t("videoWorkbench.shortDrama.roles.tool") },
                                                    ]}
                                                    onChange={(role) => setDramaAssetRoles((value) => ({ ...value, [item.id]: role }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("videoWorkbench.references.videos.title")}</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {t("common.actions.upload")}
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
                                                aria-label={t("videoWorkbench.references.videos.remove")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? (
                                        <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">
                                            {t("videoWorkbench.references.videos.empty", { count: SEEDANCE_REFERENCE_LIMITS.videos, value: formatNumber(SEEDANCE_REFERENCE_LIMITS.videos) })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("videoWorkbench.references.audios.title")}</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {t("common.actions.upload")}
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
                                                aria-label={t("videoWorkbench.references.audios.remove")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? (
                                        <div className="flex min-w-full items-center justify-center text-center text-sm text-muted-foreground">
                                            {t("videoWorkbench.references.audios.empty", { count: SEEDANCE_REFERENCE_LIMITS.audios, value: formatNumber(SEEDANCE_REFERENCE_LIMITS.audios) })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm sm:hidden">
                                <span className="truncate text-muted-foreground">
                                    {modelOptionLabel(effectiveConfig, model)} · {videoResolutionLabel(effectiveConfig.vquality)} · {videoSizeLabel(effectiveConfig.size)} · {videoSecondsLabel(effectiveConfig.videoSeconds)}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("videoWorkbench.actions.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                {t("videoWorkbench.actions.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("videoWorkbench.results.title")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("videoWorkbench.results.waiting", { duration: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || t("errors.video.generationFailed")} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-center lg:min-h-[560px]">
                                <VideoIcon className="mb-4 size-11 text-muted-foreground" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.results.empty")} />
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
            <Drawer title={t("videoWorkbench.logs.title")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
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
            <Drawer title={t("videoWorkbench.parameters")} placement="bottom" size="large" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal
                title={t("videoWorkbench.logs.deleteTitle")}
                open={deleteConfirmOpen}
                onCancel={() => setDeleteConfirmOpen(false)}
                onOk={deleteSelectedLogs}
                okText={t("common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.actions.cancel")}
            >
                {t("videoWorkbench.logs.deleteConfirm", { count: selectedLogIds.length, value: formatNumber(selectedLogIds.length) })}
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
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("videoWorkbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={{ ...config, model, videoModel: model }} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
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
                    <span>{formatDimensions(video.width, video.height)}</span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("videoWorkbench.actions.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.actions.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed bg-muted/50">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("videoWorkbench.results.pending")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("videoWorkbench.results.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("videoWorkbench.actions.retry")}
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
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("videoWorkbench.logs.title")}</h2>
                <Tag className="m-0">{formatNumber(logs.length)}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("videoWorkbench.actions.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("videoWorkbench.actions.deselectAll") : t("videoWorkbench.actions.selectAll")}
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
                        onCancel={onCancel}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">{t("videoWorkbench.logs.empty")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick, onCancel }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void; onCancel?: (logId: string) => void }) {
    const { t } = useTranslation();
    const title = log.title || t("videoWorkbench.logs.untitled");
    const statusColor = log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red";
    return (
        <div role="button" tabIndex={0} className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-foreground bg-accent" : "border bg-background hover:bg-accent/50"}`} onClick={onClick}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox aria-label={t("videoWorkbench.logs.select", { title })} className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{videoSizeLabel(log.size)}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{videoResolutionLabel(log.resolution)}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{videoSecondsLabel(log.seconds)}</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={statusColor}>
                        {t(`videoWorkbench.logs.status.${log.status}`)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{formatDateTime(log.createdAt)}</Tag>
                    {log.status === "pending" && log.task && (!log.task.firstParty || log.task.cancellation) ? (
                        <Button
                            size="small"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCancel?.(log.id);
                            }}
                        >
                            {t("common.actions.cancel")}
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
            url: item.fileId ? (await resolveFileUrls([item.fileId])).get(item.fileId) || item.url : item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.fileId ? (await resolveFileUrls([item.fileId])).get(item.fileId) || item.url : item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: item.fileId ? (await resolveFileUrls([item.fileId])).get(item.fileId) || item.dataUrl : await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "",
        prompt: log.prompt || "",
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
    };
}

function mergeGenerationLog(log: GenerationLog, local?: GenerationLog): GenerationLog {
    if (!local) return log;
    return {
        ...log,
        task: log.task || local.task,
        config: { ...log.config, videoMode: local.config.videoMode },
        references: local.references.length ? local.references : log.references,
        videoReferences: local.videoReferences.length ? local.videoReferences : log.videoReferences,
        audioReferences: local.audioReferences.length ? local.audioReferences : log.audioReferences,
        dramaTitle: local.dramaTitle,
        dramaAssetRoles: local.dramaAssetRoles,
    };
}

function platformFileID(fileId?: string, storageKey?: string) {
    return fileId || (storageKey && !storageKey.includes(":") ? storageKey : "");
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.fileId || item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.fileId || item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.fileId || item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.fileId || log.video?.storageKey ? { ...log.video, url: "" } : log.video,
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
    if (skipped) warn(i18n.t("videoWorkbench.references.audios.invalidDuration"));
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
    const { t } = useTranslation();
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button aria-label={t("videoWorkbench.references.movePrevious")} size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button
                aria-label={t("videoWorkbench.references.moveNext")}
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
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
        videoMode: log.config?.videoMode === "frames" ? "frames" : "reference",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        channelMode: log.config?.channelMode || "local",
    };
}

function buildLog({
    id,
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
    dramaTitle,
    dramaAssetRoles,
}: {
    id?: string;
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoWorkbenchTask;
    video?: GeneratedVideo;
    error?: string;
    dramaTitle?: string;
    dramaAssetRoles?: Record<string, ShortDramaAssetRole>;
}): GenerationLog {
    const logConfig: GenerationLogConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoMode: config.videoMode,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        channelMode: config.channelMode,
    };
    return {
        id: id || nanoid(),
        createdAt: Date.now(),
        title: dramaTitle || prompt.slice(0, 12),
        prompt,
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
        dramaTitle,
        dramaAssetRoles,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        size: normalizeSeedanceRatio(config.size),
        videoSeconds: config.channelMode === "remote" ? config.videoSeconds : normalizeVideoSeconds(config.videoSeconds),
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
