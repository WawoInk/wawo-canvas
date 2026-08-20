import assert from "node:assert/strict";
import { test } from "node:test";

import { imageRequestResolutionValues, normalizeAdminImageRequestFormats, normalizeAdminImageRequestResolutionSelection } from "./image-request-formats.ts";

test("图片请求格式归一化分辨率并保留四种合法值", () => {
    assert.deepEqual(imageRequestResolutionValues, ["default", "1k", "2k", "4k"]);
    assert.deepEqual(
        normalizeAdminImageRequestFormats([
            { model: "default-image", format: "default", canvasRequestMode: "split", resolutions: ["default", "2k"] },
            { model: "mixed-image", format: "application/json", canvasRequestMode: "generations", resolutions: [" 4k ", "1k", "2k", "1k"] },
            { model: "missing-image", format: "default", canvasRequestMode: "unknown" },
            { model: "invalid-image", format: "default", canvasRequestMode: "split", resolutions: ["8k"] },
            { model: "invalid-format", format: "text/plain", canvasRequestMode: "split", resolutions: ["4k"] },
        ]),
        [
            { model: "default-image", format: "default", canvasRequestMode: "split", resolutions: ["default"] },
            { model: "mixed-image", format: "application/json", canvasRequestMode: "generations", resolutions: ["1k", "2k", "4k"] },
            { model: "missing-image", format: "default", canvasRequestMode: "split", resolutions: ["default"] },
            { model: "invalid-image", format: "default", canvasRequestMode: "split", resolutions: ["default"] },
        ],
    );
});

test("默认分辨率与显式档位互斥", () => {
    assert.deepEqual(normalizeAdminImageRequestResolutionSelection(["default", "2k"], ["default"]), ["2k"]);
    assert.deepEqual(normalizeAdminImageRequestResolutionSelection(["default", "2k"], ["2k"]), ["default"]);
});
