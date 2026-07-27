import assert from "node:assert/strict";
import { test } from "node:test";

import { assetFileIdsToRefresh, assetInsertPayload, assetPreviewKind } from "./asset-picker.ts";

const assets = [
    { kind: "text", data: { content: "copy" } },
    { kind: "image", data: { fileId: "image-1" } },
    { kind: "video", data: { fileId: "video-1" } },
    { kind: "image", data: {} },
    { kind: "image", data: { fileId: "image-1" } },
];

test("refreshes unique media file URLs only while the asset picker is open", () => {
    assert.deepEqual(assetFileIdsToRefresh(true, assets), ["image-1", "video-1"]);
    assert.deepEqual(assetFileIdsToRefresh(false, assets), []);
});

test("keeps fileId when inserting an asset into Canvas", () => {
    assert.deepEqual(assetInsertPayload({ kind: "image", title: "Logo", data: { dataUrl: "https://signed/image", fileId: "file-image-1", width: 120, height: 80 } }), {
        kind: "image",
        title: "Logo",
        dataUrl: "https://signed/image",
        fileId: "file-image-1",
        width: 120,
        height: 80,
    });
    assert.deepEqual(assetInsertPayload({ kind: "video", title: "Intro", data: { url: "https://signed/video", fileId: "file-video-1", width: 1920, height: 1080 } }), {
        kind: "video",
        title: "Intro",
        url: "https://signed/video",
        fileId: "file-video-1",
        width: 1920,
        height: 1080,
    });
});

test("uses the first video frame for Assets previews", () => {
    assert.equal(assetPreviewKind("video", "https://example.com/video.mp4"), "video");
    assert.equal(assetPreviewKind("video", ""), "icon");
});
