import type { AdminImageRequestFormat } from "../../../services/api/admin.ts";
import type { ImageResolutionOption } from "../../../services/api/settings.ts";

export const imageRequestFormatValues = ["application/json", "multipart/form-data", "default"] as const;
export const imageRequestResolutionValues = ["default", "1k", "2k", "4k"] as const;

export function normalizeAdminImageRequestResolutions(values: unknown): ImageResolutionOption[] {
    if (!Array.isArray(values)) return ["default"];
    const selected = new Set(values.map((value) => String(value).trim()).filter((value): value is ImageResolutionOption => imageRequestResolutionValues.includes(value as ImageResolutionOption)));
    if (!selected.size || selected.has("default")) return ["default"];
    return imageRequestResolutionValues.filter((value) => value !== "default" && selected.has(value));
}

export function normalizeAdminImageRequestResolutionSelection(values: ImageResolutionOption[] = [], previous: ImageResolutionOption[] = []) {
    const selected = imageRequestResolutionValues.filter((value) => values.includes(value));
    if (selected.includes("default") && selected.length > 1) {
        return previous.includes("default") ? selected.filter((value) => value !== "default") : ["default"];
    }
    return selected;
}

export function normalizeAdminImageRequestFormats(items: Array<Partial<AdminImageRequestFormat>> = []): AdminImageRequestFormat[] {
    return items
        .filter((item) => item.model && imageRequestFormatValues.includes(item.format as AdminImageRequestFormat["format"]))
        .map((item) => ({
            model: item.model || "",
            format: item.format as AdminImageRequestFormat["format"],
            canvasRequestMode: item.canvasRequestMode === "generations" ? "generations" : "split",
            resolutions: normalizeAdminImageRequestResolutions(item.resolutions),
        }));
}
