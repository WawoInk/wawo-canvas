import { readImageMeta } from "@/lib/image-utils";

export type UploadResult = {
    fileId: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const fileTypeValues = ["images", "videos", "results/images", "results/videos"] as const;
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
    const meta = fileType.endsWith("images") ? await readImageMeta(URL.createObjectURL(blob)) : { width: 0, height: 0 };
    return { fileId: id, url: s3Key, width: meta.width, height: meta.height, bytes: bytes || blob.size, mimeType: mimeType || blob.type };
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
