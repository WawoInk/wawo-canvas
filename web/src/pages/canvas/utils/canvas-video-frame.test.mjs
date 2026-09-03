import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveVideoFrameTime } from "./canvas-video-frame.ts";

test("resolves first, current, and final video frame times inside media bounds", () => {
    assert.equal(resolveVideoFrameTime(12, "first", 8), 0);
    assert.equal(resolveVideoFrameTime(12, "current", 8), 8);
    assert.equal(resolveVideoFrameTime(12, "current", 30), 11.999);
    assert.equal(resolveVideoFrameTime(12, "current", -2), 0);
    assert.equal(resolveVideoFrameTime(12, "last", 0), 11.999);
    assert.equal(resolveVideoFrameTime(Number.NaN, "last", 5), 0);
});
