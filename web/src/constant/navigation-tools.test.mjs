import assert from "node:assert/strict";
import { test } from "node:test";

import { navigationTools } from "./navigation-tools.ts";

test("top navigation follows the requested product order", () => {
    assert.deepEqual(
        navigationTools.map((tool) => tool.slug),
        ["canvas", "storyboard", "image", "video", "assets", "volcengine-assets", "prompts"],
    );
});
