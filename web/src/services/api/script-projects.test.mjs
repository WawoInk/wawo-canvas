import assert from "node:assert/strict";
import { test } from "node:test";

const calls = [];
let token = "token-1";
const { mock } = await import("bun:test");
mock.module("@/i18n", () => ({ default: { t: () => "请先登录" } }));
mock.module("@/services/api/request", () => ({
    apiGet: async (...args) => (calls.push(["get", ...args]), args[0].endsWith("/project-1") ? { id: "project-1" } : [{ id: "project-1" }]),
    apiPost: async (...args) => (calls.push(["post", ...args]), { id: "project-1" }),
    apiPut: async (...args) => (calls.push(["put", ...args]), { id: "project-1" }),
    apiDelete: async (...args) => void calls.push(["delete", ...args]),
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: { getState: () => ({ token }) } }));

const {
    createScriptProject,
    deleteScriptProject,
    fetchScriptProject,
    fetchScriptProjects,
    renameScriptProject,
    updateScriptProject,
} = await import("./script-projects.ts");

const workspace = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "素材",
    currentStage: "collecting_config",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "",
    storySkeletonStatus: "empty",
    adaptationStrategy: "",
    adaptationStatus: "empty",
    scripts: [],
    messages: [],
    conversations: [],
    activeConversationId: "conversation-1",
    version: 2,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};

test("剧本项目 API 使用认证路由和固定负载", async () => {
    calls.length = 0;
    await fetchScriptProjects();
    await fetchScriptProject("project/1");
    await createScriptProject(workspace);
    await updateScriptProject("project/1", workspace, 4);
    await renameScriptProject("project/1", " 新标题 ", 5);
    await deleteScriptProject("project/1");

    assert.deepEqual(calls, [
        ["get", "/api/v1/scripts", undefined, "token-1"],
        ["get", "/api/v1/scripts/project%2F1", undefined, "token-1"],
        ["post", "/api/v1/scripts", workspace, "token-1"],
        ["put", "/api/v1/scripts/project%2F1", { ...workspace, expectedRevision: 4 }, "token-1"],
        ["put", "/api/v1/scripts/project%2F1/title", { title: "新标题", expectedRevision: 5 }, "token-1"],
        ["delete", "/api/v1/scripts/project%2F1", "token-1"],
    ]);
});

test("未登录时不会发起剧本项目请求", async () => {
    calls.length = 0;
    token = "";
    await assert.rejects(() => fetchScriptProjects());
    assert.deepEqual(calls, []);
    token = "token-1";
});
