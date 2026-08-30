import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStoryboardDocument, parseStructuredCompletion, runStoryboardPipeline, storyboardToMarkdown, validateStoryboardDocument } from "./storyboard.ts";

const source = `第一场 废弃医院大厅 夜\n女记者握紧录音笔。\n保安：那里刚才有人。`;

const directorPlan = {
    schemaVersion: "1.0",
    title: "医院夜访",
    sourceType: "script",
    scenes: [
        {
            id: "model-id",
            sceneNo: 1,
            sourceRefs: ["source:1"],
            location: "废弃医院大厅",
            time: "夜",
            characters: ["女记者", "保安"],
            emotion: "紧张升级",
            summary: "女记者与保安在大厅发现异常",
            estimatedDurationSec: 7,
        },
    ],
};

const document = {
    schemaVersion: "1.0",
    title: "医院夜访",
    sourceType: "script",
    aspectRatio: "9:16",
    targetDurationSec: 7,
    scenes: [
        {
            sceneNo: 1,
            sourceRefs: ["source:1"],
            location: "废弃医院大厅",
            time: "夜",
            characters: ["女记者", "保安"],
            emotion: "紧张升级",
            segments: [
                {
                    id: "model-id",
                    segmentNo: 1,
                    durationSec: 7,
                    assetIds: [],
                    shots: [
                        {
                            id: "model-id",
                            shotNo: 1,
                            visual: "女记者握紧录音笔，保安望向走廊。",
                            durationSec: 3,
                            framing: "中景",
                            camera: "缓推",
                            dialogue: "",
                            sound: "水滴声",
                            sourceRefs: ["source:2"],
                        },
                        {
                            id: "model-id",
                            shotNo: 2,
                            visual: "保安抬手指向走廊尽头。",
                            durationSec: 4,
                            framing: "近景",
                            camera: "固定",
                            dialogue: "保安：那里刚才有人。",
                            sound: "脚步回声",
                            sourceRefs: ["source:3"],
                        },
                    ],
                },
            ],
        },
    ],
};

function toolResult(name, value) {
    return {
        content: "",
        toolCalls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(value) } }],
    };
}

test("storyboard pipeline uses the selected text-model transport for two ordered structured completions", async () => {
    const calls = [];
    const stages = [];
    const completions = [toolResult("submit_director_plan", directorPlan), toolResult("submit_storyboard_document", document)];

    const result = await runStoryboardPipeline(
        {
            title: "医院夜访",
            source,
            options: {
                aspectRatio: "9:16",
                targetDurationSec: 7,
                style: "现代悬疑",
                maxSegmentDurationSec: 15,
                maxShotDurationSec: 8,
                dialogueMustBeExact: true,
                allowMusic: false,
            },
        },
        async (request) => {
            calls.push(request);
            return completions.shift();
        },
        (stage) => stages.push(stage),
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolName, "submit_director_plan");
    assert.equal(calls[1].toolName, "submit_storyboard_document");
    assert.match(calls[1].prompt, /医院夜访/);
    assert.deepEqual(stages, ["planning", "generating", "validating"]);
    assert.equal(result.validation.status, "passed");
    assert.match(result.sourceHash, /^sha256:[a-f0-9]{64}$/);
    const ids = [result.document.scenes[0].id, result.document.scenes[0].segments[0].id, ...result.document.scenes[0].segments[0].shots.map((shot) => shot.id)];
    assert.equal(new Set(ids).size, ids.length);
    ids.forEach((id) => {
        assert.ok(id);
        assert.notEqual(id, "model-id");
    });
});

test("document normalization preserves structural IDs across regeneration and assigns new IDs to new entities", () => {
    const current = normalizeStoryboardDocument(document);
    const regenerated = structuredClone(document);
    regenerated.scenes[0].id = "untrusted-scene";
    regenerated.scenes[0].segments[0].id = "untrusted-segment";
    regenerated.scenes[0].segments[0].shots.reverse();
    regenerated.scenes[0].segments[0].shots.forEach((shot) => (shot.id = "untrusted-shot"));
    regenerated.scenes[0].segments[0].shots.push({
        id: "untrusted-shot",
        shotNo: 3,
        visual: "走廊灯光熄灭。",
        durationSec: 1,
        framing: "远景",
        camera: "固定",
        dialogue: "",
        sound: "电流声",
        sourceRefs: ["source:4"],
    });

    const next = normalizeStoryboardDocument(regenerated, current);
    const currentShots = new Map(current.scenes[0].segments[0].shots.map((shot) => [shot.shotNo, shot.id]));

    assert.equal(next.scenes[0].id, current.scenes[0].id);
    assert.equal(next.scenes[0].segments[0].id, current.scenes[0].segments[0].id);
    assert.equal(next.scenes[0].segments[0].shots.find((shot) => shot.shotNo === 1).id, currentShots.get(1));
    assert.equal(next.scenes[0].segments[0].shots.find((shot) => shot.shotNo === 2).id, currentShots.get(2));
    assert.notEqual(next.scenes[0].segments[0].shots.find((shot) => shot.shotNo === 3).id, "untrusted-shot");
});

test("structured completion accepts fenced JSON when a provider returns content instead of a tool call", () => {
    assert.deepEqual(parseStructuredCompletion({ content: `\n\`\`\`json\n${JSON.stringify(directorPlan)}\n\`\`\``, toolCalls: [] }, "submit_director_plan"), directorPlan);
});

test("validator reports duration, dialogue and music violations through document paths", () => {
    const invalid = structuredClone(document);
    invalid.aspectRatio = "16:9";
    invalid.scenes[0].segments[0].durationSec = 3;
    invalid.scenes[0].segments[0].shots[1].shotNo = 3;
    invalid.scenes[0].segments[0].shots[1].durationSec = 9;
    invalid.scenes[0].segments[0].shots[1].dialogue = "保安：我没有说过这句话。";
    invalid.scenes[0].segments[0].shots[1].sound = "紧张配乐响起";

    const report = validateStoryboardDocument(invalid, source, {
        aspectRatio: "9:16",
        targetDurationSec: 7,
        style: "现代悬疑",
        maxSegmentDurationSec: 15,
        maxShotDurationSec: 8,
        dialogueMustBeExact: true,
        allowMusic: false,
    });

    assert.equal(report.status, "failed");
    assert.ok(report.errors.some((issue) => issue.code === "ASPECT_RATIO_MISMATCH" && issue.path === "aspectRatio"));
    assert.ok(report.errors.some((issue) => issue.code === "SHOT_NUMBER_INVALID" && issue.path === "scenes[0].segments[0].shots[1].shotNo"));
    assert.ok(report.errors.some((issue) => issue.code === "SEGMENT_DURATION_MISMATCH" && issue.path === "scenes[0].segments[0].durationSec"));
    assert.ok(report.errors.some((issue) => issue.code === "SHOT_DURATION_EXCEEDED" && issue.path === "scenes[0].segments[0].shots[1].durationSec"));
    assert.ok(report.errors.some((issue) => issue.code === "DIALOGUE_NOT_IN_SOURCE" && issue.path === "scenes[0].segments[0].shots[1].dialogue"));
    assert.ok(report.errors.some((issue) => issue.code === "MUSIC_NOT_ALLOWED" && issue.path === "scenes[0].segments[0].shots[1].sound"));
});

test("markdown export is rendered from the structured document", () => {
    const markdown = storyboardToMarkdown(document);
    assert.match(markdown, /# 医院夜访/);
    assert.match(markdown, /\| 镜头 \| 画面 \| 时长 \| 景别 \| 运镜 \| 台词\/旁白 \| 音效 \|/);
    assert.match(markdown, /保安：那里刚才有人。/);
});
