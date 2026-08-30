import assert from "node:assert/strict";
import { test } from "node:test";

let respond;
const { mock } = await import("bun:test");
mock.module("@/services/api/image", () => ({
    requestToolResponse: (...args) => respond(...args),
}));

const { sendScriptAgentTurn } = await import("./script-agent.ts");

const base = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "第一章",
    currentStage: "ready_for_script",
    projectConfig: {
        totalEpisodes: 3,
        episodeMinutes: 2,
        startChapter: 1,
        endChapter: 1,
        chapterIndexes: [1],
        platform: "短视频",
        aspectRatio: "9:16",
        style: "悬疑",
        paywall: "第 2 集",
        wordsPerEpisode: 300,
    },
    storySkeleton: "骨架",
    storySkeletonStatus: "approved",
    adaptationStrategy: "策略",
    adaptationStatus: "approved",
    adaptationReview: { artifactType: "adaptation_strategy", artifactVersion: 1, grade: "A", summary: "通过", issues: [], decisions: [], markdown: "通过" },
    scripts: [],
    messages: [],
    conversations: [{ id: "conversation-1", title: "创作", messages: [], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" }],
    activeConversationId: "conversation-1",
    version: 1,
    revision: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};

function episodeResult(episodeNumber) {
    const name = `雾城追凶 EP${episodeNumber}`;
    return {
        content: "",
        toolCalls: [{ function: { name: "submit_script_episode", arguments: JSON.stringify({ script: {
            episodeNumber,
            name,
            content: `# ${name}\n# 目标时长：2分钟\n# 平台：短视频\n## 剧情梗概\n推进第 ${episodeNumber} 集。\n---\n1-1 客厅 夜/内\n人物：林岚\n△林岚推门。`,
            sourceChapterIndexes: [1],
        } }) } }],
    };
}

test("逐集生成会在每集完成后提交可恢复检查点", async () => {
    let episode = 0;
    respond = async () => episodeResult(++episode);
    const checkpoints = [];

    const result = await sendScriptAgentTurn({ model: "text-model", textModel: "text-model" }, base, "继续生成", {
        onCheckpoint: async (workspace) => {
            checkpoints.push(workspace.scripts.length);
            return { ...workspace, revision: (workspace.revision || 0) + 1 };
        },
    });

    assert.deepEqual(checkpoints, [1, 2, 3]);
    assert.equal(result.scripts.length, 3);
    assert.equal(result.revision, 4);
});

const skeleton = `# 雾城追凶故事骨架
## 故事核
追查真相。
## 隐线
旧案线索。
## 人物小传
林岚坚持调查。
## 三幕结构
逐步揭露真相。
## 分集决策
三集推进。
## 全局删减决策记录
删除支线。
## 付费卡点设计
第二集结尾反转。
## 股价级反转登记表
身份反转。`;

test("故事骨架生成后在审核前提交可恢复检查点", async () => {
    const controller = new AbortController();
    let calls = 0;
    respond = async (...args) => {
        calls += 1;
        const requestOptions = args.at(-1);
        if (requestOptions?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return { content: "", toolCalls: [{ function: { name: "submit_story_skeleton", arguments: JSON.stringify({ content: skeleton }) } }] };
    };
    const checkpoints = [];
    const workspace = { ...base, currentStage: "ready_for_story_skeleton", storySkeleton: "", storySkeletonStatus: "empty", adaptationStrategy: "", adaptationStatus: "empty", adaptationReview: undefined };

    await assert.rejects(() => sendScriptAgentTurn({ model: "text-model", textModel: "text-model" }, workspace, "生成骨架", {
        signal: controller.signal,
        onCheckpoint: async (value) => {
            checkpoints.push(value);
            controller.abort();
            return { ...value, revision: (value.revision || 0) + 1 };
        },
    }), /Abort/);

    assert.equal(calls, 2);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0].storySkeleton, skeleton);
    assert.equal(checkpoints[0].storySkeletonStatus, "generated");
});
