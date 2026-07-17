import { readImageMeta } from "@/lib/image-utils";

export type UploadResult = {
    fileId: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    durationMs?: number;
};

const fileTypeValues = ["images", "videos", "audios", "results/images", "results/videos", "results/audios"] as const;
type FileType = (typeof fileTypeValues)[number];

function authHeader(): Record<string, string> {
    try {
        const raw = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
        const parsed = JSON.parse(raw);
        const token = parsed?.state?.token || "";
        if (!token) return {};
        return { Authorization: `Bearer ${token}` };
    } catch {
        return {};
    }
}

function videoMeta(blob: Blob): Promise<{ width: number; height: number; durationMs?: number }> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const video = document.createElement("video");
        const done = () => {
            URL.revokeObjectURL(url);
            resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        };
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function audioMeta(blob: Blob): Promise<{ durationMs?: number }> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const audio = document.createElement("audio");
        const done = () => {
            URL.revokeObjectURL(url);
            resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        };
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

/** Upload a blob to S3 via backend multipart (no CORS). */
async function uploadBlobServer(blob: Blob, fileType: FileType): Promise<UploadResult> {
    const form = new FormData();
    form.set("fileType", fileType);
    form.set("file", blob, `generated-${Date.now()}.${blob.type.split("/")[1] || "png"}`);
    const headers = { ...authHeader() };
    const resp = await fetch("/api/v1/files", { method: "POST", body: form, headers });
    const json = await resp.json();
    if (json.code !== 0) throw new Error(json.msg || "上传失败");
    const { id, s3Key, mimeType, bytes } = json.data;
    if (fileType === "images" || fileType === "results/images") {
        const meta = await readImageMeta(URL.createObjectURL(blob));
        return { fileId: id, url: s3Key, width: meta.width, height: meta.height, bytes: bytes || blob.size, mimeType: mimeType || blob.type };
    }
    if (fileType === "videos" || fileType === "results/videos") {
        const meta = await videoMeta(blob);
        return { fileId: id, url: s3Key, width: meta.width, height: meta.height, bytes: bytes || blob.size, mimeType: mimeType || blob.type, durationMs: meta.durationMs };
    }
    if (fileType === "audios" || fileType === "results/audios") {
        const meta = await audioMeta(blob);
        return { fileId: id, url: s3Key, width: 0, height: 0, bytes: bytes || blob.size, mimeType: mimeType || blob.type, durationMs: meta.durationMs };
    }
    return { fileId: id, url: s3Key, width: 0, height: 0, bytes: bytes || blob.size, mimeType: mimeType || blob.type };
}

/** Upload a blob (image or video) to S3 under {fileType}/{userId}/ and return fileId + presigned URL. */
export async function uploadBlob(blob: Blob, fileType: FileType): Promise<UploadResult> {
    // ponytail: server-side upload avoids S3 CORS — browser-direct PUT to S3 needs bucket CORS config
    return uploadBlobServer(blob, fileType);
}

/** Download a URL via the backend proxy (handles CORS-restricted sources) and upload to S3. */
export async function uploadUrlToS3(url: string, fileType: FileType): Promise<UploadResult> {
    const ext = fileType.endsWith("videos") ? "mp4" : "png";
    const fileName = `generated-${Date.now()}.${ext}`;
    const headers = { "Content-Type": "application/json", ...authHeader() };
    const resp = await fetch("/api/v1/files/proxy-upload", {
        method: "POST",
        body: JSON.stringify({ url, fileType, fileName }),
        headers,
    });
    const json = await resp.json();
    if (json.code !== 0) throw new Error(json.msg || "代理上传失败");
    const meta = fileType.endsWith("images") ? { width: 1024, height: 1024 } : { width: 0, height: 0 };
    return { fileId: json.data.id, url: json.data.s3Key, width: meta.width, height: meta.height, bytes: json.data.bytes || 0, mimeType: json.data.mimeType || "application/octet-stream" };
}
