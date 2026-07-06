import { readImageMeta } from "@/lib/image-utils";

type UploadResult = {
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

/** Upload a blob (image or video) to S3 under {fileType}/{userId}/ and return fileId + presigned URL. */
export async function uploadBlob(blob: Blob, fileType: FileType): Promise<UploadResult> {
  const ext = blob.type.split("/")[1] || (fileType.endsWith("images") ? "png" : "mp4");
  const fileName = `generated-${Date.now()}.${ext}`;

  // Step 1: get presigned upload URL
  const headers = { "Content-Type": "application/json", ...authHeader() };
  const presignResp = await fetch("/api/v1/files/upload-url", {
    method: "POST",
    body: JSON.stringify({ fileType, fileName, mimeType: blob.type }),
    headers,
  });
  const presignJson = await presignResp.json();
  if (presignJson.code !== 0) throw new Error(presignJson.msg || "获取上传地址失败");
  const { uploadUrl, confirmId } = presignJson.data;

  // Step 2: upload directly to S3
  const putResp = await fetch(uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
  if (!putResp.ok) throw new Error("上传到存储失败");

  // Step 3: confirm upload
  const confirmResp = await fetch("/api/v1/files/confirm", {
    method: "POST",
    body: JSON.stringify({ confirmId, bytes: blob.size }),
    headers,
  });
  const confirmJson = await confirmResp.json();
  if (confirmJson.code !== 0) throw new Error(confirmJson.msg || "确认上传失败");

  const url = confirmJson.data.s3Key;
  const fileId = confirmJson.data.id;
  const meta = fileType === "images" ? await readImageMeta(URL.createObjectURL(blob)) : { width: 0, height: 0 };
  return { fileId, url, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || (fileType === "images" ? "image/png" : "video/mp4") };
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
