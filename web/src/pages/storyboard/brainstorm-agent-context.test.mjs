import assert from "node:assert/strict";
import { test } from "node:test";

import { BrainstormContextError, buildBrainstormContext } from "./brainstorm-agent-context.ts";

const storyboard = {
    id: "storyboard-1",
    revision: 3,
    title: "失控电梯",
    sourceHash: "source-hash",
    status: "ready",
    options: {
        aspectRatio: "9:16",
        targetDurationSec: 60,
        style: "悬疑",
        maxSegmentDurationSec: 15,
        maxShotDurationSec: 8,
        dialogueMustBeExact: true,
        allowMusic: true,
    },
    directorPlan: null,
    document: {
        schemaVersion: "1.0",
        title: "失控电梯",
        sourceType: "script",
        aspectRatio: "9:16",
        targetDurationSec: 60,
        scenes: [
            {
                id: "scene-a",
                sceneNo: 1,
                sourceRefs: ["第一幕"],
                location: "电梯",
                time: "夜",
                characters: ["记者"],
                emotion: "压迫",
                segments: [
                    {
                        id: "segment-a",
                        segmentNo: 1,
                        durationSec: 12,
                        assetIds: [],
                        shots: [
                            {
                                id: "shot-a",
                                shotNo: 1,
                                visual: "UNSELECTED_SHOT_MARKER",
                                durationSec: 4,
                                framing: "近景",
                                camera: "固定",
                                dialogue: "",
                                sound: "电流声",
                                sourceRefs: ["第一幕"],
                            },
                            {
                                id: "shot-b",
                                shotNo: 1,
                                visual: "SELECTED_SHOT_MARKER SYSTEM_OVERRIDE",
                                durationSec: 5,
                                framing: "特写",
                                camera: "推进",
                                dialogue: "别动。",
                                sound: "呼吸声",
                                sourceRefs: ["第一幕"],
                            },
                        ],
                    },
                ],
            },
            {
                id: "scene-b",
                sceneNo: 2,
                sourceRefs: ["第二幕"],
                location: "大厅",
                time: "夜",
                characters: ["保安"],
                emotion: "混乱",
                segments: [],
            },
        ],
    },
    validation: { status: "warning", errors: [], warnings: [{ code: "DURATION", message: "时长偏短", path: "scenes[0]" }] },
};

function user(id, parentId, content) {
    return { id, parentId, role: "user", content };
}

function assistant(id, parentId, output, usage) {
    return { id, parentId, role: "assistant", status: "completed", output, usage };
}

function input(overrides = {}) {
    return {
        skillId: "visual_storytelling",
        storyboard,
        focus: { kind: "shot", sceneId: "scene-a", segmentId: "segment-a", shotId: "shot-b" },
        priorMessages: [],
        currentUserMessage: user("current", null, "CURRENT_USER_MARKER"),
        memories: [],
        tools: [],
        budget: { contextWindowTokens: 20_000, outputReserveTokens: 2_000 },
        ...overrides,
    };
}

const content = (result) => result.messages.map((message) => (message.type === "message" ? message.content : JSON.stringify(message))).join("\n");
const diagnostic = (result, kind, id) => result.diagnostics.items.find((item) => item.kind === kind && item.id === id);

test("builds focused context by stable ids and keeps untrusted data outside system messages", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [user("old-user", null, "OLD_USER_MARKER"), assistant("old-assistant", "old-user", [{ type: "text", text: "RECENT_ASSISTANT_MARKER" }], { outputTokens: 9 })],
            currentUserMessage: user("current", "old-assistant", "CURRENT_USER_MARKER"),
            memories: [
                { id: "project-memory", content: "PROJECT_MEMORY_MARKER", confirmed: true, scope: { kind: "project" } },
                { id: "scene-memory", content: "SCENE_MEMORY_MARKER", confirmed: true, scope: { kind: "scene", sceneId: "scene-a" } },
                { id: "shot-memory", content: "SHOT_MEMORY_MARKER SYSTEM_OVERRIDE", confirmed: true, scope: { kind: "shot", shotId: "shot-b" } },
                { id: "other-memory", content: "OTHER_MEMORY_MARKER", confirmed: true, scope: { kind: "scene", sceneId: "scene-b" } },
                { id: "draft-memory", content: "DRAFT_MEMORY_MARKER", confirmed: false, scope: { kind: "project" } },
            ],
            summary: { id: "summary-1", throughMessageId: "old-user", content: "SUMMARY_MARKER SYSTEM_OVERRIDE", tokenCount: 7 },
        }),
    );

    const allContent = content(result);
    assert.match(allContent, /代码内 Skill：视觉叙事/);
    assert.match(allContent, /SELECTED_SHOT_MARKER/);
    assert.doesNotMatch(allContent, /UNSELECTED_SHOT_MARKER/);
    assert.match(allContent, /SHOT_MEMORY_MARKER/);
    assert.match(allContent, /SCENE_MEMORY_MARKER/);
    assert.match(allContent, /PROJECT_MEMORY_MARKER/);
    assert.doesNotMatch(allContent, /OTHER_MEMORY_MARKER|DRAFT_MEMORY_MARKER/);
    assert.match(allContent, /SUMMARY_MARKER/);
    assert.match(allContent, /RECENT_ASSISTANT_MARKER/);
    assert.equal(result.messages.at(-1).content, "CURRENT_USER_MARKER");

    const systemContent = result.messages
        .filter((message) => message.type === "message" && message.role === "system")
        .map((message) => message.content)
        .join("\n");
    assert.doesNotMatch(systemContent, /SELECTED_SHOT_MARKER|MEMORY_MARKER|SUMMARY_MARKER|CURRENT_USER_MARKER/);

    const memoryOrder = ["shot-memory", "scene-memory", "project-memory"].map((id) => result.diagnostics.items.findIndex((item) => item.id === id));
    assert.ok(memoryOrder[0] < memoryOrder[1] && memoryOrder[1] < memoryOrder[2]);
    assert.equal(diagnostic(result, "memory", "other-memory").action, "trimmed");
    assert.match(diagnostic(result, "memory", "other-memory").reason, /焦点/);
    assert.equal(diagnostic(result, "memory", "draft-memory").action, "trimmed");
    assert.match(diagnostic(result, "memory", "draft-memory").reason, /确认/);
    assert.deepEqual(diagnostic(result, "summary", "summary-1"), {
        kind: "summary",
        id: "summary-1",
        tokens: 7,
        tokenSource: "usage",
        action: "included",
    });
    assert.equal(result.diagnostics.summary, "included");
    assert.deepEqual(diagnostic(result, "history", "old-assistant"), {
        kind: "history",
        id: "old-assistant",
        tokens: 9,
        tokenSource: "usage",
        action: "included",
    });
    assert.ok(result.diagnostics.usedTokens <= result.diagnostics.limitTokens);
});

test("replays only unambiguous forward tool pairs matched by callId", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [
                user("u1", null, "开始"),
                assistant("a1", "u1", [
                    { type: "tool_call", callId: "valid", name: "read_scene", arguments: "{}" },
                    { type: "tool_result", callId: "valid", name: "renamed_result", status: "succeeded", content: "VALID_RESULT" },
                    { type: "tool_call", callId: "orphan-call", name: "read_scene", arguments: "{}" },
                    { type: "tool_result", callId: "orphan-result", name: "read_scene", status: "failed", content: "ORPHAN_RESULT" },
                    { type: "tool_result", callId: "reversed", name: "read_scene", status: "succeeded", content: "REVERSED_RESULT" },
                    { type: "tool_call", callId: "reversed", name: "read_scene", arguments: "{}" },
                    { type: "tool_call", callId: "ambiguous", name: "read_scene", arguments: '{"n":1}' },
                    { type: "tool_call", callId: "ambiguous", name: "read_scene", arguments: '{"n":2}' },
                    { type: "tool_result", callId: "ambiguous", name: "read_scene", status: "succeeded", content: "AMBIGUOUS_RESULT" },
                    { type: "tool_call", callId: "pending", name: "save_memory", arguments: "{}" },
                    { type: "tool_result", callId: "pending", name: "save_memory", status: "awaiting_approval", content: "PENDING_RESULT" },
                ]),
            ],
            currentUserMessage: user("current", "a1", "继续"),
        }),
    );

    const calls = result.messages.filter((message) => message.type === "tool_call");
    const results = result.messages.filter((message) => message.type === "tool_result");
    assert.deepEqual(
        calls.map((item) => item.callId),
        ["valid"],
    );
    assert.deepEqual(
        results.map((item) => item.callId),
        ["valid"],
    );
    assert.equal(results[0].name, "renamed_result");

    const trimmedPairs = result.diagnostics.items.filter((item) => item.kind === "history" && item.action === "trimmed");
    assert.match(trimmedPairs.find((item) => item.id === "tool-pair:orphan-call").reason, /孤立/);
    assert.match(trimmedPairs.find((item) => item.id === "tool-pair:orphan-result").reason, /孤立/);
    assert.match(trimmedPairs.find((item) => item.id === "tool-pair:reversed").reason, /早于/);
    assert.match(trimmedPairs.find((item) => item.id === "tool-pair:ambiguous").reason, /不明确/);
    assert.match(trimmedPairs.find((item) => item.id === "tool-pair:pending").reason, /审批/);
});

test("keeps the selected shot when the generic storyboard overview is too large", () => {
    const largeStoryboard = structuredClone(storyboard);
    largeStoryboard.document.scenes.push(
        ...Array.from({ length: 80 }, (_, index) => ({
            id: `extra-scene-${index}`,
            sceneNo: index + 3,
            sourceRefs: [],
            location: `OVERVIEW_ONLY_${index}_${"大厅".repeat(20)}`,
            time: "夜",
            characters: ["群演"],
            emotion: "混乱",
            segments: [],
        })),
    );

    const result = buildBrainstormContext(input({ storyboard: largeStoryboard, budget: { contextWindowTokens: 1_100, outputReserveTokens: 200 } }));
    const allContent = content(result);

    assert.match(allContent, /SELECTED_SHOT_MARKER/);
    assert.doesNotMatch(allContent, /OVERVIEW_ONLY_79/);
    assert.equal(diagnostic(result, "storyboard", "storyboard:storyboard-1:focus:shot:scene-a:segment-a:shot-b").action, "included");
    assert.equal(diagnostic(result, "storyboard", "storyboard:storyboard-1:overview").action, "trimmed");
});

test("does not replay trimmed history when another candidate reuses its raw id", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [assistant("shared-id", null, [{ type: "text", text: `HUGE_HISTORY_MARKER_${"历史".repeat(8_000)}` }])],
            memories: [{ id: "shared-id", content: "SMALL_MEMORY_MARKER", confirmed: true, scope: { kind: "project" } }],
            budget: { contextWindowTokens: 2_000, outputReserveTokens: 200 },
        }),
    );

    assert.match(content(result), /SMALL_MEMORY_MARKER/);
    assert.doesNotMatch(content(result), /HUGE_HISTORY_MARKER/);
    assert.equal(diagnostic(result, "history", "shared-id").action, "trimmed");
});

test("applies one final budget including tool schemas and trims valid tool pairs atomically", () => {
    const pairOutput = [
        { type: "tool_call", callId: "large-pair", name: "read_scene", arguments: JSON.stringify({ query: "参数".repeat(600) }) },
        { type: "tool_result", callId: "large-pair", name: "read_scene", status: "succeeded", content: "结果".repeat(600) },
    ];
    const result = buildBrainstormContext(
        input({
            priorMessages: [user("u1", null, "旧问题"), assistant("a1", "u1", pairOutput), user("u2", "a1", "RECENT_SMALL_HISTORY")],
            currentUserMessage: user("current", "u2", "继续"),
            tools: [
                {
                    name: "read_scene",
                    description: "读取场次".repeat(20),
                    parameters: { type: "object", properties: { sceneId: { type: "string", description: "稳定场次 ID" } }, required: ["sceneId"] },
                    risk: "read",
                    approval: "auto",
                },
            ],
            budget: { contextWindowTokens: 1_800, outputReserveTokens: 200 },
        }),
    );

    assert.match(content(result), /RECENT_SMALL_HISTORY/);
    assert.equal(
        result.messages.some((message) => message.type === "tool_call" && message.callId === "large-pair"),
        false,
    );
    assert.equal(
        result.messages.some((message) => message.type === "tool_result" && message.callId === "large-pair"),
        false,
    );
    assert.equal(result.tools.length, 1);
    assert.ok(result.diagnostics.toolSchemaTokens > 0);
    assert.equal(diagnostic(result, "tool_schema", "read_scene").action, "included");
    assert.equal(diagnostic(result, "history", "a1").action, "trimmed");
    assert.match(diagnostic(result, "history", "a1").reason, /预算/);
    assert.ok(result.diagnostics.usedTokens <= result.diagnostics.limitTokens);
});

test("throws readable CONTEXT_BUDGET_EXCEEDED with diagnostics when fixed context cannot fit", () => {
    assert.throws(
        () => buildBrainstormContext(input({ budget: { contextWindowTokens: 12, outputReserveTokens: 8 } })),
        (error) => {
            assert.ok(error instanceof BrainstormContextError);
            assert.equal(error.code, "CONTEXT_BUDGET_EXCEEDED");
            assert.match(error.message, /CONTEXT_BUDGET_EXCEEDED/);
            assert.match(error.message, /固定系统规则|当前用户输入/);
            assert.ok(error.diagnostics.usedTokens > error.diagnostics.limitTokens);
            assert.equal(diagnostic({ diagnostics: error.diagnostics }, "system", "brainstorm-system").action, "included");
            assert.equal(diagnostic({ diagnostics: error.diagnostics }, "current_user", "current").action, "included");
            return true;
        },
    );
});

test("trims tool schemas instead of sacrificing fixed system and current user context", () => {
    const result = buildBrainstormContext(
        input({
            tools: [
                {
                    name: "oversized_tool",
                    description: "说明".repeat(2_000),
                    parameters: { type: "object", properties: {} },
                    risk: "read",
                    approval: "auto",
                },
            ],
            budget: { contextWindowTokens: 500, outputReserveTokens: 100 },
        }),
    );

    assert.deepEqual(result.tools, []);
    assert.equal(diagnostic(result, "tool_schema", "oversized_tool").action, "trimmed");
    assert.equal(result.messages[0].role, "system");
    assert.equal(result.messages.at(-1).content, "CURRENT_USER_MARKER");
    assert.ok(result.diagnostics.usedTokens <= result.diagnostics.limitTokens);
});

test("orders, deduplicates, and bounds scoped Memory before applying the final token budget", () => {
    const memories = [
        { id: "project-duplicate", content: "  SAME   MEMORY  ", confirmed: true, updatedAt: "2026-08-31T03:00:00Z", scope: { kind: "project" } },
        { id: "scene-b", content: "SCENE_B", confirmed: true, updatedAt: "2026-08-31T02:00:00Z", scope: { kind: "scene", sceneId: "scene-a" } },
        { id: "shot-duplicate", content: "same memory", confirmed: true, updatedAt: "2026-08-31T01:00:00Z", scope: { kind: "shot", shotId: "shot-b" } },
        { id: "scene-a", content: "SCENE_A", confirmed: true, updatedAt: "2026-08-31T02:00:00Z", scope: { kind: "scene", sceneId: "scene-a" } },
        { id: "too-long", content: "X".repeat(40), confirmed: true, scope: { kind: "project" } },
        { id: "project-extra", content: "PROJECT_EXTRA", confirmed: true, scope: { kind: "project" } },
    ];
    const result = buildBrainstormContext(input({ memories, memoryLimits: { maxItems: 3, maxContentBytes: 32, maxTotalBytes: 64 } }));
    const allContent = content(result);

    assert.match(allContent, /shot-duplicate/);
    assert.match(allContent, /scene-a/);
    assert.match(allContent, /scene-b/);
    assert.doesNotMatch(allContent, /project-duplicate|too-long|project-extra/);
    const injectedMemory = result.messages.filter((message) => message.type === "message" && message.content.startsWith("Memory 参考")).map((message) => message.content);
    assert.deepEqual(
        injectedMemory.map((message) => JSON.parse(message.slice(message.indexOf("\n") + 1)).id),
        ["shot-duplicate", "scene-a", "scene-b"],
    );
    assert.match(diagnostic(result, "memory", "project-duplicate").reason, /重复内容/);
    assert.match(diagnostic(result, "memory", "too-long").reason, /长度/);
    assert.match(diagnostic(result, "memory", "project-extra").reason, /数量上限/);
});

test("accepts only User-boundary Summary checkpoints and exposes their coverage metadata", () => {
    const priorMessages = [user("u1", null, "旧问题"), assistant("a1", "u1", [{ type: "text", text: "旧回答" }])];
    const invalid = buildBrainstormContext(
        input({
            priorMessages,
            currentUserMessage: user("current", "a1", "继续"),
            summary: { id: "summary-invalid", throughMessageId: "a1", content: "INVALID_SUMMARY" },
        }),
    );
    assert.doesNotMatch(content(invalid), /INVALID_SUMMARY/);
    assert.match(diagnostic(invalid, "summary", "summary-invalid").reason, /User Message/);

    const valid = buildBrainstormContext(
        input({
            priorMessages,
            currentUserMessage: user("current", "a1", "继续"),
            summary: {
                id: "summary-valid",
                fromMessageId: "u0",
                throughMessageId: "u1",
                content: "VALID_SUMMARY",
                tokenCount: 9,
                sourceTokenCount: 80,
                coveredMessageCount: 5,
                model: "summary-model",
            },
        }),
    );
    assert.match(content(valid), /VALID_SUMMARY/);
    assert.deepEqual(valid.diagnostics.summaryCheckpoint, {
        id: "summary-valid",
        fromMessageId: "u0",
        throughMessageId: "u1",
        coveredMessageCount: 5,
        sourceTokenCount: 80,
        model: "summary-model",
        action: "included",
    });
});

test("retains one contiguous recent branch tail and diagnoses older history after the first budget cut", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [
                user("u1", null, "OLDER_USER_MARKER"),
                assistant("a1", "u1", [{ type: "text", text: "OLDER_ASSISTANT_MARKER" }]),
                user("u2", "a1", "SMALL_BEFORE_OVERSIZED"),
                assistant("a2", "u2", [{ type: "text", text: `OVERSIZED_MIDDLE_${"中段".repeat(2_000)}` }]),
                user("u3", "a2", "RECENT_BRANCH_TAIL"),
            ],
            currentUserMessage: user("current", "u3", "继续"),
            budget: { contextWindowTokens: 1_800, outputReserveTokens: 200 },
        }),
    );
    const allContent = content(result);

    assert.match(allContent, /RECENT_BRANCH_TAIL/);
    assert.doesNotMatch(allContent, /OVERSIZED_MIDDLE|SMALL_BEFORE_OVERSIZED|OLDER_USER_MARKER|OLDER_ASSISTANT_MARKER/);
    assert.match(diagnostic(result, "history", "u2").reason, /连续的最近分支尾部/);
    assert.deepEqual(result.diagnostics.branchTail, {
        retainedFromMessageId: "u3",
        retainedMessageCount: 1,
        trimmedMessageCount: 4,
    });
});

test("keeps Tool Call and Tool Result across assistant messages atomic at the branch-tail budget cut", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [
                user("u1", null, "旧问题"),
                assistant("a-call", "u1", [{ type: "tool_call", callId: "cross-message", name: "read_scene", arguments: JSON.stringify({ query: "参数".repeat(700) }) }]),
                assistant("a-result", "a-call", [{ type: "tool_result", callId: "cross-message", name: "read_scene", status: "succeeded", content: "结果".repeat(700) }]),
                user("u2", "a-result", "RECENT_AFTER_TOOL_PAIR"),
            ],
            currentUserMessage: user("current", "u2", "继续"),
            budget: { contextWindowTokens: 1_800, outputReserveTokens: 200 },
        }),
    );

    assert.match(content(result), /RECENT_AFTER_TOOL_PAIR/);
    assert.equal(
        result.messages.some((message) => message.type === "tool_call" && message.callId === "cross-message"),
        false,
    );
    assert.equal(
        result.messages.some((message) => message.type === "tool_result" && message.callId === "cross-message"),
        false,
    );
    assert.doesNotMatch(content(result), /旧问题/);
});

test("rejects a User-boundary Summary checkpoint that splits a Tool Call and Result", () => {
    const result = buildBrainstormContext(
        input({
            priorMessages: [
                user("u1", null, "开始"),
                assistant("a-call", "u1", [{ type: "tool_call", callId: "pair", name: "read_scene", arguments: "{}" }]),
                user("u2", "a-call", "不要在这里切分"),
                assistant("a-result", "u2", [{ type: "tool_result", callId: "pair", name: "read_scene", status: "succeeded", content: "RESULT" }]),
            ],
            currentUserMessage: user("current", "a-result", "继续"),
            summary: { id: "summary-split", throughMessageId: "u2", content: "INVALID_SPLIT_SUMMARY" },
        }),
    );

    assert.doesNotMatch(content(result), /INVALID_SPLIT_SUMMARY/);
    assert.match(diagnostic(result, "summary", "summary-split").reason, /Tool Call\/Result/);
});

test("accepts a detached branch Summary only with complete coverage metadata", () => {
    const priorMessages = [user("u2", null, "分页后保留的问题"), assistant("a2", "u2", [{ type: "text", text: "分页后的回答" }])];
    const detached = buildBrainstormContext(
        input({
            priorMessages,
            currentUserMessage: user("current", "a2", "继续"),
            summary: {
                id: "summary-detached",
                fromMessageId: "u0",
                throughMessageId: "u1",
                content: "DETACHED_SUMMARY",
                tokenCount: 12,
                sourceTokenCount: 100,
                coveredMessageCount: 6,
                model: "summary-model",
            },
        }),
    );
    assert.match(content(detached), /DETACHED_SUMMARY/);
    assert.equal(detached.diagnostics.summary, "included");

    const incomplete = buildBrainstormContext(
        input({
            priorMessages,
            currentUserMessage: user("current", "a2", "继续"),
            summary: { id: "summary-incomplete", throughMessageId: "u1", content: "INCOMPLETE_SUMMARY" },
        }),
    );
    assert.doesNotMatch(content(incomplete), /INCOMPLETE_SUMMARY/);
    assert.match(diagnostic(incomplete, "summary", "summary-incomplete").reason, /覆盖元数据/);
});
