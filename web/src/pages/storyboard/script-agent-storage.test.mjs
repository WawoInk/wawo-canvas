import assert from "node:assert/strict";
import { test } from "node:test";

const buckets = new Map();
// Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("localforage", () => ({
    default: {
        createInstance: ({ storeName }) => {
            const values = buckets.get(storeName) || new Map();
            buckets.set(storeName, values);
            return {
                getItem: async (key) => values.get(key) ?? null,
                setItem: async (key, value) => (values.set(key, value), value),
                removeItem: async (key) => void values.delete(key),
            };
        },
    },
}));

const {
    appendScriptAgentMessage,
    clearScriptAgentConversation,
    createDefaultScriptAgentWorkspace,
    createScriptAgentConversation,
    createScriptAgentProject,
    deleteScriptAgentProject,
    renameScriptAgentProject,
    selectScriptAgentConversation,
    clearScriptAgentWorkspace,
    loadScriptAgentProjects,
    loadScriptAgentWorkspace,
    saveScriptAgentWorkspace,
} = await import("./script-agent-storage.ts");

function project(title = "雾城追凶") {
    return createScriptAgentProject(title, "原作素材");
}

test("剧本项目拥有独立的默认对话", () => {
    const value = project();

    assert.equal(value.title, "雾城追凶");
    assert.equal(value.projectId, value.id);
    assert.equal(value.conversations.length, 1);
    assert.equal(value.activeConversationId, value.conversations[0].id);
});

test("新建和切换对话只恢复目标对话消息", () => {
    const first = appendScriptAgentMessage(project(), "user", "人物设定");
    const second = createScriptAgentConversation(first, "第一幕修改");
    const withMessage = appendScriptAgentMessage(second, "assistant", "请先确定人物目标");
    const restored = selectScriptAgentConversation(withMessage, first.activeConversationId);

    assert.equal(withMessage.conversations.length, 2);
    assert.equal(restored.messages.length, 1);
    assert.equal(restored.messages[0].content, "人物设定");
    assert.equal(restored.activeConversationId, first.activeConversationId);
});

test("清空对话只删除当前会话消息并保留会话", () => {
    const first = appendScriptAgentMessage(project(), "user", "人物设定");
    const second = createScriptAgentConversation(first, "第一幕修改");
    const withMessage = appendScriptAgentMessage(second, "assistant", "继续");
    const cleared = clearScriptAgentConversation(withMessage);

    assert.equal(cleared.messages.length, 0);
    assert.equal(cleared.conversations.length, 2);
    assert.equal(cleared.conversations[1].messages.length, 0);
    assert.equal(cleared.conversations[0].messages.length, 1);
});

test("剧本管理操作只影响目标剧本集合", () => {
    const first = project("第一个剧本");
    const second = project("第二个剧本");
    const renamed = renameScriptAgentProject([first, second], first.projectId, "重命名剧本");
    const remaining = deleteScriptAgentProject(renamed, second.projectId);

    assert.deepEqual(remaining.map((item) => item.title), ["重命名剧本"]);
    assert.equal(remaining[0].projectId, first.projectId);
});

test("默认工作区仍能作为未持久化新剧本创建", () => {
    const value = createDefaultScriptAgentWorkspace();
    assert.equal(value.messages.length, 0);
    assert.equal(value.conversations.length, 1);
});


test("保存时把顶层消息同步进当前会话并在重新加载后保留", async () => {
    const userId = "script-agent-storage-sync";
    await clearScriptAgentWorkspace(userId);
    const value = project();
    const assistantMessage = { id: "assistant-1", role: "assistant", content: "已完成当前会话回复", createdAt: "2026-08-30T00:00:00.000Z" };
    await saveScriptAgentWorkspace(userId, { ...value, messages: [assistantMessage] });

    const loaded = await loadScriptAgentWorkspace(userId, value.projectId);
    assert.ok(loaded);
    assert.equal(loaded.messages[0].content, "已完成当前会话回复");
    assert.equal(loaded.conversations[0].messages[0].content, "已完成当前会话回复");
    await clearScriptAgentWorkspace(userId);
});

test("指定不存在的剧本不会静默创建新项目", async () => {
    const userId = "script-agent-storage-missing";
    await clearScriptAgentWorkspace(userId);
    assert.equal(await loadScriptAgentWorkspace(userId, "missing-project"), null);
});


test("旧单工作区首次读取后迁移为稳定的剧本和会话 ID", async () => {
    const userId = "script-agent-storage-legacy";
    const { accountStoreName } = await import("@/lib/account-storage");
    const storeName = accountStoreName("script_agent_workspaces", userId);
    const legacy = project("旧剧本");
    const legacyMessage = { id: "legacy-message", role: "user", content: "旧对话", createdAt: "2026-08-30T00:00:00.000Z" };
    delete legacy.conversations;
    delete legacy.activeConversationId;
    legacy.messages = [legacyMessage];
    buckets.set(storeName, new Map([["default", legacy]]));

    const first = await loadScriptAgentProjects(userId);
    const second = await loadScriptAgentProjects(userId);
    assert.equal(second[0].projectId, first[0].projectId);
    assert.equal(second[0].activeConversationId, first[0].activeConversationId);
    assert.equal(second[0].messages[0].content, "旧对话");
    await clearScriptAgentWorkspace(userId);
});

test("不同剧本的会话和消息持久化相互隔离", async () => {
    const userId = "script-agent-storage-project-isolation";
    await clearScriptAgentWorkspace(userId);
    const first = appendScriptAgentMessage(project("剧本一"), "user", "剧本一消息");
    const second = appendScriptAgentMessage(project("剧本二"), "user", "剧本二消息");
    await saveScriptAgentWorkspace(userId, first);
    await saveScriptAgentWorkspace(userId, second);

    const loadedFirst = await loadScriptAgentWorkspace(userId, first.projectId);
    const loadedSecond = await loadScriptAgentWorkspace(userId, second.projectId);
    assert.equal(loadedFirst.messages[0].content, "剧本一消息");
    assert.equal(loadedSecond.messages[0].content, "剧本二消息");
    await clearScriptAgentWorkspace(userId);
});
