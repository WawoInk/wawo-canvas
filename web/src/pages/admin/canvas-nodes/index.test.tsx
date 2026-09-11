import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type PropsWithChildren, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// @ts-expect-error Bun provides module mocking at test runtime.
import { mock } from "bun:test";

const Box = ({ children }: PropsWithChildren) => createElement("div", null, children);
const Form = Object.assign(Box, {
    Item: ({ children, label }: PropsWithChildren<{ label?: ReactNode }>) => createElement("label", null, label, children),
});
const Typography = { Text: ({ children }: PropsWithChildren) => createElement("span", null, children) };

mock.module("antd", () => ({
    Button: ({ children }: PropsWithChildren) => createElement("button", null, children),
    Card: Box,
    Col: Box,
    DatePicker: { RangePicker: () => createElement("input") },
    Form,
    Input: () => createElement("input"),
    Row: Box,
    Space: Box,
    Table: ({ columns, dataSource }: { columns: Array<{ title?: ReactNode; dataIndex?: string; render?: (value: unknown) => ReactNode }>; dataSource: Record<string, unknown>[] }) =>
        createElement(
            "section",
            null,
            columns.map((column, index) =>
                createElement(
                    "div",
                    { key: index },
                    column.title,
                    dataSource.map((item) => createElement("span", { key: String(item.nodeId) }, column.render ? column.render(column.dataIndex ? item[column.dataIndex] : undefined) : String(item[column.dataIndex || ""] ?? ""))),
                ),
            ),
        ),
    Typography,
}));

mock.module("@ant-design/icons", () => ({ SearchOutlined: () => createElement("span") }));

const translations: Record<string, string> = {
    "admin.canvasNodes.table.nodeId": "节点 ID",
    "admin.canvasNodes.table.resultUrl": "生成结果 URL",
};

mock.module("react-i18next", () => ({ initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t: (key: string) => translations[key] || key }) }));
mock.module("./use-admin-canvas-nodes", () => ({
    useAdminCanvasNodes: () => ({
        nodes: [{ userId: "user-1", username: "alice", nodeId: "node-1", upstreamTaskId: "task-1", createdAt: "2026-09-11T00:00:00Z", resultUrl: "https://private.example/result.mp4" }],
        filters: { userId: "", username: "", nodeId: "", upstreamTaskId: "", dateRange: null },
        page: 1,
        pageSize: 10,
        total: 1,
        isLoading: false,
        setFilters: () => undefined,
        changePage: () => undefined,
        changePageSize: () => undefined,
        resetFilters: () => undefined,
    }),
}));

const { default: AdminCanvasNodesPage } = await import("./index");

test("画布节点信息不展示生成结果 URL", () => {
    const html = renderToStaticMarkup(createElement(AdminCanvasNodesPage));

    assert.match(html, /节点 ID/);
    assert.doesNotMatch(html, /生成结果 URL/);
    assert.doesNotMatch(html, /https:\/\/private\.example\/result\.mp4/);
});
