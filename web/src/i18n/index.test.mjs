import assert from "node:assert/strict";
import { test } from "node:test";

import { appPathname, localeFromPathname, localeHref, resolveLanguage } from "./index.ts";

test("normalizes supported browser languages and defaults unsupported locales to Chinese", () => {
    assert.equal(resolveLanguage("en-US"), "en-US");
    assert.equal(resolveLanguage("en-GB"), "en-US");
    assert.equal(resolveLanguage("zh-CN"), "zh-CN");
    assert.equal(resolveLanguage("zh-TW"), "zh-CN");
    assert.equal(resolveLanguage("fr-FR"), "zh-CN");
    assert.equal(resolveLanguage(null), "zh-CN");
});

test("keeps the current route while adding or switching its locale prefix", () => {
    assert.equal(localeFromPathname("/zh-CN/canvas/123"), "zh-CN");
    assert.equal(localeFromPathname("/canvas/123"), null);
    assert.equal(localeHref({ pathname: "/canvas/123", search: "?tab=history", hash: "#node-1" }, "zh-CN"), "/zh-CN/canvas/123?tab=history#node-1");
    assert.equal(localeHref({ pathname: "/zh-CN/canvas/123", search: "?tab=history", hash: "#node-1" }, "en-US"), "/en-US/canvas/123?tab=history#node-1");
});

test("localized routes keep their original application pathname for route guards", () => {
    assert.equal(appPathname("/zh-CN/login"), "/login");
    assert.equal(appPathname("/en-US/admin/users"), "/admin/users");
});
