import assert from "node:assert/strict";
import test from "node:test";

import { fitNodeToAspect } from "./canvas-node-size.ts";

test("keeps a batch root centered and preserves free-resize dimensions when switching primary results", () => {
    const node = { position: { x: 100, y: 80 }, width: 300, height: 200, metadata: {} };
    assert.deepEqual(fitNodeToAspect(node, 800, 1200), { position: { x: 150, y: 30 }, width: 200, height: 300 });
    assert.deepEqual(fitNodeToAspect({ ...node, metadata: { freeResize: true } }, 800, 1200), { position: node.position, width: 300, height: 200 });
});
