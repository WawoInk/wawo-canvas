import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLanguage } from "./index.ts";

test("normalizes supported browser languages and defaults unsupported locales to Chinese", () => {
    assert.equal(resolveLanguage("en-US"), "en-US");
    assert.equal(resolveLanguage("en-GB"), "en-US");
    assert.equal(resolveLanguage("zh-CN"), "zh-CN");
    assert.equal(resolveLanguage("zh-TW"), "zh-CN");
    assert.equal(resolveLanguage("fr-FR"), "zh-CN");
    assert.equal(resolveLanguage(null), "zh-CN");
});
