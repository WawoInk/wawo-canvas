import { setImageBlob, setMediaBlob } from "@/services/blob-storage";
import { uploadBlob, type UploadResult } from "@/services/upload-blob";
import type { CanvasExportFile } from "../export-types";

const defaultServices = { setImageBlob, setMediaBlob, uploadBlob };

export async function restoreCanvasExportFiles(data: CanvasExportFile, zip: { get(path: string): Blob | undefined }, services = defaultServices) {
    for (const item of data.projects) {
        for (const file of item.files) {
            const archived = zip.get(file.path);
            if (!archived) continue;
            const blob = archived.type ? archived : archived.slice(0, archived.size, file.mimeType);
            if (file.storageKey) {
                await (file.storageKey.startsWith("image:") ? services.setImageBlob(file.storageKey, blob) : services.setMediaBlob(file.storageKey, blob));
                continue;
            }
            if (!file.fileId) continue;
            const kind = file.mimeType.startsWith("video/") ? "videos" : file.mimeType.startsWith("audio/") ? "audios" : "images";
            replaceCanvasFileReference(item.project, file.fileId, await services.uploadBlob(blob, kind));
        }
    }
}

export function replaceCanvasFileReference(value: unknown, fileId: string, replacement: UploadResult) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((item) => replaceCanvasFileReference(item, fileId, replacement));
        return;
    }
    const record = value as Record<string, unknown>;
    if (record.fileId === fileId) {
        record.fileId = replacement.fileId;
        if (typeof record.content === "string") record.content = replacement.url;
        if (typeof record.dataUrl === "string") record.dataUrl = replacement.url;
        if (typeof record.url === "string") record.url = replacement.url;
        if ("storageKey" in record) record.storageKey = "";
        if ("mimeType" in record) record.mimeType = replacement.mimeType;
        if ("bytes" in record) record.bytes = replacement.bytes;
        if ("naturalWidth" in record) record.naturalWidth = replacement.width;
        if ("naturalHeight" in record) record.naturalHeight = replacement.height;
        if ("width" in record && typeof record.width === "number") record.width = replacement.width;
        if ("height" in record && typeof record.height === "number") record.height = replacement.height;
    }
    Object.values(record).forEach((item) => replaceCanvasFileReference(item, fileId, replacement));
}
