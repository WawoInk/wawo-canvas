import { expect, test } from "bun:test";

import { focusViewportForNode } from "../src/pages/canvas/utils/canvas-node-geometry";

test("focusing a node centers it without zooming past its natural size", () => {
    const node = { position: { x: 1234, y: -567 }, width: 340, height: 240 };
    const viewport = focusViewportForNode(node, { width: 900, height: 600 });
    expect(viewport.k).toBe(1);
    expect(viewport.x + 1404 * viewport.k).toBe(450);
    expect(viewport.y - 447 * viewport.k).toBe(300);
});

test("focusing keeps the node, its open panel and hover toolbar clear of the bottom dock", () => {
    const node = { position: { x: 0, y: 0 }, width: 340, height: 500 };
    const viewport = focusViewportForNode(node, { width: 900, height: 700 }, { above: 62, below: 316, bottomInset: 76 });
    const top = viewport.y - 62;
    const bottom = viewport.y + 500 * viewport.k + 316;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(624);
    expect(624 - bottom).toBeCloseTo(top / 3, 6);
});
