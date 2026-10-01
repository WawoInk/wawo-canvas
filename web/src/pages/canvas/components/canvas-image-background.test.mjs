import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "@/stores/use-config-store";
import { buildSavedImageConfig } from "./canvas-node-config.ts";

const globalConfig = { ...defaultConfig, model: "global", imageModel: "global-image", quality: "auto", size: "1:1", count: "3" };

test("image retry uses the saved background snapshot", () => {
    assert.equal(buildSavedImageConfig({ ...globalConfig, background: "transparent" }, { generationType: "generation" }).background, "");
    assert.equal(buildSavedImageConfig({ ...globalConfig, background: "" }, { generationType: "generation", background: "transparent" }).background, "transparent");
});
