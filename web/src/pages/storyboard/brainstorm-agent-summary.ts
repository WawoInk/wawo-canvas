import type { BrainstormAssistantMessage, BrainstormMessage, BrainstormSummaryCheckpoint } from "./brainstorm-agent";
import { estimateBrainstormTextTokens, estimateBrainstormValueTokens } from "./brainstorm-agent-context.ts";

export type BrainstormSummaryPlanInput = {
    messages: BrainstormMessage[];
    previous?: BrainstormSummaryCheckpoint;
    triggerTokens: number;
    retainTokens: number;
    model: string;
};

export type BrainstormSummaryPlan = {
    previousSummary?: string;
    messages: BrainstormMessage[];
    retainedMessageIds: string[];
    fromMessageId: string;
    throughMessageId: string;
    coveredMessageCount: number;
    sourceTokenCount: number;
    estimatedInputTokens: number;
    model: string;
};

export type BrainstormSummaryCompletion = { id: string; content: string; tokenCount?: number; model?: string };

function messageTokens(message: BrainstormMessage): number {
    if (message.role === "user") return estimateBrainstormTextTokens(message.content);
    const usage = message.usage?.outputTokens;
    const hasToolResult = message.output.some((item) => item.type === "tool_result");
    return typeof usage === "number" && Number.isFinite(usage) && usage > 0 && !hasToolResult ? Math.ceil(usage) : estimateBrainstormValueTokens(message.output);
}

function splitToolPair(messages: BrainstormMessage[], boundary: number): boolean {
    const positions = new Map<string, number[]>();
    messages.forEach((message, index) => {
        if (message.role !== "assistant") return;
        message.output.forEach((item) => {
            if (item.type === "tool_call" || item.type === "tool_result") positions.set(item.callId, [...(positions.get(item.callId) ?? []), index]);
        });
    });
    return [...positions.values()].some((indexes) => Math.min(...indexes) <= boundary && Math.max(...indexes) > boundary);
}

export function planBrainstormSummaryCheckpoint(input: BrainstormSummaryPlanInput): BrainstormSummaryPlan | null {
    const previousIndex = input.previous ? input.messages.findIndex((message) => message.id === input.previous?.throughMessageId && message.role === "user") : -1;
    const previous = previousIndex >= 0 ? input.previous : undefined;
    const start = previous ? previousIndex + 1 : 0;
    const previousTokenCount = previous ? (typeof previous.tokenCount === "number" && previous.tokenCount > 0 ? Math.ceil(previous.tokenCount) : estimateBrainstormTextTokens(previous.content)) : 0;
    const unsummarizedTokens = input.messages.slice(start).reduce((total, message) => total + messageTokens(message), 0);
    if (previousTokenCount + unsummarizedTokens < Math.max(0, Math.floor(input.triggerTokens))) return null;

    const retainTokens = Math.max(0, Math.floor(input.retainTokens));
    const boundaries = input.messages.map((message, index) => ({ message, index })).filter(({ message, index }) => index >= start && message.role === "user" && !splitToolPair(input.messages, index));
    if (!boundaries.length) return null;
    const selected = boundaries.find(({ index }) => input.messages.slice(index + 1).reduce((total, message) => total + messageTokens(message), 0) <= retainTokens) ?? boundaries.at(-1)!;
    const source = input.messages.slice(start, selected.index + 1);
    if (!source.length) return null;

    const sourceTokens = source.reduce((total, message) => total + messageTokens(message), 0);
    return {
        ...(previous ? { previousSummary: previous.content } : {}),
        messages: source,
        retainedMessageIds: input.messages.slice(selected.index + 1).map((message) => message.id),
        fromMessageId: previous?.fromMessageId ?? input.messages[0].id,
        throughMessageId: selected.message.id,
        coveredMessageCount: (previous?.coveredMessageCount ?? previousIndex + 1) + source.length,
        sourceTokenCount: (previous?.sourceTokenCount ?? (previous ? input.messages.slice(0, start).reduce((total, message) => total + messageTokens(message), 0) : 0)) + sourceTokens,
        estimatedInputTokens: previousTokenCount + sourceTokens,
        model: input.model,
    };
}

export function mergeBrainstormSummaryCheckpoint(plan: BrainstormSummaryPlan, completion: BrainstormSummaryCompletion): BrainstormSummaryCheckpoint {
    const content = completion.content.trim();
    if (!content) throw new Error("Summary 内容为空");
    return {
        id: completion.id,
        fromMessageId: plan.fromMessageId,
        throughMessageId: plan.throughMessageId,
        content,
        tokenCount: typeof completion.tokenCount === "number" && Number.isFinite(completion.tokenCount) && completion.tokenCount > 0 ? Math.ceil(completion.tokenCount) : estimateBrainstormTextTokens(content),
        sourceTokenCount: plan.sourceTokenCount,
        coveredMessageCount: plan.coveredMessageCount,
        model: completion.model ?? plan.model,
    };
}
