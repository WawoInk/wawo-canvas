import assert from "node:assert/strict";
import test from "node:test";

const calls = [];
// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/services/api/request", () => ({
    apiGet: async (...args) => {
        calls.push(args);
        return { items: [], total: 0 };
    },
    apiPost: async () => undefined,
    apiDelete: async () => undefined,
    compactApiParams: (value) => value,
}));

const { fetchAdminEnterpriseCreditLogs } = await import("./admin.ts?enterprise-credit-log-test");

test("enterprise credit log query forwards every admin filter", async () => {
    const filters = {
        enterprise_id: "enterprise-1",
        enterprise_name: "示例企业",
        model: "image-model",
        status: "failed",
        start_time: "2026-08-01T00:00:00.000Z",
        end_time: "2026-08-31T23:59:59.999Z",
        page: 2,
        pageSize: 50,
    };

    await fetchAdminEnterpriseCreditLogs("admin-token", filters);

    assert.deepEqual(calls, [["/api/admin/enterprise-credit-logs", filters, "admin-token"]]);
});
