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
                    status: "succeeded",
                    credits: 12,
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
    assert.match(usageHTML, /成功/);
    assert.match(usageHTML, /12/);

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

test("账户设置提供日志记录页签", () => {
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
});

test("日志记录提供使用记录和积分记录视图", () => {
    const html = renderToStaticMarkup(createElement(App, null, createElement(AccountLogs)));

    assert.match(html, /使用记录/);
    assert.match(html, /积分记录/);
});
