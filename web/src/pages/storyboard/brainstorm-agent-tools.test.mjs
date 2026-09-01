import assert from "node:assert/strict";
import { test } from "node:test";

import { resumeBrainstormTurn, runBrainstormTurn } from "./brainstorm-agent-runner.ts";
import { STORYBOARD_BRAINSTORM_TOOLS, createStoryboardToolRuntime, previewStoryboardToolCall } from "./brainstorm-agent-tools.ts";

const project = {
    id: "project-1",
    title: "雨夜来客",
    source: "第一场：保安说别动。\n第二场：大门忽然打开。",
    options: { aspectRatio: "16:9", targetDurationSec: 12, style: "悬疑", maxSegmentDurationSec: 15, maxShotDurationSec: 12, dialogueMustBeExact: true, allowMusic: false },
    model: "text-model",
    sourceHash: "sha256:abc",
    status: "ready",
    revision: 3,
    validationStatus: "passed",
    sceneCount: 1,
    shotCount: 1,
    directorPlan: null,
    document: {
        schemaVersion: "1.0",
        title: "雨夜来客",
        sourceType: "script",
        aspectRatio: "16:9",
        targetDurationSec: 12,
        scenes: [
            {
                id: "scene-1",
                sceneNo: 1,
                sourceRefs: ["第一场"],
                location: "门厅",
                time: "夜",
                characters: ["保安"],
                emotion: "紧张",
                segments: [
                    {
                        id: "segment-1",
                        segmentNo: 1,
                        durationSec: 12,
                        assetIds: [],
                        shots: [
                            {
                                id: "shot-1",
                                shotNo: 1,
                                visual: "保安回头",
                                durationSec: 12,
                                framing: "中景",
                                camera: "固定",
                                dialogue: "保安：别动。",
                                sound: "雨声",
                                sourceRefs: ["第一场"],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    validation: { status: "passed", errors: [], warnings: [] },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T01:00:00.000Z",
};

const diagnostics = { limitTokens: 1000, reservedOutputTokens: 200, usedTokens: 100, toolSchemaTokens: 10, estimated: true, summary: "missing", items: [] };
const context = (tools) => ({ messages: [{ type: "message", role: "user", content: "请优化镜头" }], tools, diagnostics });

function services(overrides = {}) {
    return {
        fetchProject: async () => structuredClone(project),
        updateProject: async (_id, workspace, expectedRevision) => ({ ...structuredClone(project), ...workspace, revision: expectedRevision + 1 }),
        listMemories: async () => ({ items: [], total: 0 }),
        createMemory: async (_projectId, input) => ({ ...input, projectId: "project-1", createdAt: "", updatedAt: "" }),
        deleteMemory: async (_projectId, memoryId) => ({ id: memoryId, deletedAt: "" }),
        ...overrides,
    };
}

function call(name, argumentsValue, callId = "call-1") {
    return { type: "tool_call", callId, name, arguments: JSON.stringify(argumentsValue) };
}

function decode(execution) {
    return JSON.parse(execution.content);
}

test("standalone Tool Runtime 在 preflight/execute 阶段拒绝 Storyboard 工具与非 project Memory", async () => {
    assert.throws(() => createStoryboardToolRuntime({ scope: "standalone", projectId: "project-1", services: services() }), /standalone Brainstorm Tool Runtime 的 scope ID 必须是 __brainstorm__/);
    let reads = 0;
    let writes = 0;
    const runtime = createStoryboardToolRuntime({
        scope: "standalone",
        projectId: "__brainstorm__",
        services: services({
            fetchProject: async () => {
                reads += 1;
                return structuredClone(project);
            },
            updateProject: async () => {
                writes += 1;
                return project;
            },
        }),
    });
    const applyCall = call("storyboard_apply_patch", {
        projectId: "__brainstorm__",
        expectedRevision: 3,
        operations: [{ target: "project", field: "title", value: "不应应用" }],
    });
    const applyPreflight = await runtime.preflightTool(applyCall, { definition: runtime.tools[7] });
    const applyExecution = await runtime.executeTool(applyCall, { definition: runtime.tools[7], authorization: "approved" });
    assert.equal(applyPreflight.status, "failed");
    assert.equal(decode(applyPreflight).error.code, "TOOL_NOT_ALLOWED_IN_STANDALONE");
    assert.equal(applyExecution.status, "failed");
    assert.equal(decode(applyExecution).error.code, "TOOL_NOT_ALLOWED_IN_STANDALONE");

    const crossScopeCall = call("storyboard_remember", { projectId: "other-scope", kind: "constraint", scope: "project", content: "跨 scope", tags: [] }, "call-cross-scope");
    const crossScopePreflight = await runtime.preflightTool(crossScopeCall, { definition: runtime.tools[8] });
    assert.equal(crossScopePreflight.status, "failed");
    assert.equal(decode(crossScopePreflight).error.code, "PROJECT_SCOPE_MISMATCH");
    assert.notEqual(crossScopePreflight.status, "awaiting_approval");

    const sceneCall = call("storyboard_remember", { projectId: "__brainstorm__", kind: "constraint", scope: "scene", path: "scene-1", content: "场景约束", tags: [] });
    const shotCall = call("storyboard_remember", { projectId: "__brainstorm__", kind: "constraint", scope: "shot", path: "shot-1", content: "镜头约束", tags: [] }, "call-shot");
    const scenePreflight = await runtime.preflightTool(sceneCall, { definition: runtime.tools[8] });
    const shotPreflight = await runtime.preflightTool(shotCall, { definition: runtime.tools[8] });
    assert.equal(scenePreflight.status, "failed");
    assert.equal(shotPreflight.status, "failed");
    assert.equal(decode(scenePreflight).error.code, "INVALID_ARGUMENTS");
    assert.equal(decode(shotPreflight).error.code, "INVALID_ARGUMENTS");
    assert.notEqual(scenePreflight.status, "awaiting_approval");
    assert.notEqual(shotPreflight.status, "awaiting_approval");
    assert.equal(reads, 0);
    assert.equal(writes, 0);
});

test("standalone Memory 不需要 projectId，并由 Runtime 注入固定脑暴 scope", async () => {
    let createdProjectId = "";
    const runtime = createStoryboardToolRuntime({
        scope: "standalone",
        projectId: "__brainstorm__",
        memoryIdentity: () => ({ id: "memory-1", operationId: "operation-1", sourceMessageId: "message-1" }),
        services: services({
            fetchProject: async () => ({ ...structuredClone(project), id: "__brainstorm__" }),
            createMemory: async (projectId, input) => {
                createdProjectId = projectId;
                return { ...input, projectId, createdAt: "", updatedAt: "" };
            },
        }),
    });
    const memoryCall = call("storyboard_remember", { kind: "character", scope: "project", content: "主角叫沈舟，是一名失去记忆的记者。", tags: [] });
    const preview = await runtime.preflightTool(memoryCall, { definition: runtime.tools[8] });
    assert.equal(preview.status, "succeeded");
    assert.deepEqual(decode(preview).data.targets, ["脑暴工作区"]);

    const execution = await runtime.executeTool(memoryCall, { definition: runtime.tools[8], authorization: "approved" });
    assert.equal(execution.status, "succeeded");
    assert.equal(createdProjectId, "__brainstorm__");
});

test("registry exposes only the ten whitelisted tools and requires approval for business writes", () => {
    assert.deepEqual(
        STORYBOARD_BRAINSTORM_TOOLS.map(({ name, risk, approval }) => ({ name, risk, approval })),
        [
            ["storyboard_get_overview", "read", "auto"],
            ["storyboard_get_scene", "read", "auto"],
            ["storyboard_get_shot", "read", "auto"],
            ["storyboard_search_source", "read", "auto"],
            ["storyboard_get_validation", "read", "auto"],
            ["storyboard_list_memories", "read", "auto"],
            ["storyboard_propose_patch", "write", "auto"],
            ["storyboard_apply_patch", "write", "required"],
            ["storyboard_remember", "write", "required"],
            ["storyboard_forget_memory", "write", "required"],
        ].map(([name, risk, approval]) => ({ name, risk, approval })),
    );
    for (const tool of STORYBOARD_BRAINSTORM_TOOLS) {
        assert.equal(tool.parameters.additionalProperties, false);
        assert.equal(Object.isFrozen(tool), true);
    }
    assert.throws(() => {
        STORYBOARD_BRAINSTORM_TOOLS[7].approval = "auto";
    }, TypeError);
    const patchVariants = STORYBOARD_BRAINSTORM_TOOLS[6].parameters.properties.operations.items.oneOf;
    assert.equal(patchVariants.length, 6);
    assert.ok(patchVariants.some((variant) => variant.properties.target.enum[0] === "shot" && variant.required.includes("sceneId") && variant.required.includes("segmentId") && variant.required.includes("shotId")));
    const rememberSchema = STORYBOARD_BRAINSTORM_TOOLS[8].parameters;
    assert.equal(rememberSchema.oneOf.length, 2);
    assert.equal(rememberSchema.oneOf[1].required.includes("path"), true);
    const rememberProperties = rememberSchema.properties;
    assert.equal("id" in rememberProperties, false);
    assert.equal("operationId" in rememberProperties, false);
    assert.equal("sourceMessageId" in rememberProperties, false);
});

test("write approval preview is derived without reading or mutating project state", () => {
    const preview = previewStoryboardToolCall(
        call("storyboard_apply_patch", {
            projectId: "project-1",
            expectedRevision: 3,
            operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "visual", value: "保安猛然回头" }],
        }),
    );

    assert.deepEqual(preview, { title: "应用分镜修改", summary: "将修改 1 个字段（基于 revision 3）", targets: ["镜头 shot-1 · visual"] });
    assert.deepEqual(
        previewStoryboardToolCall(
            call("storyboard_apply_patch", {
                projectId: "project-1",
                expectedRevision: 3,
                operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "durationSec", value: 6 }],
            }),
        ).targets,
        ["镜头 shot-1 · durationSec", "片段 segment-1 · durationSec（自动重算）"],
    );
    assert.deepEqual(previewStoryboardToolCall(call("storyboard_remember", { projectId: "__brainstorm__", kind: "idea", scope: "project", content: "保留反常识结尾", tags: [] })), {
        title: "保存 Memory",
        summary: "保留反常识结尾",
        targets: ["脑暴工作区"],
    });
});

test("a read tool executes automatically and its untrusted normalized result enters the next model call", async () => {
    const runtime = createStoryboardToolRuntime({ projectId: "project-1", services: services() });
    const requests = [];
    const toolCall = call("storyboard_get_scene", { projectId: "project-1", sceneId: "scene-1" });
    const result = await runBrainstormTurn(context(runtime.tools), {
        executeTool: runtime.executeTool,
        complete: async (request) => {
            requests.push(structuredClone(request));
            return requests.length === 1 ? { content: "", toolCalls: [toolCall] } : { content: "场次已读取。", toolCalls: [] };
        },
    });

    assert.equal(result.status, "completed");
    const toolResult = requests[1].messages.at(-1);
    assert.equal(toolResult.type, "tool_result");
    assert.equal(toolResult.status, "succeeded");
    assert.deepEqual(JSON.parse(toolResult.content), { untrusted: true, tool: "storyboard_get_scene", ok: true, data: project.document.scenes[0] });
});

test("an apply tool cannot write before approval and rejection still returns to the model", async () => {
    let writes = 0;
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        services: services({
            updateProject: async () => {
                writes += 1;
                throw new Error("unexpected write");
            },
        }),
    });
    const toolCall = call("storyboard_apply_patch", {
        projectId: "project-1",
        expectedRevision: 3,
        operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "visual", value: "保安猛然回头" }],
    });
    const direct = await runtime.executeTool(toolCall, { definition: runtime.tools[7] });
    assert.equal(decode(direct).error.code, "APPROVAL_REQUIRED");
    assert.equal(writes, 0);
    let completions = 0;
    const dependencies = {
        executeTool: runtime.executeTool,
        preflightTool: runtime.preflightTool,
        complete: async () => (++completions === 1 ? { content: "", toolCalls: [toolCall] } : { content: "已保留原分镜。", toolCalls: [] }),
    };

    const pending = await runBrainstormTurn(context(runtime.tools), dependencies);
    assert.equal(pending.status, "awaiting_approval");
    assert.equal(writes, 0);

    const rejected = await resumeBrainstormTurn(pending.continuation, "rejected", dependencies);
    assert.equal(rejected.status, "completed");
    assert.equal(writes, 0);
    assert.equal(rejected.output.find((item) => item.type === "tool_result" && item.callId === toolCall.callId)?.status, "rejected");
});

test("invalid approval-required arguments fail preflight and return to the model without prompting or writing", async () => {
    let writes = 0;
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        memoryIdentity: () => ({ id: "memory-1", operationId: "operation-1", sourceMessageId: "assistant-1" }),
        services: services({ createMemory: async () => (writes += 1) }),
    });
    const invalidCall = call("storyboard_remember", { projectId: "project-1", kind: "character", scope: "scene", content: "设定", tags: [1] });
    let completions = 0;
    const result = await runBrainstormTurn(context(runtime.tools), {
        executeTool: runtime.executeTool,
        preflightTool: runtime.preflightTool,
        complete: async () => (++completions === 1 ? { content: "", toolCalls: [invalidCall] } : { content: "参数无效，未保存。", toolCalls: [] }),
    });

    assert.equal(result.status, "completed");
    assert.equal(writes, 0);
    assert.equal(result.output.find((item) => item.type === "tool_result" && item.callId === invalidCall.callId)?.status, "failed");
    assert.equal(decode(result.output.find((item) => item.type === "tool_result" && item.callId === invalidCall.callId)).error.code, "INVALID_ARGUMENTS");
});

test("approved patch applies only whitelisted fields with a fresh project and revision CAS", async () => {
    const updates = [];
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        services: services({
            updateProject: async (id, workspace, expectedRevision) => {
                updates.push({ id, workspace, expectedRevision });
                return { ...structuredClone(project), ...workspace, revision: expectedRevision + 1 };
            },
        }),
    });
    const toolCall = call("storyboard_apply_patch", {
        projectId: "project-1",
        expectedRevision: 3,
        operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "visual", value: "保安猛然回头" }],
    });
    let completions = 0;
    const dependencies = {
        executeTool: runtime.executeTool,
        preflightTool: runtime.preflightTool,
        complete: async () => (++completions === 1 ? { content: "", toolCalls: [toolCall] } : { content: "修改完成。", toolCalls: [] }),
    };

    const pending = await runBrainstormTurn(context(runtime.tools), dependencies);
    const completed = await resumeBrainstormTurn(pending.continuation, "approved", dependencies);

    assert.equal(completed.status, "completed");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, "project-1");
    assert.equal(updates[0].expectedRevision, 3);
    assert.equal(updates[0].workspace.document.scenes[0].segments[0].shots[0].visual, "保安猛然回头");
    assert.equal(updates[0].workspace.id, "project-1");
    assert.equal(updates[0].workspace.validation.status, "passed");
});

test("cancellation after the project read prevents a pending write from starting", async () => {
    const controller = new AbortController();
    let writes = 0;
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        services: services({
            fetchProject: async () => {
                controller.abort();
                return structuredClone(project);
            },
            updateProject: async () => {
                writes += 1;
                return project;
            },
        }),
    });
    const toolCall = call("storyboard_apply_patch", {
        projectId: "project-1",
        expectedRevision: 3,
        operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "visual", value: "保安回头" }],
    });

    await assert.rejects(runtime.executeTool(toolCall, { definition: runtime.tools[7], authorization: "approved", signal: controller.signal }), (error) => error instanceof Error && error.name === "AbortError");
    assert.equal(writes, 0);
});

test("stale revision, invalid arguments, and cross-project or missing entity access return structured failures without writes", async () => {
    let writes = 0;
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        services: services({
            updateProject: async () => {
                writes += 1;
                return project;
            },
        }),
    });

    const stale = await runtime.executeTool(
        call("storyboard_apply_patch", {
            projectId: "project-1",
            expectedRevision: 2,
            operations: [{ target: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1", field: "visual", value: "保安回头" }],
        }),
        { definition: runtime.tools[7], authorization: "approved" },
    );
    const invalid = await runtime.executeTool({ ...call("storyboard_get_scene", {}), arguments: "{" }, { definition: runtime.tools[1] });
    const foreign = await runtime.executeTool(call("storyboard_get_scene", { projectId: "project-2", sceneId: "scene-1" }), { definition: runtime.tools[1] });
    const missing = await runtime.executeTool(call("storyboard_get_shot", { projectId: "project-1", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-missing" }), { definition: runtime.tools[2] });

    assert.equal(stale.status, "failed");
    assert.equal(decode(stale).error.code, "STALE_REVISION");
    assert.equal(decode(invalid).error.code, "INVALID_ARGUMENTS");
    assert.equal(decode(foreign).error.code, "PROJECT_SCOPE_MISMATCH");
    assert.equal(decode(missing).error.code, "SHOT_NOT_FOUND");
    assert.equal(writes, 0);
});

test("memory writes use trusted identity, validate entity ownership, and distinguish idempotency conflicts", async () => {
    const created = [];
    const runtime = createStoryboardToolRuntime({
        projectId: "project-1",
        memoryIdentity: (toolCall) => ({ id: `memory-${toolCall.callId}`, operationId: `operation-${toolCall.callId}`, sourceMessageId: "assistant-1" }),
        services: services({
            createMemory: async (projectId, input) => {
                created.push([projectId, input]);
                return { ...input, projectId, createdAt: "", updatedAt: "" };
            },
        }),
    });
    const memoryArgs = { projectId: "project-1", kind: "character", scope: "shot", path: "shot-1", content: "保安怕黑", tags: ["人物"] };

    const succeeded = await runtime.executeTool(call("storyboard_remember", memoryArgs), { definition: runtime.tools[8], authorization: "approved" });
    const rejected = await runtime.executeTool(call("storyboard_remember", { ...memoryArgs, scope: "scene", path: "scene-missing" }, "call-2"), { definition: runtime.tools[8], authorization: "approved" });
    const modelIdentity = await runtime.executeTool(call("storyboard_remember", { ...memoryArgs, id: "model-memory" }, "call-3"), { definition: runtime.tools[8], authorization: "approved" });
    const conflictRuntime = createStoryboardToolRuntime({
        projectId: "project-1",
        memoryIdentity: () => ({ id: "memory-conflict", operationId: "operation-conflict", sourceMessageId: "assistant-1" }),
        services: services({ createMemory: async () => Promise.reject({ status: 409 }) }),
    });
    const conflict = await conflictRuntime.executeTool(call("storyboard_remember", memoryArgs), { definition: conflictRuntime.tools[8], authorization: "approved" });

    assert.equal(succeeded.status, "succeeded");
    assert.deepEqual(created, [["project-1", { id: "memory-call-1", kind: "character", scope: "shot", path: "shot-1", content: "保安怕黑", tags: ["人物"], sourceMessageId: "assistant-1", operationId: "operation-call-1" }]]);
    assert.equal(decode(rejected).error.code, "SCENE_NOT_FOUND");
    assert.equal(decode(modelIdentity).error.code, "INVALID_ARGUMENTS");
    assert.equal(decode(conflict).error.code, "MEMORY_CONFLICT");
});

test("tool results remain valid JSON and respect the configured length limit", async () => {
    const runtime = createStoryboardToolRuntime({ projectId: "project-1", resultLimit: 500, services: services({ fetchProject: async () => ({ ...structuredClone(project), source: "雨".repeat(5000) }) }) });
    const result = await runtime.executeTool(call("storyboard_search_source", { projectId: "project-1", query: "雨", limit: 10 }), { definition: runtime.tools[3] });

    assert.ok(result.content.length <= 500);
    assert.ok(new TextEncoder().encode(result.content).byteLength <= 500);
    assert.equal(JSON.parse(result.content).truncated, true);
});
