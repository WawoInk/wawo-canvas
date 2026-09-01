import assert from "node:assert/strict";
import { test } from "node:test";

import enUS from "@/i18n/locales/en-US.json";
import zhCN from "@/i18n/locales/zh-CN.json";

const { seoPage } = await import("./client-root-init.tsx");

test("剧本 Agent 路由使用正确的浏览器标题", () => {
    for (const pathname of ["/storyboard/script-agent", "/storyboard/script-agent/project-1"]) {
        const page = seoPage(pathname);
        assert.equal(page, "scriptAgent");
        assert.equal(zhCN.seo.pages[page].title, "剧本 Agent | Canvan");
        assert.equal(enUS.seo.pages[page].title, "Script Agent | Canvan");
    }
});

test("脑暴 Agent 路由沿用分镜创作室浏览器标题", () => {
    const page = seoPage("/storyboard/brainstorm-agent");
    assert.equal(page, "storyboard");
    assert.equal(zhCN.seo.pages[page].title, "分镜创作室 | Canvan");
    assert.equal(enUS.seo.pages[page].title, "Storyboard Studio | Canvan");
});
