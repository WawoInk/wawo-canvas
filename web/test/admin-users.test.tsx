import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";

import AdminUsersPage from "../src/pages/admin/users/index.tsx";

import i18n from "../src/i18n";

await i18n.changeLanguage("zh-CN");

test("用户管理列表展示用户 ID", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["admin", "users", "", "", 1, 10], {
        items: [
            {
                id: "user-id-123",
                username: "admin-user",
                email: "",
                displayName: "管理员用户",
                avatarUrl: "",
                role: "admin",
                credits: "0",
                affCode: "",
                affCount: 0,
                inviterId: "",
                linuxDoId: "",
                status: "active",
                lastLoginAt: "",
                createdAt: "",
                updatedAt: "",
            },
        ],
        total: 1,
    });

    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(App, null, createElement(AdminUsersPage))));

    assert.match(html, /用户 ID/);
    assert.match(html, /user-id-123/);
    assert.match(html, /aria-label="copy"/);
});
