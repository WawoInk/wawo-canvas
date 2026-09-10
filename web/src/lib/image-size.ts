import type { ImageResolutionOption } from "@/services/api/settings";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840" },
};

export function parseImageSize(size: string) {
    for (const [resolution, presets] of Object.entries(imageSizePresets)) {
        const ratio = Object.keys(presets).find((ratio) => presets[ratio] === size);
        if (ratio) return { resolution, ratio };
    }
    const dimensions = size
        .match(/^(\d+)[x:](\d+)$/i)
        ?.slice(1)
        .map(Number);
    if (!dimensions || !dimensions[0] || !dimensions[1]) return { resolution: "auto", ratio: "auto" };
    const [width, height] = dimensions;
    const ratio = Object.keys(imageSizePresets["1k"]).reduce((best, ratio) => {
        const [w, h] = ratio.split(":").map(Number);
        const [bw, bh] = best.split(":").map(Number);
        return Math.abs(w / h - width / height) < Math.abs(bw / bh - width / height) ? ratio : best;
    });
    const edge = Math.max(width, height);
    return { resolution: size.includes(":") ? "auto" : edge >= 3072 ? "4k" : edge >= 1536 ? "2k" : "1k", ratio };
}

export function normalizeImageResolutions(resolutions?: unknown): ImageResolutionOption[] {
    if (!Array.isArray(resolutions)) return ["default"];
    const selected = new Set(resolutions.filter((value): value is ImageResolutionOption => value === "default" || value === "1k" || value === "2k" || value === "4k"));
    if (!selected.size || selected.has("default")) return ["default"];
    return (["1k", "2k", "4k"] as ImageResolutionOption[]).filter((value) => selected.has(value));
}

export function normalizeImageSizeForResolutions(resolutions: unknown, currentSize: string) {
    const allowed = normalizeImageResolutions(resolutions);
    const { resolution, ratio } = parseImageSize(currentSize);
    if (allowed.includes("default") || allowed.includes(resolution as ImageResolutionOption)) return currentSize;
    return imageSizePresets[allowed[0]][ratio === "auto" ? "1:1" : ratio];
}

export function imageResolutionsForConfig(config: AiConfig) {
    if (config.channelMode !== "remote") return ["default"] as ImageResolutionOption[];
    const model = modelOptionName(config.model || config.imageModel).trim();
    const setting = config.imageRequestFormats.find((item) => modelOptionName(item.model).trim() === model);
    return normalizeImageResolutions(setting?.resolutions);
}
