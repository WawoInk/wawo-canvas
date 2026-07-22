import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePromptTokens, serializePromptTokens } from "./canvas-prompt-chips.ts";

const references = [
    { nodeId: "image-1", label: "图片1", active: true },
    { nodeId: "image-2", label: "图片2", active: true },
];

test("round-trips ordinary prompt labels as ordered resource chips", () => {
    const tokens = parsePromptTokens("让 图片2 站在 图片1 后面", references);
    assert.deepEqual(tokens, [
        { type: "text", value: "让 " },
        { type: "reference", nodeId: "image-2", label: "图片2" },
        { type: "text", value: " 站在 " },
        { type: "reference", nodeId: "image-1", label: "图片1" },
        { type: "text", value: " 后面" },
    ]);
    assert.equal(serializePromptTokens(tokens), "让 图片2 站在 图片1 后面");
});

test("keeps missing resources as editable text labels", () => {
    assert.deepEqual(parsePromptTokens("保留 图片3", references), [{ type: "text", value: "保留 图片3" }]);
});

test("editing prompt chips leaves Canvas connections unchanged", () => {
    const connections = [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "target-1" }];
    const before = structuredClone(connections);
    assert.equal(serializePromptTokens(parsePromptTokens("使用 图片1", references)), "使用 图片1");
    assert.deepEqual(connections, before);
});
