import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGenerationCommand } from "./generations.ts";

test("builds the first-party prompt-only video command", () => {
    assert.deepEqual(
        buildGenerationCommand({
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            prompt: "人物走进雨夜街道",
        }),
        {
            commandVersion: 1,
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            intent: { kind: "video.generate", prompt: "人物走进雨夜街道" },
        },
    );
});
