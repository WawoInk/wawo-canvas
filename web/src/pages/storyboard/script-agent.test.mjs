import assert from "node:assert/strict";
import { test } from "node:test";

import {
    assertCanGenerateAdaptationStrategy,
    assertCanGenerateScriptBatch,
    parseAdaptationStrategyResult,
    parseScriptEpisodeResult,
    parseStorySkeletonResult,
    transitionScriptAgentStage,
    validateScriptBatch,
    validateScriptProjectConfig,
} from "./script-agent.ts";

test("project config is normalized and derives words per episode", () => {
    assert.deepEqual(
        validateScriptProjectConfig(
            {
                totalEpisodes: 24,
                episodeMinutes: 2,
                startChapter: 1,
                endChapter: 20,
                chapterIndexes: [3, 1, 3, 2],
                platform: "vertical_short_drama",
                aspectRatio: "9:16",
                style: "悬疑逆袭",
                paywall: "前8集免费，第9集起付费",
            },
            [1, 2, 3, 4, 5],
        ),
        {
            totalEpisodes: 24,
            episodeMinutes: 2,
            startChapter: 1,
            endChapter: 20,
            chapterIndexes: [1, 2, 3],
            platform: "vertical_short_drama",
            aspectRatio: "9:16",
            style: "悬疑逆袭",
            paywall: "前8集免费，第9集起付费",
            wordsPerEpisode: 300,
        },
    );
});

test("project config rejects incomplete, invalid and unavailable chapter data", () => {
    const valid = {
        totalEpisodes: 24,
        episodeMinutes: 2,
        startChapter: 1,
        endChapter: 20,
        chapterIndexes: [1, 2, 3],
        platform: "vertical_short_drama",
        aspectRatio: "9:16",
        style: "悬疑逆袭",
        paywall: "前8集免费，第9集起付费",
    };
    const code = (input, expected, available = [1, 2, 3]) =>
        assert.throws(
            () => validateScriptProjectConfig(input, available),
            (error) => error.code === expected,
        );

    code({ ...valid, totalEpisodes: 0 }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, episodeMinutes: 1.5 }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, startChapter: 4, endChapter: 3 }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [0, 2] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, chapterIndexes: [1, 4] }, "CHAPTER_RANGE_INVALID");
    code({ ...valid, style: " " }, "PROJECT_CONFIG_INVALID");
    code({ ...valid, aspectRatio: "2:1" }, "PROJECT_CONFIG_INVALID");
});

const approvedWorkspace = {
    id: "workspace-1",
    projectId: "project-1",
    currentStage: "ready_for_script",
    projectConfig: {
        totalEpisodes: 8,
        episodeMinutes: 2,
        startChapter: 1,
        endChapter: 8,
        chapterIndexes: [1, 2, 3, 4, 5, 6, 7, 8],
        platform: "vertical_short_drama",
        aspectRatio: "9:16",
        style: "悬疑逆袭",
        paywall: "前3集免费",
        wordsPerEpisode: 300,
    },
    storySkeleton: "# 故事骨架",
    storySkeletonStatus: "approved",
    storySkeletonReview: { artifactType: "story_skeleton", artifactVersion: 1, grade: "A", summary: "通过", issues: [], decisions: [], markdown: "# 审核" },
    adaptationStrategy: "# 关键决策记录",
    adaptationStatus: "approved",
    adaptationReview: { artifactType: "adaptation_strategy", artifactVersion: 1, grade: "B", summary: "可继续", issues: [], decisions: [], markdown: "# 审核" },
    scripts: [],
    version: 1,
    updatedAt: "2026-08-29T00:00:00.000Z",
};

test("workflow transitions require explicit user decisions at both approval gates", () => {
    assert.equal(transitionScriptAgentStage("collecting_config", "confirm_project_config"), "ready_for_story_skeleton");
    assert.equal(transitionScriptAgentStage("ready_for_story_skeleton", "start_story_skeleton"), "generating_story_skeleton");
    assert.equal(transitionScriptAgentStage("generating_story_skeleton", "finish_story_skeleton"), "reviewing_story_skeleton");
    assert.equal(transitionScriptAgentStage("reviewing_story_skeleton", "finish_story_skeleton_review"), "awaiting_story_skeleton_decision");
    assert.throws(
        () => transitionScriptAgentStage("awaiting_story_skeleton_decision", "start_adaptation_strategy"),
        (error) => error.code === "STORY_SKELETON_APPROVAL_REQUIRED",
    );
    assert.equal(transitionScriptAgentStage("awaiting_story_skeleton_decision", "approve_story_skeleton"), "ready_for_adaptation_strategy");
    assert.equal(transitionScriptAgentStage("ready_for_adaptation_strategy", "start_adaptation_strategy"), "generating_adaptation_strategy");
    assert.equal(transitionScriptAgentStage("generating_adaptation_strategy", "finish_adaptation_strategy"), "reviewing_adaptation_strategy");
    assert.equal(transitionScriptAgentStage("reviewing_adaptation_strategy", "finish_adaptation_review"), "awaiting_adaptation_decision");
    assert.throws(
        () => transitionScriptAgentStage("awaiting_adaptation_decision", "open_script_batch_selection"),
        (error) => error.code === "ADAPTATION_APPROVAL_REQUIRED",
    );
    assert.equal(transitionScriptAgentStage("awaiting_adaptation_decision", "approve_adaptation_strategy"), "ready_for_script");
});

test("adaptation generation requires an explicitly approved reviewed story skeleton", () => {
    assert.doesNotThrow(() => assertCanGenerateAdaptationStrategy({ ...approvedWorkspace, currentStage: "ready_for_adaptation_strategy" }));
    assert.throws(
        () => assertCanGenerateAdaptationStrategy({ ...approvedWorkspace, currentStage: "ready_for_adaptation_strategy", storySkeleton: "" }),
        (error) => error.code === "STORY_SKELETON_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateAdaptationStrategy({ ...approvedWorkspace, currentStage: "ready_for_adaptation_strategy", storySkeletonStatus: "generated" }),
        (error) => error.code === "STORY_SKELETON_APPROVAL_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateAdaptationStrategy({ ...approvedWorkspace, currentStage: "ready_for_adaptation_strategy", storySkeletonReview: undefined }),
        (error) => error.code === "STORY_SKELETON_APPROVAL_REQUIRED",
    );
});

test("script batches contain at most five consecutive episodes starting at the next episode", () => {
    assert.deepEqual(validateScriptBatch([4, 5, 6], 8, 4), [4, 5, 6]);
    assert.throws(
        () => validateScriptBatch([1, 2, 3, 4, 5, 6], 8, 1),
        (error) => error.code === "SCRIPT_BATCH_TOO_LARGE",
    );
    assert.throws(
        () => validateScriptBatch([], 8, 1),
        (error) => error.code === "SCRIPT_EPISODE_OUT_OF_ORDER",
    );
    assert.throws(
        () => validateScriptBatch([4, 6], 8, 4),
        (error) => error.code === "SCRIPT_EPISODE_OUT_OF_ORDER",
    );
    assert.throws(
        () => validateScriptBatch([3, 4], 8, 4),
        (error) => error.code === "SCRIPT_EPISODE_OUT_OF_ORDER",
    );
    assert.throws(
        () => validateScriptBatch([8, 9], 8, 8),
        (error) => error.code === "SCRIPT_EPISODE_OUT_OF_ORDER",
    );
});

test("script generation requires approved adaptation and the next missing episode batch", () => {
    assert.deepEqual(assertCanGenerateScriptBatch(approvedWorkspace, [1, 2, 3]), [1, 2, 3]);
    const withScripts = { ...approvedWorkspace, scripts: [{ episodeNumber: 1 }, { episodeNumber: 2 }] };
    assert.deepEqual(assertCanGenerateScriptBatch(withScripts, [3, 4]), [3, 4]);
    assert.throws(
        () => assertCanGenerateScriptBatch({ ...approvedWorkspace, projectConfig: null }, [1]),
        (error) => error.code === "PROJECT_CONFIG_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateScriptBatch({ ...approvedWorkspace, adaptationStrategy: "" }, [1]),
        (error) => error.code === "ADAPTATION_STRATEGY_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateScriptBatch({ ...approvedWorkspace, adaptationStatus: "generated" }, [1]),
        (error) => error.code === "ADAPTATION_APPROVAL_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateScriptBatch({ ...approvedWorkspace, adaptationReview: undefined }, [1]),
        (error) => error.code === "ADAPTATION_APPROVAL_REQUIRED",
    );
    assert.throws(
        () => assertCanGenerateScriptBatch(withScripts, [4]),
        (error) => error.code === "SCRIPT_EPISODE_OUT_OF_ORDER",
    );
});

const storySkeletonMarkdown = `# 雾城追凶 - 故事骨架

## 故事核（一句话）
失忆记者追查真相。

## 隐线（人物弧）
从逃避到承担。

## 人物小传（大三角核心角色，≤4人）
主角、反派和关键盟友。

## 三幕结构
建立、对抗、揭晓。

## 分集决策
逐集展开。

## 全局删减决策记录
删除支线。

## 付费卡点设计
第三集末揭晓身份。

## 股价级反转登记表
反派其实是保护者。`;

test("story skeleton parser reads the expected structured tool result", () => {
    const completion = {
        content: "",
        toolCalls: [{ function: { name: "submit_story_skeleton", arguments: JSON.stringify({ content: storySkeletonMarkdown }) } }],
    };
    assert.deepEqual(parseStorySkeletonResult(completion), { content: storySkeletonMarkdown });
});

test("story skeleton parser rejects an empty required Markdown section", () => {
    const emptyPaywall = storySkeletonMarkdown.replace("## 付费卡点设计\n第三集末揭晓身份。", "## 付费卡点设计\n");
    assert.throws(
        () => parseStorySkeletonResult({ content: emptyPaywall }),
        (error) => error.code === "MARKDOWN_SECTION_MISSING" && error.path === "付费卡点设计",
    );
});

const adaptationMarkdown = `# 雾城追凶 - 关键决策记录

## 核心改编原则（3-5条）
1. **单线追凶**\n   - ✅ 正面指导：所有支线服务主角查案。\n   - ❌ 负面边界：不新增无关角色。

## 主要删除决策
压缩重复调查，并用一场对质替代。

## 世界观呈现策略
跟随主角逐步发现，反派作为信息锚点。`;

test("adaptation parser accepts fenced structured JSON and validates required sections", () => {
    const completion = { content: `\n\`\`\`json\n${JSON.stringify({ content: adaptationMarkdown })}\n\`\`\``, toolCalls: [] };
    assert.deepEqual(parseAdaptationStrategyResult(completion), { content: adaptationMarkdown });
});

const scriptMarkdown = `# 雾城追凶 EP01：失踪的证人
# 目标时长：2分钟 ≈ 300字台词
# 平台：9:16 | 风格：悬疑逆袭 | 节拍：证据出现后立刻反转

---

## 剧情梗概
记者在停尸房发现失踪证人的录音笔，却被保安堵住出口。

---

1-1 市立医院停尸房 夜/内
人物：林雾 周保安

△冷白灯闪烁，林雾把录音笔藏进袖口。
林雾：你刚才看见谁了？
△周保安反锁铁门，钥匙撞出脆响。`;

test("single episode parser returns one validated script item", () => {
    const result = parseScriptEpisodeResult({
        script: {
            episodeNumber: 1,
            name: "雾城追凶 EP01：失踪的证人",
            content: scriptMarkdown,
            sourceChapterIndexes: [2, 1, 2],
        },
    });
    assert.deepEqual(result, {
        script: {
            episodeNumber: 1,
            name: "雾城追凶 EP01：失踪的证人",
            content: scriptMarkdown,
            sourceChapterIndexes: [1, 2],
        },
    });
});

test("single episode parser rejects model output containing multiple scripts", () => {
    const script = {
        episodeNumber: 1,
        name: "雾城追凶 EP01：失踪的证人",
        content: scriptMarkdown,
        sourceChapterIndexes: [1, 2],
    };
    assert.throws(
        () => parseScriptEpisodeResult({ script, scripts: [script, { ...script, episodeNumber: 2 }] }),
        (error) => error.code === "STRUCTURED_OUTPUT_INVALID",
    );
});

test("single episode parser rejects missing screenplay markers and title mismatches", () => {
    const script = {
        episodeNumber: 1,
        name: "雾城追凶 EP01：失踪的证人",
        content: scriptMarkdown.replace(/^△.*$/gm, ""),
        sourceChapterIndexes: [1, 2],
    };
    assert.throws(
        () => parseScriptEpisodeResult({ script }),
        (error) => error.code === "MARKDOWN_SECTION_MISSING" && error.path === "场景描述",
    );
    assert.throws(
        () => parseScriptEpisodeResult({ script: { ...script, content: scriptMarkdown, name: "雾城追凶 EP02：失踪的证人" } }),
        (error) => error.code === "STRUCTURED_OUTPUT_INVALID" && error.path === "script.name",
    );
});
