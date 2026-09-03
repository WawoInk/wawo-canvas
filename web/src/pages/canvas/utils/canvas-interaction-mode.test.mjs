import assert from "node:assert/strict";
import { test } from "node:test";

import { effectiveCanvasTool, isCanvasShortcutTarget } from "./canvas-interaction-mode.ts";

test("temporarily reverses the selected canvas tool for control, command, or space", () => {
    assert.equal(effectiveCanvasTool("pan", {}), "pan");
    assert.equal(effectiveCanvasTool("pan", { ctrlKey: true }), "select");
    assert.equal(effectiveCanvasTool("pan", { metaKey: true }), "select");
    assert.equal(effectiveCanvasTool("select", { spacePressed: true }), "pan");
});

test("does not treat editable controls or buttons as canvas shortcut targets", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) assert.equal(isCanvasShortcutTarget({ tagName, isContentEditable: false }), false);
    assert.equal(isCanvasShortcutTarget({ tagName: "DIV", isContentEditable: true }), false);
    assert.equal(isCanvasShortcutTarget({ tagName: "DIV", isContentEditable: false }), true);
});
