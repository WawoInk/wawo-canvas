import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { getMediaBlob, getImageBlob } from "@/services/blob-storage";
import { readPlatformFileBlob } from "@/services/api/files";
import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { collectCanvasExportReferences } from "./canvas-export-references";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultFileName")) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            const references = collectCanvasExportReferences(project);
            await Promise.all(
                [...references.storageKeys].map(async (storageKey) => {
                    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) throw new Error(i18n.t("canvas.export.missingMedia", { reference: storageKey }));
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            await Promise.all(
                [...references.fileIds].map(async (fileId) => {
                    const blob = await readPlatformFileBlob(fileId).catch(() => {
                        throw new Error(i18n.t("canvas.export.missingMedia", { reference: fileId }));
                    });
                    if (!blob) throw new Error(i18n.t("canvas.export.missingMedia", { reference: fileId }));
                    const path = `projects/${project.id}/files/platform-${safeFileName(fileId)}.${fileExtension(blob.type, "")}`;
                    files.push({ fileId, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName", { defaultValue: "画布元素" })) {
    const files: { name: string; data: BlobPart }[] = [];
    const usedNames = new Set<string>();
    const uniqueName = (title: string, extension: string) => {
        const base = safeFileName(title) || i18n.t("canvas.export.item", { defaultValue: "元素" });
        let name = `${base}.${extension}`;
        for (let suffix = 1; usedNames.has(name.toLowerCase()); suffix += 1) name = `${base}-${suffix}.${extension}`;
        usedNames.add(name.toLowerCase());
        return name;
    };

    for (const node of nodes) {
        const title = node.title || node.type;
        const storageKey = node.metadata?.storageKey || "";
        const localBlob = storageKey ? await (storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey)) : null;
        const blob = localBlob || (node.metadata?.fileId ? await readPlatformFileBlob(node.metadata.fileId).catch(() => null) : null);
        if (blob) {
            files.push({ name: uniqueName(title, fileExtension(blob.type, storageKey)), data: blob });
            continue;
        }
        if (node.type === CanvasNodeType.Text) {
            files.push({ name: uniqueName(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            continue;
        }
        const content = node.metadata?.content;
        if (content?.startsWith("data:")) {
            const dataBlob = await (await fetch(content)).blob();
            files.push({ name: uniqueName(title, fileExtension(dataBlob.type, storageKey)), data: dataBlob });
            continue;
        }
        files.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
    }

    const zip = await createZip(files);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
