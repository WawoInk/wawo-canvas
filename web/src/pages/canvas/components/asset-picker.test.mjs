import assert from "node:assert/strict";
import { test } from "node:test";

import { assetFileIdsToRefresh } from "./asset-picker.ts";

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
