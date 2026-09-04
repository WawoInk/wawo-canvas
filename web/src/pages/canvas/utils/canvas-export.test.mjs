import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");

const imageBlobs = new Map([
    ["image:one", new Blob(["one"], { type: "image/png" })],
    ["image:two", new Blob(["two"], { type: "image/png" })],
]);
const mediaBlobs = new Map([["media:video", new Blob(["video"], { type: "video/mp4" })]]);
const platformBlobs = new Map([["file-1", new Blob(["remote-video"], { type: "video/mp4" })]]);
const zipBlob = new Blob(["zip"], { type: "application/zip" });
let zipFiles = [];
let saved = [];

mock.module("@/lib/zip", () => ({
    createZip: async (files) => {
        zipFiles = files;
        return zipBlob;
    },
}));
mock.module("@/services/blob-storage", () => ({
    getImageBlob: async (storageKey) => imageBlobs.get(storageKey) || null,
    getMediaBlob: async (storageKey) => mediaBlobs.get(storageKey) || null,
    setImageBlob: async () => "blob:image",
    setMediaBlob: async () => "blob:media",
}));
mock.module("@/services/api/files", () => ({ readPlatformFileBlob: async (fileId) => platformBlobs.get(fileId) || null }));
mock.module("file-saver", () => ({
    saveAs: (...args) => {
        saved = args;
    },
}));

const { exportCanvasNodes } = await import("./canvas-export.ts");

test("exports selected text, local media blobs, data URLs, and JSON fallbacks with safe unique names", async () => {
    zipFiles = [];
    saved = [];
    const nodes = [
        { id: "text", type: "text", title: "说明/稿", metadata: { content: "你好" } },
        { id: "image-one", type: "image", title: "主图:*", metadata: { storageKey: "image:one", content: "blob:one" } },
        { id: "image-two", type: "image", title: "主图:*", metadata: { storageKey: "image:two", content: "blob:two" } },
        { id: "video", type: "video", title: "片段", metadata: { storageKey: "media:video", content: "blob:video" } },
        { id: "audio", type: "audio", title: "旁白", metadata: { content: "data:audio/mpeg;base64,bXAz" } },
        { id: "remote-video", type: "video", title: "远程视频", metadata: { storageKey: "media:missing", fileId: "file-1", content: "https://example.com/video.mp4" } },
    ];

    await exportCanvasNodes(nodes, "节点/导出");

    assert.strictEqual(saved[0], zipBlob);
    assert.equal(saved[1], "节点_导出.zip");
    assert.deepEqual(
        zipFiles.map((file) => file.name),
        ["说明_稿.txt", "主图__.png", "主图__-1.png", "片段.mp4", "旁白.mp3", "远程视频.mp4"],
    );
    assert.equal(zipFiles[0].data, "你好");
    assert.strictEqual(zipFiles[1].data, imageBlobs.get("image:one"));
    assert.strictEqual(zipFiles[2].data, imageBlobs.get("image:two"));
    assert.strictEqual(zipFiles[3].data, mediaBlobs.get("media:video"));
    assert.ok(zipFiles[4].data instanceof Blob);
    assert.equal(zipFiles[4].data.type, "audio/mpeg");
    assert.strictEqual(zipFiles[5].data, platformBlobs.get("file-1"));
});

test("preserves the current Canvas project archive export", async () => {
    zipFiles = [];
    saved = [];
    const project = { id: "project-1", nodes: [{ metadata: { storageKey: "image:one" } }, { metadata: { fileId: "file-1" } }] };

    const { exportCanvasProjects } = await import("./canvas-export.ts");
    await exportCanvasProjects([project], "当前/项目");

    assert.strictEqual(saved[0], zipBlob);
    assert.equal(saved[1], "当前_项目.zip");
    assert.deepEqual(
        zipFiles.map((file) => file.name),
        ["projects.json", "projects/project-1/files/image_one.png", "projects/project-1/files/platform-file-1.mp4"],
    );
    const exported = JSON.parse(zipFiles[0].data);
    assert.equal(exported.version, 3);
    assert.equal(exported.projects[0].project.id, "project-1");
    assert.strictEqual(zipFiles[1].data, imageBlobs.get("image:one"));
    assert.strictEqual(zipFiles[2].data, platformBlobs.get("file-1"));
});
