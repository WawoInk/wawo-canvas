import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const canvasSource = readFileSync(new URL("../project/index.tsx", import.meta.url), "utf8");

test("all Canvas image actions use async image tasks", () => {
    if (/\brequest(?:Generation|Edit)\(/.test(canvasSource)) assert.fail("Canvas still calls a synchronous image request");
    assert.match(canvasSource, /\bcreateAsyncImageTask\(/);
    assert.match(canvasSource, /\bcreateAsyncImageEditTask\(/);
    assert.match(canvasSource, /\bpollCanvasImageNode\(/);
});
