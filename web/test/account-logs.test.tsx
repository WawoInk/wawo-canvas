import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { MemoryRouter } from "react-router-dom";

import AccountPage from "../src/pages/account/index.tsx";
import { AccountCreditLogTable, AccountLogs, AccountUsageLogTable } from "../src/pages/account/account-logs.tsx";
import { useUserStore } from "../src/stores/use-user-store.ts";

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
                    credits: 12,
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
    assert.match(usageHTML, /null/);

    const creditHTML = renderToStaticMarkup(
        createElement(AccountCreditLogTable, {
            items: [
                {
                    id: "credit-1",
                    userId: "user-1",
                    taskId: "task-1",
                    type: "ai_consume",
                    amount: -12,
                    balance: 88,
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
    assert.match(creditHTML, /-12/);
    assert.match(creditHTML, /88/);
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
            credits: 88,
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
