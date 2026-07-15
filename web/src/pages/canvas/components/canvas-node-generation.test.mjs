import assert from "node:assert/strict";
import { test } from "node:test";

import { buildVideoGenerationIntent } from "./canvas-node-generation.ts";

const image = {
    id: "image-1",
    type: "image",
    title: "人物参考",
    metadata: {
        content: "data:image/png;base64,secret",
        storageKey: "indexed-db-key",
        fileId: "file-image-1",
    },
};
const videoTarget = { id: "video-1", type: "video", title: "输出视频", metadata: {} };

test("compiles Canvas media as platform file references", () => {
    const intent = buildVideoGenerationIntent("video-1", [image, videoTarget], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "人物走进雨夜街道");

    assert.deepEqual(intent, {
        kind: "video.generate",
        prompt: "人物走进雨夜街道",
        references: {
            images: [{ fileId: "file-image-1", sourceNodeId: "image-1", name: "人物参考" }],
            videos: [],
            audios: [],
        },
        settings: {},
    });
    const serialized = JSON.stringify(intent);
    for (const providerField of ["dataUrl", "storageKey", "image_url", "content"]) assert.equal(serialized.includes(providerField), false);
});
