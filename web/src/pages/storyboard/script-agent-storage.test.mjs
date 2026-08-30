import assert from "node:assert/strict";
import { test } from "node:test";

const activeMessages = [{ id: "message-1", role: "user", content: "人物设定", createdAt: "2026-08-30T00:00:00.000Z" }];
const detail = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "原作素材",
    currentStage: "collecting_config",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "",
    storySkeletonStatus: "empty",
    adaptationStrategy: "",
    adaptationStatus: "empty",
    scripts: [],
    messages: [{ id: "stale", role: "assistant", content: "顶层旧副本", createdAt: "2026-08-30T00:00:00.000Z" }],
    conversations: [
        { id: "conversation-1", title: "人物设定", messages: activeMessages, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
        { id: "conversation-2", title: "结局优化", messages: [], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
    ],
    activeConversationId: "conversation-1",
    version: 3,
    revision: 4,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};
const summary = {
    id: "project-1",
    title: "雾城追凶",
    source: "原作素材",
    currentStage: "collecting_config",
    projectId: "project-1",
    version: 3,
    revision: 4,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
};

let createCall;
let updateCall;
let renameCall;
let deletedId = "";
const { mock } = await import("bun:test");
mock.module("@/services/api/script-projects", () => ({
    fetchScriptProjects: async () => [summary],
    fetchScriptProject: async () => detail,
    createScriptProject: async (workspace) => {
        createCall = workspace;
        return { ...workspace, revision: 1, createdAt: detail.createdAt };
    },
    updateScriptProject: async (id, workspace, expectedRevision) => {
        updateCall = { id, workspace, expectedRevision };
        return { ...workspace, id, revision: expectedRevision + 1, createdAt: detail.createdAt, messages: detail.messages };
    },
    renameScriptProject: async (id, title, expectedRevision) => {
        renameCall = { id, title, expectedRevision };
        return { ...detail, id, projectId: id, title, revision: expectedRevision + 1 };
    },
    deleteScriptProject: async (id) => {
        deletedId = id;
    },
}));

const {
    appendScriptAgentMessage,
    clearScriptAgentConversation,
    createDefaultScriptAgentWorkspace,
    createScriptAgentConversation,
    createScriptAgentWorkspace,
    deleteScriptAgentWorkspace,
    loadScriptAgentProjects,
    loadScriptAgentWorkspace,
    renameScriptAgentConversation,
    scriptAgentConflictWorkspace,
    renameScriptAgentWorkspace,
    saveScriptAgentWorkspace,
    selectScriptAgentConversation,
} = await import("./script-agent-storage.ts");

test("列表只返回服务端剧本摘要", async () => {
    const projects = await loadScriptAgentProjects();
    assert.deepEqual(projects, [summary]);
    assert.equal("conversations" in projects[0], false);
});

test("工作区详情从当前会话派生顶层消息", async () => {
    const workspace = await loadScriptAgentWorkspace("project-1");
    assert.equal(workspace.projectId, "project-1");
    assert.deepEqual(workspace.messages, activeMessages);
    assert.notEqual(workspace.messages[0].content, "顶层旧副本");
});

test("保存整个工作区携带预期修订号并提交当前会话派生消息", async () => {
    updateCall = undefined;
    const workspace = await loadScriptAgentWorkspace("project-1");
    const saved = await saveScriptAgentWorkspace(workspace);

    assert.equal(updateCall.id, "project-1");
    assert.equal(updateCall.expectedRevision, 4);
    assert.equal(updateCall.workspace.source, "原作素材");
    assert.deepEqual(updateCall.workspace.messages, activeMessages);
    assert.deepEqual(updateCall.workspace.conversations[0].messages, activeMessages);
    assert.equal(saved.revision, 5);
    assert.deepEqual(saved.messages, activeMessages);
});

test("创建、重命名和删除都委托给服务端 API", async () => {
    createCall = undefined;
    const created = await createScriptAgentWorkspace(" 新剧本 ", " 新素材 ");
    assert.equal(created.projectId, created.id);
    assert.equal(created.revision, 1);
    assert.equal(createCall.projectId, createCall.id);
    assert.equal(createCall.title, "新剧本");
    assert.equal(createCall.source, "新素材");

    const renamed = await renameScriptAgentWorkspace(summary, " 新标题 ");
    assert.deepEqual(renameCall, { id: "project-1", title: "新标题", expectedRevision: 4 });
    assert.equal(renamed.title, "新标题");
    assert.equal(renamed.revision, 5);

    await deleteScriptAgentWorkspace("project-1");
    assert.equal(deletedId, "project-1");
});

test("修订冲突可以恢复服务端返回的当前工作区", () => {
    const current = { ...detail, title: "服务端最新版本", revision: 8 };
    const restored = scriptAgentConflictWorkspace({ status: 409, data: { current } });

    assert.equal(restored.title, "服务端最新版本");
    assert.equal(restored.revision, 8);
    assert.deepEqual(restored.messages, activeMessages);
    assert.equal(scriptAgentConflictWorkspace({ status: 500, data: { current } }), null);
});

test("新建和切换对话只恢复目标对话消息", () => {
    const first = appendScriptAgentMessage(createDefaultScriptAgentWorkspace(), "user", "人物设定");
    const second = createScriptAgentConversation(first, "第一幕修改");
    const withMessage = appendScriptAgentMessage(second, "assistant", "请先确定人物目标");
    const restored = selectScriptAgentConversation(withMessage, first.activeConversationId);

    assert.equal(withMessage.conversations.length, 2);
    assert.equal(restored.messages.length, 1);
    assert.equal(restored.messages[0].content, "人物设定");
});

test("清空和重命名只修改目标会话", () => {
    const first = appendScriptAgentMessage(createDefaultScriptAgentWorkspace(), "user", "人物设定");
    const second = appendScriptAgentMessage(createScriptAgentConversation(first, "第一幕修改"), "assistant", "继续");
    const cleared = clearScriptAgentConversation(second);
    const renamed = renameScriptAgentConversation(cleared, first.activeConversationId, "人物小传");

    assert.equal(renamed.messages.length, 0);
    assert.equal(renamed.conversations.length, 2);
    assert.equal(renamed.conversations[0].messages.length, 1);
    assert.equal(renamed.conversations[0].title, "人物小传");
    assert.equal(renamed.conversations[1].messages.length, 0);
});
