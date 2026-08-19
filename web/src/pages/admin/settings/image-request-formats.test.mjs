import assert from "node:assert/strict";
import { test } from "node:test";

import { imageRequestResolutionValues, normalizeAdminImageRequestFormats } from "./image-request-formats.ts";

test("图片请求格式归一化分辨率并保留四种合法值", () => {
    assert.deepEqual(imageRequestResolutionValues, ["default", "1k", "2k", "4k"]);
    assert.deepEqual(
        normalizeAdminImageRequestFormats([
            { model: "default-image", format: "default", canvasRequestMode: "split", resolution: "default" },
            { model: "one-k-image", format: "application/json", canvasRequestMode: "generations", resolution: " 1k " },
            { model: "two-k-image", format: "multipart/form-data", canvasRequestMode: "split", resolution: "2k" },
            { model: "four-k-image", format: "default", canvasRequestMode: "split", resolution: "4k" },
            { model: "missing-image", format: "default", canvasRequestMode: "unknown" },
            { model: "invalid-image", format: "default", canvasRequestMode: "split", resolution: "8k" },
            { model: "invalid-format", format: "text/plain", canvasRequestMode: "split", resolution: "4k" },
        ]),
        [
            { model: "default-image", format: "default", canvasRequestMode: "split", resolution: "default" },
            { model: "one-k-image", format: "application/json", canvasRequestMode: "generations", resolution: "1k" },
            { model: "two-k-image", format: "multipart/form-data", canvasRequestMode: "split", resolution: "2k" },
            { model: "four-k-image", format: "default", canvasRequestMode: "split", resolution: "4k" },
            { model: "missing-image", format: "default", canvasRequestMode: "split", resolution: "default" },
            { model: "invalid-image", format: "default", canvasRequestMode: "split", resolution: "default" },
        ],
    );
});
