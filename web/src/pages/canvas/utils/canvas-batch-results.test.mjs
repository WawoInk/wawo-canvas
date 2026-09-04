import assert from "node:assert/strict";
import test from "node:test";

import { failCanvasBatchResult } from "./canvas-batch-results.ts";

const nodes = [
    { id: "root", type: "image", metadata: { isBatchRoot: true, batchChildIds: ["a", "b"], status: "loading" } },
    { id: "a", type: "image", metadata: { batchRootId: "root", status: "loading" } },
    { id: "b", type: "image", metadata: { batchRootId: "root", status: "error" } },
];

test("converges the batch root only when every image result has finished", () => {
    const failed = failCanvasBatchResult(nodes, "a", "failed", false);
    assert.equal(failed.find((node) => node.id === "a").metadata.status, "error");
    assert.equal(failed.find((node) => node.id === "root").metadata.status, "error");

    const partial = failCanvasBatchResult([{ ...nodes[2], metadata: { ...nodes[2].metadata, status: "loading" } }, ...nodes.slice(0, 2)], "a", "failed", false);
    assert.equal(partial.find((node) => node.id === "root").metadata.status, "loading");
});
