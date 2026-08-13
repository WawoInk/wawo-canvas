import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generationCalls: Array<Record<string, unknown>> = [];
const creditCalls: Array<Record<string, unknown>> = [];
let creditItems: Array<Record<string, unknown>> = [];

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const axios = (await import("axios")).default;
const dayjs = (await import("dayjs")).default;
const { useUserStore } = await import("@/stores/use-user-store");
const { default: AdminGenerationTasksPage } = await import("../src/pages/admin/generation-tasks/index.tsx");
const { default: AdminCreditLogsPage } = await import("../src/pages/admin/credit-logs/index.tsx");
const selectedStart = dayjs().startOf("month").date(10);
const selectedEnd = dayjs().startOf("month").date(12);

test("使用日志选择和清空日期范围会更新管理员查询参数", async () => {
    generationCalls.length = 0;
    const restoreRequest = interceptAdminRequests();
    const previousUserState = useUserStore.getState();
    useUserStore.setState({
        token: "admin-date-filter-token",
        user: {
            id: "admin-date-filter-user",
            username: "admin-date-filter",
            email: "",
            displayName: "",
            avatarUrl: "",
            role: "admin",
            credits: "0",
            createdAt: "",
            updatedAt: "",
        },
        isReady: true,
        isLoading: false,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    try {
        await act(async () => {
            root.render(
                createElement(
                    ConfigProvider,
                    null,
                    createElement(
                        App,
                        null,
                        createElement(QueryClientProvider, { client: queryClient }, createElement(AdminGenerationTasksPage)),
                    ),
                ),
            );
        });
        await waitFor(() => generationCalls.length > 0);
        generationCalls.length = 0;

        await act(async () => click(required(document.querySelector<HTMLInputElement>('input[date-range="start"]'))));
        await act(async () => click(required(document.querySelector<HTMLElement>(`td[title="${selectedStart.format("YYYY-MM-DD")}"]`))));
        await act(async () => click(required(document.querySelector<HTMLElement>(`td[title="${selectedEnd.format("YYYY-MM-DD")}"]`))));

        await waitFor(() => generationCalls.some((query) => query.start_time && query.end_time));
        const selected = [...generationCalls].reverse().find((query) => query.start_time && query.end_time);
        assert.ok(selected);
        assert.equal(selected.start_time, selectedStart.startOf("day").toISOString());
        assert.equal(selected.end_time, selectedEnd.endOf("day").toISOString());
        assert.equal(selected.page, 1);
        assert.equal(selected.pageSize, 10);

        generationCalls.length = 0;
        await act(async () => click(required(document.querySelector<HTMLElement>(".ant-picker-clear"))));
        await waitFor(() => generationCalls.some((query) => query.start_time === undefined && query.end_time === undefined));
        const cleared = [...generationCalls].reverse().find((query) => query.start_time === undefined && query.end_time === undefined);
        assert.ok(cleared);
        assert.equal(cleared.page, 1);
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        restoreRequest();
        useUserStore.setState(previousUserState);
    }
});

test("算力点日志选择和清空日期范围会更新管理员查询参数", async () => {
    creditCalls.length = 0;
    creditItems = [];
    const restoreRequest = interceptAdminRequests();
    const previousUserState = useUserStore.getState();
    useUserStore.setState({
        token: "admin-credit-date-filter-token",
        user: {
            id: "admin-credit-date-filter-user",
            username: "admin-credit-date-filter",
            email: "",
            displayName: "",
            avatarUrl: "",
            role: "admin",
            credits: "0",
            createdAt: "",
            updatedAt: "",
        },
        isReady: true,
        isLoading: false,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    try {
        await act(async () => {
            root.render(
                createElement(
                    ConfigProvider,
                    null,
                    createElement(
                        App,
                        null,
                        createElement(QueryClientProvider, { client: queryClient }, createElement(AdminCreditLogsPage)),
                    ),
                ),
            );
        });
        await waitFor(() => creditCalls.length > 0);
        creditCalls.length = 0;

        await act(async () => click(required(document.querySelector<HTMLInputElement>('input[date-range="start"]'))));
        await act(async () => click(required(document.querySelector<HTMLElement>(`td[title="${selectedStart.format("YYYY-MM-DD")}"]`))));
        await act(async () => click(required(document.querySelector<HTMLElement>(`td[title="${selectedEnd.format("YYYY-MM-DD")}"]`))));

        await waitFor(() => creditCalls.some((query) => query.start_time && query.end_time));
        const selected = [...creditCalls].reverse().find((query) => query.start_time && query.end_time);
        assert.ok(selected);
        assert.equal(selected.start_time, selectedStart.startOf("day").toISOString());
        assert.equal(selected.end_time, selectedEnd.endOf("day").toISOString());
        assert.equal(selected.page, 1);
        assert.equal(selected.pageSize, 10);

        creditCalls.length = 0;
        await act(async () => click(required(document.querySelector<HTMLElement>(".ant-picker-clear"))));
        await waitFor(() => creditCalls.some((query) => query.start_time === undefined && query.end_time === undefined));
        const cleared = [...creditCalls].reverse().find((query) => query.start_time === undefined && query.end_time === undefined);
        assert.ok(cleared);
        assert.equal(cleared.page, 1);
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        restoreRequest();
        useUserStore.setState(previousUserState);
    }
});

test("算力点日志表格展示记录对应的用户名", async () => {
    creditCalls.length = 0;
    creditItems = [
        {
            id: "credit-log-with-username",
            userId: "user-with-username",
            username: "visible-credit-user",
            type: "admin_adjust",
            amount: "1",
            balance: "2",
            relatedId: "",
            remark: "",
            extra: "",
            createdAt: "2026-08-13T00:00:00Z",
        },
    ];
    const restoreRequest = interceptAdminRequests();
    const previousUserState = useUserStore.getState();
    useUserStore.setState({
        token: "admin-credit-username-token",
        user: {
            id: "admin-credit-username-user",
            username: "admin-credit-username",
            email: "",
            displayName: "",
            avatarUrl: "",
            role: "admin",
            credits: "0",
            createdAt: "",
            updatedAt: "",
        },
        isReady: true,
        isLoading: false,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    try {
        await act(async () => {
            root.render(
                createElement(
                    ConfigProvider,
                    null,
                    createElement(
                        App,
                        null,
                        createElement(QueryClientProvider, { client: queryClient }, createElement(AdminCreditLogsPage)),
                    ),
                ),
            );
        });
        await waitFor(() => creditCalls.length > 0);
        await waitFor(() => container.textContent?.includes("user-with-username") === true);
        assert.match(container.textContent || "", /visible-credit-user/);
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        creditItems = [];
        restoreRequest();
        useUserStore.setState(previousUserState);
    }
});

function interceptAdminRequests() {
    const previousRequest = axios.request;
    axios.request = (async (config: { url?: string; params?: Record<string, unknown> }) => {
        if (config.url === "/api/admin/generation-tasks") {
            generationCalls.push(config.params || {});
            return successResponse({ items: [], total: 0 });
        }
        if (config.url === "/api/admin/credit-logs") {
            creditCalls.push(config.params || {});
            return successResponse({ items: creditItems, total: creditItems.length });
        }
        throw new Error(`unexpected admin request: ${config.url}`);
    }) as typeof axios.request;
    return () => {
        axios.request = previousRequest;
    };
}

function successResponse(data: unknown) {
    return {
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
        data: { code: 0, data, msg: "" },
    };
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
}

function click(element: Element) {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
