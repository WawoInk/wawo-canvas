import { requestToolResponse, type ModelStreamEvent, type ResponseFunctionTool, type ResponseInputMessage } from "@/services/api/image";
import { createStoryboardMemory, deleteStoryboardMemory, fetchStoryboardMemories } from "@/services/api/storyboard-brainstorm";
import { fetchStoryboardRecord, updateStoryboardRecord } from "@/services/api/storyboards";
import type { AiConfig } from "@/stores/use-config-store";

import { buildBrainstormContext } from "./brainstorm-agent-context";
import { projectBrainstormMemories } from "./brainstorm-agent-memory";
import { resumeBrainstormTurn, runBrainstormTurn } from "./brainstorm-agent-runner";
import { createStoryboardToolRuntime } from "./brainstorm-agent-tools";
import type { BrainstormComplete, BrainstormContextResult, BrainstormFocus, BrainstormModelMessage, BrainstormOutputItem, BrainstormSkillId, BrainstormToolCall, BrainstormTurnContinuation } from "./brainstorm-agent";
import type { BrainstormAgentMessage, BrainstormAgentRuntime, BrainstormAgentRuntimeInput, BrainstormAgentUserMessage } from "./use-brainstorm-agent";

const PAGE_SIZE = 500;
const BUDGET = { contextWindowTokens: 32000, outputReserveTokens: 4000 };

type RuntimeOptions = {
    projectId: string;
    config: AiConfig;
    skillId: BrainstormSkillId;
    focus: BrainstormFocus;
    onProjectChanged?: () => void;
    onMemoryChanged?: () => void;
};

function abort(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
}

function notify(callback?: () => void) {
    try {
        callback?.();
    } catch {
        // 写入已成功，UI 刷新回调不能把成功结果改写为失败。
    }
}

function stableFingerprint(value: string) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (const byte of new TextEncoder().encode(value)) {
        left = Math.imul(left ^ byte, 0x01000193);
        right = Math.imul(right ^ byte, 0x85ebca6b);
    }
    return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

async function allMemories(projectId: string, signal?: AbortSignal) {
    abort(signal);
    const first = await fetchStoryboardMemories(projectId, { page: 1, pageSize: PAGE_SIZE });
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
        abort(signal);
        const next = await fetchStoryboardMemories(projectId, { page, pageSize: PAGE_SIZE });
        if (!next.items.length) break;
        items.push(...next.items);
    }
    abort(signal);
    return items;
}

function branch(messages: BrainstormAgentMessage[], messageId: string) {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const result: BrainstormAgentMessage[] = [];
    const seen = new Set<string>();
    let current = byId.get(messageId);
    while (current) {
        if (seen.has(current.id)) throw new Error("脑暴消息分支存在循环引用");
        seen.add(current.id);
        result.unshift(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId);
        if (!current) throw new Error("脑暴消息分支缺少父消息");
    }
    if (!result.length) throw new Error("未找到当前脑暴消息分支");
    return result;
}

function contextMessages(input: BrainstormAgentRuntimeInput) {
    if (input.mode === "continue") {
        const priorMessages = branch(input.messages, input.assistantMessage.id);
        const currentUserMessage: BrainstormAgentUserMessage = {
            id: `${input.assistantMessage.id}:continue`,
            projectId: input.projectId,
            conversationId: input.conversation.id,
            parentId: input.assistantMessage.id,
            role: "user",
            content: "继续上一条回复",
            output: [],
            revision: input.assistantMessage.revision,
            createdAt: input.assistantMessage.updatedAt,
            updatedAt: input.assistantMessage.updatedAt,
        };
        return { priorMessages, currentUserMessage };
    }
    const currentUserMessage = input.messages.find((message): message is BrainstormAgentUserMessage => message.id === input.assistantMessage.parentId && message.role === "user");
    if (!currentUserMessage) throw new Error("未找到当前回复对应的父级用户消息");
    return { priorMessages: branch(input.messages, currentUserMessage.id), currentUserMessage };
}

function responseMessage(message: BrainstormModelMessage): ResponseInputMessage {
    if (message.type === "message") return { role: message.role, content: message.content };
    if (message.type === "tool_call") return { type: "function_call", call_id: message.callId, name: message.name, arguments: message.arguments, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) };
    return { role: "tool", tool_call_id: message.callId, content: message.content };
}

function responseTool(tool: { name: string; description: string; parameters: Record<string, unknown> }): ResponseFunctionTool {
    return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true } };
}

function complete(config: AiConfig): BrainstormComplete {
    return async (request, options) => {
        const result = await requestToolResponse({ ...config, model: config.textModel || config.model, systemPrompt: "" }, request.messages.map(responseMessage), request.tools.map(responseTool), "auto", undefined, {
            signal: options.signal,
            includeUsage: true,
            onEvent: (event: ModelStreamEvent) => {
                if (event.type === "text_delta") options.onEvent({ type: "text_delta", delta: event.delta });
                else if (event.type === "tool_call_delta") options.onEvent({ type: "tool_call_delta", ...(event.id ? { callId: event.id } : {}), ...(event.name ? { name: event.name } : {}), argumentsDelta: event.argumentsDelta });
                else if (event.type === "usage") options.onEvent({ type: "usage", usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens } });
            },
        });
        return {
            content: result.content,
            toolCalls: result.toolCalls.map(
                (call): BrainstormToolCall => ({
                    type: "tool_call",
                    callId: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                    ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
                }),
            ),
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        };
    };
}

function outputMessages(output: BrainstormOutputItem[]): BrainstormModelMessage[] {
    return output.flatMap((item) => (item.type === "text" ? [{ type: "message" as const, role: "assistant" as const, content: item.text }] : item.type === "tool_result" && item.status === "awaiting_approval" ? [] : [item]));
}

function persistedContinuation(context: BrainstormContextResult, output: BrainstormOutputItem[]): BrainstormTurnContinuation {
    const awaitingIndex = output.findLastIndex((item) => item.type === "tool_result" && item.status === "awaiting_approval");
    if (awaitingIndex < 0) throw new Error("未找到已持久化的待审批工具结果");
    const awaiting = output[awaitingIndex];
    if (awaiting.type !== "tool_result") throw new Error("待审批工具结果无效");
    const callIndex = output.findLastIndex((item, index) => index < awaitingIndex && item.type === "tool_call" && item.callId === awaiting.callId && item.name === awaiting.name);
    if (callIndex < 0) throw new Error("未找到待审批工具结果对应的 Tool Call");
    const call = output[callIndex];
    if (call.type !== "tool_call") throw new Error("待审批 Tool Call 无效");
    const pendingCalls = awaiting.continuation?.pendingCalls?.length ? awaiting.continuation.pendingCalls : [call];
    if (pendingCalls[0]?.callId !== call.callId || pendingCalls[0]?.name !== call.name) throw new Error("待审批 continuation 与 Tool Call 不一致");
    return {
        context,
        messages: [...context.messages, ...outputMessages(output.slice(0, callIndex))],
        output: [...output],
        pendingCalls,
        toolRounds: Math.max(1, Math.floor(awaiting.continuation?.toolRounds || 1)),
    };
}

export function createBrainstormAgentRuntime(options: RuntimeOptions): BrainstormAgentRuntime {
    const projectId = options.projectId.trim();
    if (!projectId) throw new Error("脑暴 Runtime 缺少 Storyboard Project ID");
    return {
        async run(input, runOptions) {
            if (input.projectId !== projectId || input.conversation.projectId !== projectId) throw new Error("脑暴 Runtime 的项目范围不一致");
            abort(runOptions.signal);
            const [storyboard, memories] = await Promise.all([fetchStoryboardRecord(projectId), allMemories(projectId, runOptions.signal)]);
            abort(runOptions.signal);
            const tools = createStoryboardToolRuntime({
                projectId,
                memoryIdentity: (call) => {
                    const value = stableFingerprint(`${input.assistantMessage.id}\u0000${call.callId}`);
                    return { id: `memory-${value}`, operationId: `brainstorm-${value}`, sourceMessageId: input.assistantMessage.id };
                },
                services: {
                    fetchProject: async (_id, signal) => {
                        abort(signal);
                        const value = await fetchStoryboardRecord(projectId);
                        abort(signal);
                        return value;
                    },
                    updateProject: async (_id, record, expectedRevision, signal) => {
                        abort(signal);
                        const value = await updateStoryboardRecord(projectId, record, expectedRevision);
                        notify(options.onProjectChanged);
                        return value;
                    },
                    listMemories: async (_id, page = 1, pageSize = 100, signal) => {
                        abort(signal);
                        const value = await fetchStoryboardMemories(projectId, { page, pageSize });
                        abort(signal);
                        return value;
                    },
                    createMemory: async (_id, memory, signal) => {
                        abort(signal);
                        const value = await createStoryboardMemory(projectId, memory);
                        notify(options.onMemoryChanged);
                        return value;
                    },
                    deleteMemory: async (_id, memoryId, signal) => {
                        abort(signal);
                        const value = await deleteStoryboardMemory(projectId, memoryId);
                        notify(options.onMemoryChanged);
                        return value;
                    },
                },
            });
            const current = contextMessages(input);
            const context = buildBrainstormContext({
                skillId: options.skillId,
                storyboard,
                focus: options.focus,
                priorMessages: current.priorMessages,
                currentUserMessage: current.currentUserMessage,
                memories: projectBrainstormMemories(memories),
                tools: [...tools.tools],
                budget: BUDGET,
            });
            const dependencies = { complete: complete(options.config), executeTool: tools.executeTool, preflightTool: tools.preflightTool };
            if (input.mode !== "approval") return runBrainstormTurn(context, dependencies, runOptions);
            if (!input.decision) throw new Error("脑暴审批缺少用户决定");
            return resumeBrainstormTurn(input.continuation || persistedContinuation(context, input.assistantMessage.output), input.decision, dependencies, runOptions);
        },
    };
}
