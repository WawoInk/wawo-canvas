import assert from "node:assert/strict";
import { test } from "node:test";

import {
    appendScriptAgentMessage,
    clearScriptAgentConversation,
    createDefaultScriptAgentWorkspace,
    createScriptAgentConversation,
    createScriptAgentProject,
    deleteScriptAgentProject,
    renameScriptAgentProject,
    selectScriptAgentConversation,
} from "./script-agent-storage.ts";

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
