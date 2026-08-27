import assert from "node:assert/strict";
import { test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";

import AdminCanvasNodesPage from "../src/pages/admin/canvas-nodes/index.tsx";

test("画布节点结果 URL 仅以文本展示", () => {
    const resultUrl = "https://cdn.example.com/results/canvas-node.png";
    const queryClient = new QueryClient();
    queryClient.setQueryData(["admin", "canvas-nodes", "", "", "", "", "", undefined, undefined, 1, 10], {
        items: [
            {
                userId: "user-id-123",
                username: "canvas-user",
                nodeId: "node-id-456",
                upstreamTaskId: "task-id-789",
                createdAt: "2026-08-27T00:00:00Z",
                resultUrl,
            },
        ],
        total: 1,
    });

    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(App, null, createElement(AdminCanvasNodesPage))));

    assert.match(html, new RegExp(resultUrl));
    assert.doesNotMatch(html, /<a\b[^>]*\bhref=/);
    assert.match(html, /ant-typography-copy/);
    assert.match(html, /Enter user ID/);
    assert.match(html, /Enter username/);
    assert.match(html, /Enter node ID/);
    assert.match(html, /Enter upstream task ID/);
});
