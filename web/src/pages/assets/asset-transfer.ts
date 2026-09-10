import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob, getImageBlob, setImageBlob } from "@/services/blob-storage";
import { readPlatformFileBlob } from "@/services/api/files";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function readAssetDownload(asset: Asset) {
    if (asset.kind !== "image" && asset.kind !== "video") throw new Error(i18n.t("errors.file.readFailed"));
    let blob = asset.data.fileId ? await readPlatformFileBlob(asset.data.fileId) : asset.data.storageKey ? await (asset.kind === "image" ? getImageBlob(asset.data.storageKey) : getMediaBlob(asset.data.storageKey)) : null;
    if (!blob && !asset.data.fileId) {
        const response = await fetch(asset.kind === "image" ? asset.data.dataUrl : asset.data.url);
        if (!response.ok || response.headers.get("content-type")?.includes("application/json")) throw new Error(i18n.t("errors.file.readFailed", { defaultValue: "文件读取失败" }));
        blob = await response.blob();
    }
    if (!blob?.size) throw new Error(i18n.t("errors.file.readFailed", { defaultValue: "文件读取失败" }));
    return new File([blob], `${safeFileName(asset.title || i18n.t("assets.download.defaultFileName"))}.${fileExtension(blob.type || asset.data.mimeType, asset.kind)}`, { type: blob.type || asset.data.mimeType });
}

export async function exportAssets(assets: Asset[]) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind !== "image" && asset.kind !== "video") return;
            const storageKey = asset.data.storageKey;
            if (!storageKey) return;
            const blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) return;
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, i18n.t("assets.export.fileName"));
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error(i18n.t("assets.errors.missingManifest", { fileName: "assets.json" }));
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    await Promise.all(
        data.files.map(async (item) => {
            const blob = zip.get(item.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }),
    );
    return data.assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
