"use client";

/** Refresh presigned download URLs for fileIds from the backend, returns {fileId: presignedUrl} map. */
export async function resolveFileUrls(fileIds: string[]): Promise<Map<string, string>> {
    if (!fileIds.length) return new Map();
    const raw = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
    let token = "";
    try {
        token = JSON.parse(raw)?.state?.token || "";
    } catch {}
    if (!token) return new Map();

    const uniqueIds = [...new Set(fileIds)];
    const results = await Promise.allSettled(
        uniqueIds.map(async (fileId) => {
            try {
                const resp = await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = await resp.json();
                if (json.code === 0 && json.data?.url) return [fileId, json.data.url] as const;
            } catch {}
            return null;
        }),
    );
    const map = new Map<string, string>();
    for (const r of results) {
        if (r.status === "fulfilled" && r.value) map.set(r.value[0], r.value[1]);
    }
    return map;
}
