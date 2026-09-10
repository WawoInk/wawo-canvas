import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { MemoryRouter } from "react-router-dom";

import AccountPage, { EnterpriseCreditLogs } from "../src/pages/account/index.tsx";
import { AccountCreditLogs, AccountCreditLogTable, AccountLogs, AccountUsageLogs, AccountUsageLogTable } from "../src/pages/account/account-logs.tsx";
import { useUserStore } from "../src/stores/use-user-store.ts";

import i18n from "../src/i18n";

await i18n.changeLanguage("zh-CN");

test("账户日志明确展示用户操作和积分变动", () => {
    const usageHTML = renderToStaticMarkup(
        createElement(AccountUsageLogTable, {
            items: [
                {
                    id: "task-1",
                    taskType: "video",
                    source: "canvas",
                    provider: "openai",
                    model: "video-model",
                    modelDisplayName: "精品视频模型",
                    status: "succeeded",
                    credits: "12.5",
                    upstreamCredits: null,
                    latencyMs: 2300,
                    upstreamTaskId: "upstream-1",
                    traceId: "trace-1",
                    metadata: "",
                    intentKind: "video.short-drama",
                    createdAt: "2026-07-24T08:00:00Z",
                    updatedAt: "2026-07-24T08:00:03Z",
                },
            ],
            pagination: false,
        }),
    );
    assert.match(usageHTML, /生成短剧/);
    assert.match(usageHTML, /无限画布/);
    assert.match(usageHTML, /模型展示名/);
    assert.match(usageHTML, /精品视频模型/);
    assert.match(usageHTML, /成功/);
    assert.match(usageHTML, /12/);
    assert.match(usageHTML, /暂无/);

    const creditHTML = renderToStaticMarkup(
        createElement(AccountCreditLogTable, {
            items: [
                {
                    id: "credit-1",
                    userId: "user-1",
                    taskId: "task-1",
                    type: "ai_consume",
                    amount: "-12.5",
                    balance: "87.5",
                    relatedId: "",
                    counterpartyId: "",
                    remark: "调用模型 video-model",
                    extra: "",
                    createdAt: "2026-07-24T08:00:03Z",
                },
            ],
            pagination: false,
        }),
    );
    assert.match(creditHTML, /模型消费/);
    assert.match(creditHTML, /-12.5/);
    assert.match(creditHTML, /87.5/);
    assert.match(creditHTML, /调用模型 video-model/);
});

test("企业主账户设置提供账户、日志和企业信息页签", () => {
    const session = {
        token: "token-1",
        user: {
            id: "user-1",
            username: "account-user",
            email: "",
            displayName: "账户用户",
            avatarUrl: "",
            role: "user",
            credits: "87.5",
            enterpriseId: "enterprise-1",
            enterpriseName: "测试企业",
            enterpriseRole: "owner",
            enterpriseStatus: "active",
            createdAt: "2026-07-24T08:00:00Z",
            updatedAt: "2026-07-24T08:00:00Z",
        },
        isReady: true,
        isLoading: false,
    };
    useUserStore.setState(session);
    Object.assign(useUserStore.getInitialState(), session);

    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/account"] }, createElement(App, null, createElement(AccountPage))));

    assert.match(html, /账户信息/);
    assert.match(html, /日志记录/);
    assert.match(html, /企业信息/);
    assert.match(html, /<section hidden=""[^>]*><h2[^>]*>企业概况<\/h2>/);
    assert.doesNotMatch(html, /企业成员/);
    assert.doesNotMatch(html, /企业积分流水/);
});

test("日志记录提供使用记录和积分记录视图", () => {
    const html = renderToStaticMarkup(createElement(App, null, createElement(AccountLogs)));

    assert.match(html, /使用记录/);
    assert.match(html, /积分记录/);
});

test("账户日志按当前视图显示日期筛选和导出按钮", () => {
    const usageHTML = renderToStaticMarkup(createElement(App, null, createElement(AccountUsageLogs)));
    const creditHTML = renderToStaticMarkup(createElement(App, null, createElement(AccountCreditLogs)));

    assert.match(usageHTML, /开始日期/);
    assert.match(usageHTML, /结束日期/);
    assert.match(usageHTML, /导出使用记录/);
    assert.match(creditHTML, /开始日期/);
    assert.match(creditHTML, /结束日期/);
    assert.match(creditHTML, /导出日志记录/);
});

test("企业积分流水展示时间并支持日期筛选和导出", () => {
    const html = renderToStaticMarkup(createElement(App, null, createElement(EnterpriseCreditLogs)));

    assert.match(html, /时间/);
    assert.match(html, /开始日期/);
    assert.match(html, /结束日期/);
    assert.match(html, /导出企业积分流水/);
});
