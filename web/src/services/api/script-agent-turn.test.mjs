import assert from "node:assert/strict";
import { test } from "node:test";

let prompt = "";
// Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/services/api/image", () => ({
    requestToolResponse: async (_config, messages) => {
        prompt = messages[0].content;
        return {
            content: "",
            toolCalls: [{ function: { name: "submit_project_config", arguments: JSON.stringify({ action: "collect", reply: "还需要补充集数", title: null, source: null, config: null }) } }],
        };
    },
}));

const { sendScriptAgentTurn } = await import("./script-agent.ts");

const previous = { id: "previous", role: "assistant", content: "当前会话上一轮内容", createdAt: "2026-08-30T00:00:00.000Z" };
const current = { id: "current", role: "user", content: "继续完善人物", createdAt: "2026-08-30T00:01:00.000Z" };
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
    messages: [previous, current],
    conversations: [
        { id: "active", title: "人物设定", messages: [previous, current], createdAt: previous.createdAt, updatedAt: current.createdAt },
        { id: "other", title: "结局优化", messages: [{ id: "other", role: "user", content: "其他会话内容不可见", createdAt: previous.createdAt }], createdAt: previous.createdAt, updatedAt: previous.createdAt },
    ],
    activeConversationId: "active",
    version: 1,
    updatedAt: current.createdAt,
};

test("对话请求恢复当前会话上下文并把助手回复写回当前会话", async () => {
    const result = await sendScriptAgentTurn({ model: "text-model", textModel: "text-model" }, workspace, current.content);

    assert.match(prompt, /当前会话上一轮内容/);
    assert.doesNotMatch(prompt, /其他会话内容不可见/);
    assert.equal(result.messages.at(-1).content, "还需要补充集数");
    assert.equal(result.conversations[0].messages.at(-1).content, "还需要补充集数");
    assert.equal(result.conversations[1].messages.length, 1);
});
