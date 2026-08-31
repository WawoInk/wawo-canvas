import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");

const project = {
    id: "project-1",
    title: "最新标题",
    source: "第一场：门厅。",
    options: { aspectRatio: "16:9", targetDurationSec: 12, style: "悬疑", maxSegmentDurationSec: 15, maxShotDurationSec: 12, dialogueMustBeExact: true, allowMusic: false },
    model: "text-model",
    sourceHash: "sha256:latest",
    status: "ready",
    revision: 7,
    validationStatus: "passed",
    sceneCount: 1,
    shotCount: 1,
    directorPlan: null,
    document: {
        schemaVersion: "1.0",
        title: "最新标题",
        sourceType: "script",
        aspectRatio: "16:9",
        targetDurationSec: 12,
        scenes: [
            {
                id: "scene-focus",
                sceneNo: 1,
                sourceRefs: ["第一场"],
                location: "门厅",
                time: "夜",
                characters: ["保安"],
                emotion: "紧张",
                segments: [
                    {
                        id: "segment-focus",
                        segmentNo: 1,
                        durationSec: 12,
                        assetIds: [],
                        shots: [
                            {
                                id: "shot-focus",
                                shotNo: 1,
                                visual: "保安回头",
                                durationSec: 12,
                                framing: "中景",
                                camera: "固定",
                                dialogue: "别动",
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
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T00:00:00Z",
};

const memory = (id, content, scope = "project", path = "") => ({
    id,
    projectId: "project-1",
    kind: "constraint",
    scope,
    path,
    content,
    tags: ["confirmed"],
    sourceMessageId: "assistant-old",
    operationId: `operation-${id}`,
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T00:00:00Z",
});
const user = (id, parentId, content) => ({ id, projectId: "project-1", conversationId: "conversation-1", parentId, role: "user", content, output: [], revision: 1, createdAt: "", updatedAt: "" });
const assistant = (id, parentId, output = [], status = "completed") => ({
    id,
    projectId: "project-1",
    conversationId: "conversation-1",
    parentId,
    role: "assistant",
    status,
    clientRequestId: `request-${id}`,
    output,
    revision: 1,
    createdAt: "",
    updatedAt: "",
});
const config = {
    channelMode: "local",
    baseUrl: "https://provider.test/v1",
    apiKey: "key",
    apiFormat: "openai",
    channels: [{ id: "text", name: "Text", baseUrl: "https://provider.test/v1", apiKey: "key", apiFormat: "openai", models: ["gpt-test"] }],
    model: "image-model",
    imageModel: "image-model",
    videoModel: "video-model",
    textModel: "text::gpt-test",
    audioModel: "audio-model",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoNegativePrompt: "",
    systemPrompt: "",
    imageRequestFormats: [],
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

let completion;
let updateProject = async () => structuredClone(project);
let createMemory = async (_projectId, input) => ({ ...input, projectId: "project-1", createdAt: "", updatedAt: "" });
let deleteMemory = async (_projectId, id) => ({ id, deletedAt: "" });
let projectReads = 0;
const memoryReads = [];
let listMemories = async (_projectId, query) => {
    memoryReads.push(query);
    return query.page === 1 ? { items: [memory("memory-project", "项目记忆")], total: 2 } : { items: [memory("memory-shot", "焦点镜头记忆", "shot", "shot-focus")], total: 2 };
};
mock.module("@/services/api/image", () => ({ requestToolResponse: (...args) => completion(...args) }));
mock.module("@/services/api/storyboards", () => ({
    fetchStoryboardRecord: async () => {
        projectReads += 1;
        return structuredClone(project);
    },
    updateStoryboardRecord: (...args) => updateProject(...args),
}));
mock.module("@/services/api/storyboard-brainstorm", () => ({
    fetchStoryboardMemories: (...args) => listMemories(...args),
    createStoryboardMemory: (...args) => createMemory(...args),
    deleteStoryboardMemory: (...args) => deleteMemory(...args),
}));

const { createBrainstormAgentRuntime } = await import("./brainstorm-agent-runtime.ts");

test("append 每次读取最新 Storyboard/全部 Memory，并把当前分支 Context 与增量事件接到文本模型流", async () => {
    projectReads = 0;
    memoryReads.length = 0;
    let request;
    completion = async (...args) => {
        request = args;
        const options = args[5];
        options.onEvent({ type: "text_delta", delta: "第一", content: "第一" });
        options.onEvent({ type: "text_delta", delta: "第二", content: "第一第二" });
        options.onEvent({ type: "usage", inputTokens: 21, outputTokens: 2, totalTokens: 23 });
        return { content: "第一第二", toolCalls: [], usage: { inputTokens: 21, outputTokens: 2, totalTokens: 23 }, finishReason: "stop" };
    };
    const messages = [
        user("user-root", "", "根问题"),
        assistant("assistant-root", "user-root", [{ type: "text", text: "根回答" }]),
        user("user-sibling", "assistant-root", "不应进入的 sibling"),
        assistant("assistant-sibling", "user-sibling", [{ type: "text", text: "不应进入的 sibling 回答" }]),
        user("user-current", "assistant-root", "当前真实问题"),
        assistant("assistant-new", "user-current", [], "pending"),
    ];
    const events = [];
    const result = await createBrainstormAgentRuntime({
        projectId: "project-1",
        config,
        skillId: "visual_storytelling",
        focus: { kind: "shot", sceneId: "scene-focus", segmentId: "segment-focus", shotId: "shot-focus" },
    }).run(
        {
            mode: "append",
            projectId: "project-1",
            conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: "assistant-new", createdAt: "", updatedAt: "" },
            messages,
            assistantMessage: messages.at(-1),
        },
        { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
    );

    assert.equal(projectReads, 1);
    assert.deepEqual(memoryReads, [
        { page: 1, pageSize: 500 },
        { page: 2, pageSize: 500 },
    ]);
    assert.equal(request[0].model, config.textModel);
    assert.equal(request[0].systemPrompt, "");
    assert.equal(request[3], "auto");
    assert.equal(request[4], undefined);
    assert.equal(request[5].includeUsage, true);
    const prompt = request[1]
        .filter((item) => "content" in item && typeof item.content === "string")
        .map((item) => item.content)
        .join("\n");
    assert.match(prompt, /visual_storytelling@1\.0\.0/);
    assert.match(prompt, /shot-focus/);
    assert.match(prompt, /项目记忆/);
    assert.match(prompt, /焦点镜头记忆/);
    assert.match(prompt, /根问题/);
    assert.match(prompt, /根回答/);
    assert.match(prompt, /当前真实问题/);
    assert.doesNotMatch(prompt, /不应进入的 sibling/);
    assert.deepEqual(
        events.filter((event) => event.type === "text_delta"),
        [
            { type: "text_delta", delta: "第一" },
            { type: "text_delta", delta: "第二" },
        ],
    );
    assert.equal(result.status, "completed");
    assert.equal(result.diagnostics.limitTokens, 28000);
    assert.equal(result.diagnostics.reservedOutputTokens, 4000);
    assert.deepEqual(result.output, [{ type: "text", text: "第一第二" }]);
    assert.deepEqual(result.usage, { inputTokens: 21, outputTokens: 2, totalTokens: 23 });
});

test("Completion 映射 Tool Call/Result、usage，并把 AbortSignal 传入当前文本模型兼容流", async () => {
    projectReads = 0;
    memoryReads.length = 0;
    const requests = [];
    const controller = new AbortController();
    let round = 0;
    completion = async (...args) => {
        requests.push(args);
        assert.equal(args[5].signal, controller.signal);
        round += 1;
        if (round === 1) {
            args[5].onEvent({ type: "tool_call_delta", index: 0, id: "call-overview", name: "storyboard_get_overview", argumentsDelta: '{"projectId":"project-1"}', arguments: '{"projectId":"project-1"}' });
            args[5].onEvent({ type: "usage", inputTokens: 10, outputTokens: 1, totalTokens: 11 });
            return {
                content: "",
                toolCalls: [{ id: "call-overview", type: "function", function: { name: "storyboard_get_overview", arguments: '{"projectId":"project-1"}' } }],
                usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
                finishReason: "tool_calls",
            };
        }
        args[5].onEvent({ type: "text_delta", delta: "已读取", content: "已读取" });
        return { content: "已读取", toolCalls: [], usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 }, finishReason: "stop" };
    };
    const messages = [user("user-tool", "", "读取项目"), assistant("assistant-tool", "user-tool", [], "pending")];
    const events = [];
    const result = await createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
        {
            mode: "append",
            projectId: "project-1",
            conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: "assistant-tool", createdAt: "", updatedAt: "" },
            messages,
            assistantMessage: messages[1],
        },
        { signal: controller.signal, onEvent: (event) => events.push(event) },
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0][2][0].type, "function");
    assert.equal(requests[0][2][0].function.strict, true);
    assert.deepEqual(
        requests[1][1].slice(-2).map((item) => item.type || item.role),
        ["function_call", "tool"],
    );
    assert.equal(requests[1][1].at(-2).call_id, "call-overview");
    assert.equal(requests[1][1].at(-1).tool_call_id, "call-overview");
    assert.match(requests[1][1].at(-1).content, /"tool":"storyboard_get_overview"/);
    assert.deepEqual(
        result.output.map((item) => item.type),
        ["tool_call", "tool_result", "text"],
    );
    assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 3, totalTokens: 21 });
    assert.deepEqual(
        events.filter((event) => event.type === "text_delta"),
        [{ type: "text_delta", delta: "已读取" }],
    );
});

test("模型请求中止时 Runtime 返回 cancelled 且不吞掉 AbortSignal", async () => {
    let entered;
    const requesting = new Promise((resolve) => {
        entered = resolve;
    });
    completion = async (...args) => {
        const signal = args[5].signal;
        entered();
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        const error = new Error("请求已取消");
        error.name = "AbortError";
        args[5].onEvent({ type: "abort", error });
        throw error;
    };
    const messages = [user("user-abort", "", "开始"), assistant("assistant-abort", "user-abort", [], "pending")];
    const controller = new AbortController();
    const promise = createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
        {
            mode: "append",
            projectId: "project-1",
            conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: "assistant-abort", createdAt: "", updatedAt: "" },
            messages,
            assistantMessage: messages[1],
        },
        { signal: controller.signal, onEvent: () => undefined },
    );
    await requesting;
    controller.abort();
    const result = await promise;
    assert.equal(result.status, "cancelled");
    assert.equal(result.error.code, "ABORTED");
});

test("regenerate 使用真实 parent User 分支，continue 保留原 Assistant 输出并追加显式继续意图", async () => {
    const requests = [];
    completion = async (...args) => {
        requests.push(args[1]);
        return { content: "完成", toolCalls: [], finishReason: "stop" };
    };
    const runtime = createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "character_conflict", focus: { kind: "project" } });
    const root = user("user-parent", "", "真实父级问题");
    const old = assistant("assistant-old", "user-parent", [{ type: "text", text: "旧 sibling 回答" }]);
    const regenerated = assistant("assistant-regenerated", "user-parent", [], "pending");
    await runtime.run(
        {
            mode: "regenerate",
            projectId: "project-1",
            conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: regenerated.id, createdAt: "", updatedAt: "" },
            messages: [root, old, regenerated],
            assistantMessage: regenerated,
        },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );

    const continued = { ...old, status: "pending" };
    await runtime.run(
        {
            mode: "continue",
            projectId: "project-1",
            conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: old.id, createdAt: "", updatedAt: "" },
            messages: [root, continued],
            assistantMessage: continued,
        },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );

    const regeneratePrompt = requests[0]
        .filter((item) => typeof item.content === "string")
        .map((item) => item.content)
        .join("\n");
    assert.match(regeneratePrompt, /真实父级问题/);
    assert.doesNotMatch(regeneratePrompt, /旧 sibling 回答/);
    const continuePrompt = requests[1]
        .filter((item) => typeof item.content === "string")
        .map((item) => item.content)
        .join("\n");
    assert.match(continuePrompt, /真实父级问题/);
    assert.match(continuePrompt, /旧 sibling 回答/);
    assert.match(continuePrompt, /继续上一条回复/);
});

test("同页审批优先 resume continuation，并以稳定 Assistant+Tool 身份写 Memory 后触发回调", async () => {
    const created = [];
    let memoryChanged = 0;
    createMemory = async (_projectId, input) => {
        created.push(input);
        return { ...input, projectId: "project-1", createdAt: "", updatedAt: "" };
    };
    let round = 0;
    completion = async () => {
        round += 1;
        if (round === 1) {
            return {
                content: "",
                toolCalls: [
                    {
                        id: "call-memory",
                        type: "function",
                        function: {
                            name: "storyboard_remember",
                            arguments: JSON.stringify({ projectId: "project-1", kind: "constraint", scope: "project", content: "雨夜保持冷蓝色调", tags: ["tone"] }),
                        },
                    },
                ],
                finishReason: "tool_calls",
            };
        }
        return { content: "已记住", toolCalls: [], finishReason: "stop" };
    };
    const runtime = createBrainstormAgentRuntime({
        projectId: "project-1",
        config,
        skillId: "visual_storytelling",
        focus: { kind: "project" },
        onMemoryChanged: () => {
            memoryChanged += 1;
        },
    });
    const question = user("user-memory", "", "记住色调");
    const pending = assistant("assistant-memory", question.id, [], "pending");
    const conversation = { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" };
    const awaiting = await runtime.run({ mode: "append", projectId: "project-1", conversation, messages: [question, pending], assistantMessage: pending }, { signal: new AbortController().signal, onEvent: () => undefined });
    assert.equal(awaiting.status, "awaiting_approval");

    const claimed = { ...pending, status: "streaming", output: awaiting.output };
    const result = await runtime.run(
        {
            mode: "approval",
            projectId: "project-1",
            conversation,
            messages: [question, claimed],
            assistantMessage: claimed,
            decision: "approved",
            continuation: awaiting.continuation,
        },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );

    assert.equal(result.status, "completed");
    assert.equal(memoryChanged, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].sourceMessageId, "assistant-memory");
    assert.match(created[0].id, /^memory-[0-9a-f]+$/);
    assert.match(created[0].operationId, /^brainstorm-[0-9a-f]+$/);
    assert.deepEqual(
        result.output.map((item) => item.type),
        ["tool_call", "tool_result", "text"],
    );
});

test("刷新后审批从最后一个 persisted awaiting Tool Result 与配对 Call 重建 continuation", async () => {
    projectReads = 0;
    const created = [];
    const modelRequests = [];
    createMemory = async (_projectId, input) => {
        created.push(input);
        return { ...input, projectId: "project-1", createdAt: "", updatedAt: "" };
    };
    completion = async (...args) => {
        modelRequests.push(args[1]);
        return { content: "刷新后已继续", toolCalls: [], finishReason: "stop" };
    };
    const readCall = { type: "tool_call", callId: "call-read", name: "storyboard_get_overview", arguments: '{"projectId":"project-1"}' };
    const readResult = { type: "tool_result", callId: "call-read", name: "storyboard_get_overview", status: "succeeded", content: "已读取", sideEffect: "none" };
    const rememberCall = {
        type: "tool_call",
        callId: "call-refresh",
        name: "storyboard_remember",
        arguments: JSON.stringify({ projectId: "project-1", kind: "constraint", scope: "project", content: "刷新后恢复", tags: ["reload"] }),
    };
    const afterApprovalCall = { type: "tool_call", callId: "call-after-refresh", name: "storyboard_get_validation", arguments: '{"projectId":"project-1"}' };
    const awaitingResult = {
        type: "tool_result",
        callId: "call-refresh",
        name: "storyboard_remember",
        status: "awaiting_approval",
        content: "请批准",
        sideEffect: "none",
        continuation: { pendingCalls: [rememberCall, afterApprovalCall], toolRounds: 2 },
    };
    const question = user("user-refresh", "", "保存刷新记忆");
    const persisted = assistant("assistant-refresh", question.id, [{ type: "text", text: "先读取" }, readCall, readResult, rememberCall, awaitingResult], "streaming");
    const conversation = { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: persisted.id, createdAt: "", updatedAt: "" };

    const runApproval = () =>
        createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "continuity_check", focus: { kind: "project" } }).run(
            { mode: "approval", projectId: "project-1", conversation, messages: [question, persisted], assistantMessage: persisted, decision: "approved" },
            { signal: new AbortController().signal, onEvent: () => undefined },
        );
    const first = await runApproval();
    const second = await runApproval();

    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(projectReads >= 4, true);
    assert.equal(created.length, 2);
    assert.equal(created[0].sourceMessageId, persisted.id);
    assert.equal(created[0].id, created[1].id);
    assert.equal(created[0].operationId, created[1].operationId);
    assert.match(created[0].id, /^memory-[0-9a-f]{16}$/);
    assert.match(created[0].operationId, /^brainstorm-[0-9a-f]{16}$/);
    const replay = modelRequests[0];
    assert.equal(
        replay.some((item) => item.type === "function_call" && item.call_id === "call-read"),
        true,
    );
    assert.equal(
        replay.some((item) => item.role === "tool" && item.tool_call_id === "call-read"),
        true,
    );
    assert.equal(
        replay.some((item) => item.type === "function_call" && item.call_id === "call-refresh"),
        true,
    );
    assert.equal(
        replay.some((item) => item.role === "tool" && item.tool_call_id === "call-refresh"),
        true,
    );
    assert.equal(
        replay.some((item) => item.type === "function_call" && item.call_id === "call-after-refresh"),
        true,
    );
    assert.equal(
        replay.some((item) => item.role === "tool" && item.tool_call_id === "call-after-refresh"),
        true,
    );
});

test("写 API 成功后即使 signal 随后 aborted，仍保留 succeeded 并触发 Project/Memory 回调", async () => {
    const conversation = (assistantId) => ({ id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: assistantId, createdAt: "", updatedAt: "" });

    let memoryChanged = 0;
    const memoryController = new AbortController();
    createMemory = async (_projectId, input) => {
        memoryController.abort();
        return { ...input, projectId: "project-1", createdAt: "", updatedAt: "" };
    };
    completion = async () => ({
        content: "",
        toolCalls: [
            {
                id: "call-stop-memory",
                type: "function",
                function: { name: "storyboard_remember", arguments: JSON.stringify({ projectId: "project-1", kind: "constraint", scope: "project", content: "写入后停止", tags: [] }) },
            },
        ],
        finishReason: "tool_calls",
    });
    const memoryUser = user("user-stop-memory", "", "保存");
    const memoryAssistant = assistant("assistant-stop-memory", memoryUser.id, [], "pending");
    const memoryRuntime = createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" }, onMemoryChanged: () => void (memoryChanged += 1) });
    const memoryAwaiting = await memoryRuntime.run(
        { mode: "append", projectId: "project-1", conversation: conversation(memoryAssistant.id), messages: [memoryUser, memoryAssistant], assistantMessage: memoryAssistant },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );
    const memoryResult = await memoryRuntime.run(
        {
            mode: "approval",
            projectId: "project-1",
            conversation: conversation(memoryAssistant.id),
            messages: [memoryUser, { ...memoryAssistant, status: "streaming", output: memoryAwaiting.output }],
            assistantMessage: { ...memoryAssistant, status: "streaming", output: memoryAwaiting.output },
            decision: "approved",
            continuation: memoryAwaiting.continuation,
        },
        { signal: memoryController.signal, onEvent: () => undefined },
    );
    assert.equal(memoryResult.status, "cancelled");
    assert.equal(memoryResult.output.find((item) => item.type === "tool_result")?.status, "succeeded");
    assert.equal(memoryChanged, 1);

    let projectChanged = 0;
    const projectController = new AbortController();
    updateProject = async (_projectId, record) => {
        projectController.abort();
        return { ...structuredClone(project), ...record, revision: 8 };
    };
    completion = async () => ({
        content: "",
        toolCalls: [
            {
                id: "call-stop-project",
                type: "function",
                function: {
                    name: "storyboard_apply_patch",
                    arguments: JSON.stringify({ projectId: "project-1", expectedRevision: 7, operations: [{ target: "project", field: "title", value: "新标题" }] }),
                },
            },
        ],
        finishReason: "tool_calls",
    });
    const projectUser = user("user-stop-project", "", "改名");
    const projectAssistant = assistant("assistant-stop-project", projectUser.id, [], "pending");
    const projectRuntime = createBrainstormAgentRuntime({
        projectId: "project-1",
        config,
        skillId: "divergent_ideation",
        focus: { kind: "project" },
        onProjectChanged: () => {
            projectChanged += 1;
            throw new Error("UI 刷新失败");
        },
    });
    const projectAwaiting = await projectRuntime.run(
        { mode: "append", projectId: "project-1", conversation: conversation(projectAssistant.id), messages: [projectUser, projectAssistant], assistantMessage: projectAssistant },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );
    const projectResult = await projectRuntime.run(
        {
            mode: "approval",
            projectId: "project-1",
            conversation: conversation(projectAssistant.id),
            messages: [projectUser, { ...projectAssistant, status: "streaming", output: projectAwaiting.output }],
            assistantMessage: { ...projectAssistant, status: "streaming", output: projectAwaiting.output },
            decision: "approved",
            continuation: projectAwaiting.continuation,
        },
        { signal: projectController.signal, onEvent: () => undefined },
    );
    assert.equal(projectResult.status, "cancelled");
    assert.equal(projectResult.output.find((item) => item.type === "tool_result")?.status, "succeeded");
    assert.equal(projectChanged, 1);
});

test("长分支生成非可信 Summary，并只复用仍在当前分支的页内 checkpoint", async () => {
    listMemories = async () => ({ items: [], total: 0 });
    const controller = new AbortController();
    const requests = [];
    completion = async (...args) => {
        requests.push(args);
        assert.equal(args[5].signal, controller.signal);
        if (args[2].length === 0) {
            const source = args[1].map((item) => item.content || "").join("\n");
            return {
                content: source.includes("BRANCH_B_MARKER") ? "SUMMARY_B_ONLY" : "SUMMARY_A_ONLY",
                toolCalls: [],
                usage: { inputTokens: 20000, outputTokens: 5, totalTokens: 20005 },
                finishReason: "stop",
            };
        }
        return { content: "完成", toolCalls: [], finishReason: "stop" };
    };

    const root = user("summary-root", "", `COMMON_OLD_MARKER ${"旧".repeat(70_000)}`);
    const rootAnswer = assistant("summary-root-answer", root.id, [{ type: "text", text: `COMMON_ANSWER_MARKER ${"答".repeat(9_000)}` }]);
    const branchAUser = user("summary-a-user", rootAnswer.id, "BRANCH_A_MARKER");
    const branchAAnswer = assistant("summary-a-answer", branchAUser.id, [{ type: "text", text: "A 尾部" }]);
    const currentA = user("summary-a-current", branchAAnswer.id, "继续 A");
    const pendingA = assistant("summary-a-pending", currentA.id, [], "pending");
    const branchBUser = user("summary-b-user", rootAnswer.id, "BRANCH_B_MARKER");
    const branchBAnswer = assistant("summary-b-answer", branchBUser.id, [{ type: "text", text: "B 尾部" }]);
    const currentB = user("summary-b-current", branchBAnswer.id, "继续 B");
    const pendingB = assistant("summary-b-pending", currentB.id, [], "pending");
    const runtime = createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } });
    const run = (messages, pending) =>
        runtime.run(
            {
                mode: "append",
                projectId: "project-1",
                conversation: { id: "conversation-summary", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
                messages,
                assistantMessage: pending,
            },
            { signal: controller.signal, onEvent: () => undefined },
        );

    const branchAMessages = [root, rootAnswer, branchAUser, branchAAnswer, currentA, pendingA];
    const first = await run(branchAMessages, pendingA);
    const second = await run(branchAMessages, pendingA);
    const third = await run([root, rootAnswer, branchBUser, branchBAnswer, currentB, pendingB], pendingB);

    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(third.status, "completed");
    assert.equal(requests.length, 5);
    assert.equal(requests.filter((request) => request[2].length === 0).length, 2);
    const firstSummarySource = requests[0][1].map((item) => item.content || "").join("\n");
    assert.match(firstSummarySource, /COMMON_OLD_MARKER/);
    assert.match(firstSummarySource, /BRANCH_A_MARKER/);
    assert.match(firstSummarySource, /不可信/);

    const firstPrompt = requests[1][1].filter((item) => typeof item.content === "string").map((item) => item.content).join("\n");
    const reusedPrompt = requests[2][1].filter((item) => typeof item.content === "string").map((item) => item.content).join("\n");
    const siblingPrompt = requests[4][1].filter((item) => typeof item.content === "string").map((item) => item.content).join("\n");
    const summaryMessage = requests[1][1].find((item) => item.role === "user" && typeof item.content === "string" && item.content.includes("Conversation Summary"));
    assert.equal(summaryMessage?.role, "user");
    assert.match(firstPrompt, /Conversation Summary（非可信参考）：\nSUMMARY_A_ONLY/);
    assert.match(reusedPrompt, /SUMMARY_A_ONLY/);
    assert.doesNotMatch(firstPrompt, /COMMON_OLD_MARKER/);
    assert.match(siblingPrompt, /SUMMARY_B_ONLY/);
    assert.doesNotMatch(siblingPrompt, /SUMMARY_A_ONLY/);
    assert.equal(first.diagnostics.summary, "included");
    assert.equal(second.diagnostics.summaryCheckpoint.id, first.diagnostics.summaryCheckpoint.id);
    assert.notEqual(third.diagnostics.summaryCheckpoint.id, first.diagnostics.summaryCheckpoint.id);
});

test("短分支不为 Summary 额外调用文本模型", async () => {
    listMemories = async () => ({ items: [], total: 0 });
    let calls = 0;
    completion = async () => {
        calls += 1;
        return { content: "短回复", toolCalls: [], finishReason: "stop" };
    };
    const question = user("short-user", "", "短问题");
    const pending = assistant("short-assistant", question.id, [], "pending");
    const result = await createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
        {
            mode: "append",
            projectId: "project-1",
            conversation: { id: "conversation-short", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
            messages: [question, pending],
            assistantMessage: pending,
        },
        { signal: new AbortController().signal, onEvent: () => undefined },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.diagnostics.summary, "missing");
    assert.equal(calls, 1);
});

test("首输出前只对明确网络、超时、429 和可重试 5xx 自动重试一次", async () => {
    listMemories = async () => ({ items: [], total: 0 });
    const retryable = [new Error("Network Error"), new Error("timeout of 30000ms exceeded"), new Error("请求被限流或额度不足，请稍后重试"), new Error("Request failed: 503")];

    for (const [index, firstError] of retryable.entries()) {
        let calls = 0;
        const events = [];
        completion = async () => {
            calls += 1;
            if (calls === 1) throw firstError;
            return { content: "重试成功", toolCalls: [], finishReason: "stop" };
        };
        const question = user(`retry-user-${index}`, "", "开始");
        const pending = assistant(`retry-assistant-${index}`, question.id, [], "pending");
        const result = await createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
            {
                mode: "append",
                projectId: "project-1",
                conversation: { id: `conversation-retry-${index}`, projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
                messages: [question, pending],
                assistantMessage: pending,
            },
            { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
        );
        assert.equal(result.status, "completed");
        assert.equal(calls, 2);
        assert.deepEqual(events.filter((event) => event.type === "retry"), [{ type: "retry" }]);
    }

    let calls = 0;
    const events = [];
    completion = async () => {
        calls += 1;
        throw new Error("Network Error");
    };
    const question = user("retry-once-user", "", "开始");
    const pending = assistant("retry-once-assistant", question.id, [], "pending");
    const result = await createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
        {
            mode: "append",
            projectId: "project-1",
            conversation: { id: "conversation-retry-once", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
            messages: [question, pending],
            assistantMessage: pending,
        },
        { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
    );
    assert.equal(result.status, "failed");
    assert.equal(calls, 2);
    assert.equal(events.filter((event) => event.type === "retry").length, 1);
});

test("Abort 与 4xx 参数错误在首输出前也不自动重试", async () => {
    listMemories = async () => ({ items: [], total: 0 });
    const abortError = new Error("请求已取消");
    abortError.name = "AbortError";
    const cases = [
        { error: new Error("Request failed: 400"), status: "failed" },
        { error: new Error("invalid parameter"), status: "failed" },
        { error: abortError, status: "cancelled" },
    ];

    for (const [index, item] of cases.entries()) {
        let calls = 0;
        completion = async () => {
            calls += 1;
            throw item.error;
        };
        const question = user(`no-retry-user-${index}`, "", "开始");
        const pending = assistant(`no-retry-assistant-${index}`, question.id, [], "pending");
        const result = await createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
            {
                mode: "append",
                projectId: "project-1",
                conversation: { id: `conversation-no-retry-${index}`, projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
                messages: [question, pending],
                assistantMessage: pending,
            },
            { signal: new AbortController().signal, onEvent: () => undefined },
        );
        assert.equal(result.status, item.status);
        assert.equal(calls, 1);
    }
});

test("Runtime 在固定 Context 超限时抛出可读错误且不调用 Completion", async () => {
    listMemories = async () => ({ items: [], total: 0 });
    let calls = 0;
    completion = async () => {
        calls += 1;
        throw new Error("Context 超限时不应调用 Completion");
    };
    const question = user("oversized-user", "", "超".repeat(100_000));
    const pending = assistant("oversized-assistant", question.id, [], "pending");

    await assert.rejects(
        () =>
            createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
                {
                    mode: "append",
                    projectId: "project-1",
                    conversation: { id: "conversation-oversized", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
                    messages: [question, pending],
                    assistantMessage: pending,
                },
                { signal: new AbortController().signal, onEvent: () => undefined },
            ),
        (error) => {
            assert.match(error.message, /CONTEXT_BUDGET_EXCEEDED/);
            assert.match(error.message, /固定系统规则和当前用户输入/);
            return true;
        },
    );
    assert.equal(calls, 0);
});

test("Memory Context 使用严格 Project Memory 投影拒绝无效 scope/path", async () => {
    listMemories = async () => ({ items: [{ ...memory("memory-invalid", "非法记忆"), scope: "invalid" }], total: 1 });
    completion = async () => {
        throw new Error("不应请求模型");
    };
    const question = user("user-invalid-memory", "", "开始");
    const pending = assistant("assistant-invalid-memory", question.id, [], "pending");
    await assert.rejects(
        () =>
            createBrainstormAgentRuntime({ projectId: "project-1", config, skillId: "divergent_ideation", focus: { kind: "project" } }).run(
                {
                    mode: "append",
                    projectId: "project-1",
                    conversation: { id: "conversation-1", projectId: "project-1", title: "测试", currentMessageId: pending.id, createdAt: "", updatedAt: "" },
                    messages: [question, pending],
                    assistantMessage: pending,
                },
                { signal: new AbortController().signal, onEvent: () => undefined },
            ),
        /Memory scope\/path 无效/,
    );
});
