import assert from "node:assert/strict";
import { test } from "node:test";

import i18n from "../i18n/index.ts";
import { formatDecimal } from "./decimal.ts";

test("formats exact decimal strings without losing precision", async () => {
    await i18n.changeLanguage("en-US");
    assert.equal(formatDecimal("12345678901234567890.123400"), "12,345,678,901,234,567,890.1234");
    assert.equal(formatDecimal("-1000.25"), "-1,000.25");

    await i18n.changeLanguage("zh-CN");
    assert.equal(formatDecimal("1234567.89"), "1,234,567.89");
});
