import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkspaceScript, removeWorkspaceScript, saveWorkspaceArtifact, upsertWorkspaceScript } from "./script-agent-workspace.ts";

const workspace = {
    id: "workspace-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "原作素材",
    currentStage: "awaiting_story_skeleton_decision",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "旧故事骨架",
    storySkeletonStatus: "awaiting_user_decision",
    adaptationStrategy: "旧改编策略",
    adaptationStatus: "approved",
    scripts: [
        { episodeNumber: 1, name: "第一集", content: "旧正文", sourceChapterIndexes: [1], version: 1 },
        { episodeNumber: 3, name: "第三集", content: "第三集正文", sourceChapterIndexes: [3], version: 1 },
    ],
    messages: [],
    conversations: [{ id: "conversation-1", title: "新对话", messages: [], createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" }],
    activeConversationId: "conversation-1",
    version: 4,
    updatedAt: "2026-08-29T00:00:00.000Z",
};

test("manual artifact edits preserve the agent stage and approval state", () => {
    const next = saveWorkspaceArtifact(workspace, "storySkeleton", "  新故事骨架  ");

    assert.equal(next.storySkeleton, "新故事骨架");
    assert.equal(next.currentStage, workspace.currentStage);
    assert.equal(next.storySkeletonStatus, workspace.storySkeletonStatus);
    assert.equal(next.version, workspace.version + 1);
});

test("manual material edits update the source used by later adaptation", () => {
    const next = saveWorkspaceArtifact(workspace, "source", "  最新完整素材  ");

    assert.equal(next.source, "最新完整素材");
    assert.equal(next.currentStage, workspace.currentStage);
    assert.equal(next.version, workspace.version + 1);
});

test("new scripts fill the first missing episode number", () => {
    assert.deepEqual(createWorkspaceScript(workspace.scripts), {
        episodeNumber: 2,
        name: "第 2 集",
        content: "",
        sourceChapterIndexes: [],
        version: 1,
    });
});

test("script edits replace the episode, increment its version and keep scripts ordered", () => {
    const next = upsertWorkspaceScript(workspace, { episodeNumber: 1, name: "第一集·新", content: "新正文", sourceChapterIndexes: [1], version: 1 });

    assert.deepEqual(
        next.scripts.map(({ episodeNumber, name, version }) => ({ episodeNumber, name, version })),
        [
            { episodeNumber: 1, name: "第一集·新", version: 2 },
            { episodeNumber: 3, name: "第三集", version: 1 },
        ],
    );
    assert.equal(next.version, workspace.version + 1);
});

test("scripts can be removed from the editable workspace", () => {
    const next = removeWorkspaceScript(workspace, 1);

    assert.deepEqual(
        next.scripts.map((script) => script.episodeNumber),
        [3],
    );
    assert.equal(next.version, workspace.version + 1);
});

test("manual script changes keep the completed stage in sync", () => {
    const projectConfig = {
        totalEpisodes: 3,
        episodeMinutes: 2,
        startChapter: 1,
        endChapter: 3,
        chapterIndexes: [1, 2, 3],
        platform: "vertical_short_drama",
        aspectRatio: "9:16",
        style: "悬疑",
        paywall: "前1集免费",
        wordsPerEpisode: 300,
    };
    const ready = { ...workspace, currentStage: "ready_for_script", projectConfig, scripts: [workspace.scripts[0], { ...workspace.scripts[1], episodeNumber: 2, name: "第二集" }] };
    const completed = upsertWorkspaceScript(
        ready,
        workspace.scripts.find((script) => script.episodeNumber === 3),
    );

    assert.equal(completed.currentStage, "completed");
    assert.equal(removeWorkspaceScript(completed, 2).currentStage, "ready_for_script");
});
