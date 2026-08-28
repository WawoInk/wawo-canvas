import assert from "node:assert/strict";
import { test } from "node:test";

import { navigationTools } from "./navigation-tools.ts";

test("primary creation navigation places storyboard between image workbench and canvas", () => {
    assert.deepEqual(
        navigationTools.slice(0, 3).map((tool) => tool.slug),
        ["image", "storyboard", "canvas"],
    );
});
