import type { AdminImageRequestFormat } from "../../../services/api/admin.ts";
import type { ImageResolutionOption } from "../../../services/api/settings.ts";

export const imageRequestFormatValues = ["application/json", "multipart/form-data", "default"] as const;
export const imageRequestResolutionValues = ["default", "1k", "2k", "4k"] as const;

export function normalizeAdminImageRequestFormats(items: Array<Partial<AdminImageRequestFormat>> = []): AdminImageRequestFormat[] {
    return items
        .filter((item) => item.model && imageRequestFormatValues.includes(item.format as AdminImageRequestFormat["format"]))
        .map((item) => {
            const resolution = String(item.resolution || "").trim() as ImageResolutionOption;
            return {
                model: item.model || "",
                format: item.format as AdminImageRequestFormat["format"],
                canvasRequestMode: item.canvasRequestMode === "generations" ? "generations" : "split",
                resolution: imageRequestResolutionValues.includes(resolution) ? resolution : "default",
            };
        });
}
