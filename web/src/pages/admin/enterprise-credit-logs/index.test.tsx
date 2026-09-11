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
const DatePicker = { RangePicker: () => createElement("input", { "aria-label": "date-range" }) };
const Typography = {
    Text: ({ children }: PropsWithChildren) => createElement("span", null, children),
};

mock.module("antd", () => ({
    App: { useApp: () => ({ message: { success: () => undefined, warning: () => undefined, error: () => undefined } }) },
    Button: ({ children }: PropsWithChildren) => createElement("button", null, children),
    Card: Box,
    Col: Box,
    DatePicker,
    Form,
    Input: () => createElement("input"),
    Row: Box,
    Select: () => createElement("select"),
    Space: Box,
    Tag: ({ children }: PropsWithChildren) => createElement("span", null, children),
    Typography,
}));

mock.module("@ant-design/icons", () => ({
    DownloadOutlined: () => createElement("span"),
    ReloadOutlined: () => createElement("span"),
    SearchOutlined: () => createElement("span"),
}));

mock.module("@ant-design/pro-components", () => ({
    ProTable: ({
        columns,
        dataSource,
        headerTitle,
        toolBarRender,
    }: {
        columns: Array<{ title?: ReactNode; dataIndex?: string; render?: (value: unknown, item: Record<string, unknown>) => ReactNode }>;
        dataSource: Record<string, unknown>[];
        headerTitle?: ReactNode;
        toolBarRender?: () => ReactNode[];
    }) =>
        createElement(
            "section",
            null,
            headerTitle,
            toolBarRender?.(),
            columns.map((column, index) =>
                createElement(
                    "div",
                    { key: index },
                    column.title,
                    dataSource.map((item) => createElement("span", { key: String(item.id) }, column.render ? column.render(column.dataIndex ? item[column.dataIndex] : undefined, item) : column.dataIndex ? String(item[column.dataIndex] ?? "") : "")),
                ),
            ),
        ),
}));

const translations: Record<string, string> = {
    "admin.enterpriseCreditLogs.title": "企业流水日志",
    "admin.enterpriseCreditLogs.filters.enterpriseId": "企业 ID",
    "admin.enterpriseCreditLogs.filters.enterpriseName": "企业名",
    "admin.enterpriseCreditLogs.filters.model": "模型名",
    "admin.enterpriseCreditLogs.filters.status": "状态",
    "admin.enterpriseCreditLogs.filters.dateRange": "日期范围",
    "admin.enterpriseCreditLogs.table.enterprise": "企业",
    "admin.enterpriseCreditLogs.table.account": "账号",
    "admin.enterpriseCreditLogs.table.model": "使用模型",
    "admin.enterpriseCreditLogs.table.type": "流水类型",
    "admin.enterpriseCreditLogs.table.amount": "积分变动",
    "admin.enterpriseCreditLogs.table.status": "状态",
    "admin.enterpriseCreditLogs.table.remark": "备注",
    "admin.enterpriseCreditLogs.table.time": "时间",
    "admin.enterpriseCreditLogs.types.ai_refund": "失败退款",
    "admin.enterpriseCreditLogs.export.button": "导出",
    "admin.generationTasks.statuses.failed": "失败",
};

mock.module("react-i18next", () => ({ initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t: (key: string) => translations[key] || key }) }));
mock.module("./use-admin-enterprise-credit-logs", () => ({
    emptyAdminEnterpriseCreditLogFilters: { enterpriseId: "", enterpriseName: "", model: "", status: "", dateRange: null },
    useAdminEnterpriseCreditLogs: () => ({
        logs: [
            {
                id: "log-1",
                userId: "user-1",
                enterpriseId: "enterprise-1",
                enterpriseName: "示例企业",
                username: "owner",
                displayName: "企业主",
                model: "image-model",
                type: "ai_refund",
                amount: "5",
                balance: "20",
                status: "failed",
                remark: "模型调用失败返还",
                createdAt: "2026-08-02T12:00:00Z",
            },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        isLoading: false,
        filters: { enterpriseId: "", enterpriseName: "", model: "", status: "", dateRange: null },
        applyFilters: () => undefined,
        changePage: () => undefined,
        changePageSize: () => undefined,
        resetFilters: () => undefined,
        refreshLogs: () => undefined,
        fetchAll: async () => [],
    }),
}));

const { default: AdminEnterpriseCreditLogsPage } = await import("./index");

test("renders enterprise filters, export, and an explicit failed refund row", () => {
    const html = renderToStaticMarkup(createElement(AdminEnterpriseCreditLogsPage));

    assert.match(html, /企业流水日志/);
    assert.match(html, /企业 ID.*企业名.*模型名.*状态.*日期范围/s);
    assert.match(html, /导出/);
    assert.match(html, /企业.*账号.*使用模型.*流水类型.*积分变动.*状态.*备注.*时间/s);
    assert.match(html, /示例企业.*image-model.*失败退款.*\+5.*失败/s);
});
