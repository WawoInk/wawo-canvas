import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.tsx", import.meta.url), "utf8");

test("running image generation keeps the cancel button clickable with visible progress feedback", () => {
    assert.doesNotMatch(source, /loading=\{running\}/);
    assert.match(source, /icon=\{running \? <LoaderCircle/);
    assert.match(source, /disabled=\{!canGenerate && !running\}/);
    assert.match(source, /onClick=\{\(\) => \(running \? cancelGeneration\(\) : void generate\(\)\)\}/);
});
