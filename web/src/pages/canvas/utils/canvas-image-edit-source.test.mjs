import assert from "node:assert/strict";
import { test } from "node:test";

import { findImageEditSourceNode } from "./canvas-image-edit-source.ts";

const imageA = { id: "A", type: "image", metadata: { content: "https://example.com/a.png" } };
const emptyImageB = { id: "B", type: "image", metadata: {} };

test("uses the referenced upstream image as the async edit source", () => {
    assert.equal(findImageEditSourceNode(emptyImageB, [{ id: "A" }], [imageA, emptyImageB]), imageA);
});
