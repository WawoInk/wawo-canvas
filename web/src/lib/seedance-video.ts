import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";
import { formatList, formatNumber } from "@/i18n/formatters";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
};

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9", labelKey: "videoSettings.ratios.landscape" },
    { value: "9:16", labelKey: "videoSettings.ratios.portrait" },
    { value: "1:1", labelKey: "videoSettings.ratios.square" },
    { value: "4:3", labelKey: "videoSettings.ratios.standardLandscape" },
    { value: "3:4", labelKey: "videoSettings.ratios.standardPortrait" },
    { value: "21:9", labelKey: "videoSettings.ratios.cinema" },
    { value: "adaptive", labelKey: "videoSettings.ratios.adaptive" },
] as const;

export const seedanceDurationOptions = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

const seedancePixels = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
} as const;

export function isSeedanceFastModel(model: string) {
    const value = model.toLowerCase();
    return (value.includes("seedance") || value.includes("doubao-seedance")) && value.includes("fast");
}

export function normalizeSeedanceResolution(value: string, model = "") {
    const normalized = normalizeResolutionToken(value);
    if (isSeedanceFastModel(model) && normalized === "1080p") return "720p";
    return seedanceResolutionOptions.some((item) => item.value === normalized) ? normalized : "720p";
}

export function normalizeResolutionToken(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = String(value || "").replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export function normalizeSeedanceDuration(value: string, bounds: { min?: number; max?: number } = {}) {
    if (String(value).trim() === "-1") return -1;
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(bounds.min ?? 4, Math.min(bounds.max ?? 15, seconds));
}

export function normalizeSeedanceRatio(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (seedanceRatioOptions.some((item) => item.value === value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "adaptive";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "adaptive";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    const normalizedResolution = normalizeSeedanceResolution(resolution) as keyof typeof seedancePixels;
    const normalizedRatio = normalizeSeedanceRatio(ratio) as keyof (typeof seedancePixels)[typeof normalizedResolution] | "adaptive";
    if (normalizedRatio === "adaptive") return i18n.t("videoSettings.autoMatch");
    return seedancePixels[normalizedResolution][normalizedRatio] || "";
}

export function seedanceRatioLabel(value: string) {
    const option = seedanceRatioOptions.find((item) => item.value === normalizeSeedanceRatio(value));
    return option ? i18n.t(option.labelKey) : value;
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    return i18n.t(`videoWorkbench.references.labels.${kind}`, { index: formatNumber(index + 1, { useGrouping: false }) });
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const labels = [...images.map((_, index) => seedanceReferenceLabel("image", index)), ...videos.map((_, index) => seedanceReferenceLabel("video", index)), ...audios.map((_, index) => seedanceReferenceLabel("audio", index))];
    const text = prompt.trim();
    if (!labels.length) return text;
    return i18n.t("videoWorkbench.references.promptContext", { labels: formatList(labels), prompt: text });
}

export function seedanceVideoReferenceError(videos: ReferenceVideo[]) {
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const label = seedanceReferenceLabel("video", index);
        if (video.bytes && video.bytes > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) return i18n.t("errors.video.referenceTooLarge", { label });
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > 15000) return i18n.t("errors.video.referenceDuration", { label });
            totalDurationMs += video.durationMs;
        }
        if (video.width && video.height) {
            if (video.width < 300 || video.width > 6000 || video.height < 300 || video.height > 6000) return i18n.t("errors.video.referenceDimensions", { label });
            const ratio = video.width / video.height;
            if (ratio < 0.4 || ratio > 2.5) return i18n.t("errors.video.referenceRatio", { label });
            const pixels = video.width * video.height;
            if (pixels < 640 * 640 || pixels > 2206 * 946) return i18n.t("errors.video.referencePixels", { label });
        }
    }
    if (totalDurationMs > 15000) return i18n.t("errors.video.referenceTotalDuration");
    return "";
}

export function seedanceVideoReferenceHint() {
    return i18n.t("videoWorkbench.references.videos.hint");
}
