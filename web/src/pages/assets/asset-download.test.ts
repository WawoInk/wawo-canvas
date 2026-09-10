import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof window === "undefined") GlobalRegistrator.register();
// Use an in-memory storage driver at the IndexedDB boundary; keep the real asset/blob APIs.
const localforage = (await import("localforage")).default;
const stored = new Map<string, unknown>();
await localforage.defineDriver({
    _driver: localforage.INDEXEDDB,
    _support: true,
    _initStorage: async () => {},
    getItem: async function <T>(this: LocalForage, key: string) {
        return (stored.get(`${this.config().storeName}:${key}`) ?? null) as T | null;
    },
    setItem: async function <T>(this: LocalForage, key: string, value: T) {
        stored.set(`${this.config().storeName}:${key}`, value);
        return value;
    },
    removeItem: async function (this: LocalForage, key: string) {
        stored.delete(`${this.config().storeName}:${key}`);
    },
    clear: async () => {
        stored.clear();
    },
    length: async () => stored.size,
    key: async (index) => [...stored.keys()][index] ?? null,
    keys: async () => [...stored.keys()],
    iterate: async () => {
        throw new Error("iteration is not used by file storage");
    },
});
const { useUserStore } = await import("@/stores/use-user-store");
const { readAssetDownload } = await import("./asset-transfer");

test("asset download reads the authenticated platform file rather than an expired preview and preserves its filename", async () => {
    const state = useUserStore.getState();
    const fetch = globalThis.fetch;
    useUserStore.setState({ token: "download-token", user: { id: "owner", username: "owner", displayName: "Owner", role: "user", credits: "0", email: "", avatarUrl: "", createdAt: "", updatedAt: "" } });
    globalThis.fetch = (async (url, init) => {
        assert.equal(String(url), "/api/v1/files/file-id/content");
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer download-token");
        return new Response(new Blob(["actual-image"], { type: "image/png" }));
    }) as typeof fetch;
    try {
        const file = await readAssetDownload({
            id: "asset-1",
            coverUrl: "",
            tags: [],
            createdAt: "",
            updatedAt: "",
            kind: "image",
            title: "中文 空格《图片》",
            data: { width: 1, height: 1, bytes: 12, fileId: "file-id", dataUrl: "https://expired.invalid/preview", mimeType: "image/png" },
        });
        assert.equal(await file.text(), "actual-image");
        assert.equal(file.name, "中文 空格《图片》.png");
        assert.equal(file.type, "image/png");
    } finally {
        globalThis.fetch = fetch;
        useUserStore.setState(state);
    }
});

test("local asset download reads stored bytes even after its preview object URL expires", async () => {
    const { setImageBlob, deleteStoredImages } = await import("@/services/blob-storage");
    const key = "image:asset-download-test";
    const fetch = globalThis.fetch;
    await setImageBlob(key, new Blob(["stored-image"], { type: "image/webp" }));
    globalThis.fetch = (async () => {
        throw new Error("must not fetch preview");
    }) as typeof fetch;
    try {
        const file = await readAssetDownload({
            id: "local",
            coverUrl: "",
            tags: [],
            createdAt: "",
            updatedAt: "",
            kind: "image",
            title: "本地图",
            data: { width: 1, height: 1, bytes: 12, storageKey: key, dataUrl: "blob:expired", mimeType: "image/webp" },
        });
        assert.equal(await file.text(), "stored-image");
        assert.equal(file.name, "本地图.webp");
    } finally {
        globalThis.fetch = fetch;
        await deleteStoredImages([key]);
    }
});

test("an embedded image without a storage key is downloaded as bytes", async () => {
    const file = await readAssetDownload({
        id: "embedded",
        coverUrl: "",
        tags: [],
        createdAt: "",
        updatedAt: "",
        kind: "image",
        title: "内嵌图片",
        data: { width: 1, height: 1, bytes: 5, dataUrl: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
    });
    assert.equal(await file.text(), "hello");
    assert.equal(file.name, "内嵌图片.png");
});
