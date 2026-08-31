import type { BrainstormAssistantMessage, BrainstormMessage, BrainstormSummaryCheckpoint } from "./brainstorm-agent";
import { estimateBrainstormTextTokens, estimateBrainstormValueTokens, isBrainstormSummaryBoundary } from "./brainstorm-agent-context.ts";

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

export function planBrainstormSummaryCheckpoint(input: BrainstormSummaryPlanInput): BrainstormSummaryPlan | null {
    const previousBoundaryIndex = input.previous ? input.messages.findIndex((message) => message.id === input.previous?.throughMessageId) : -1;
    const detachedPreviousValid =
        previousBoundaryIndex < 0 &&
        Boolean(input.previous?.fromMessageId && input.previous.model) &&
        typeof input.previous?.coveredMessageCount === "number" &&
        input.previous.coveredMessageCount > 0 &&
        typeof input.previous.sourceTokenCount === "number" &&
        input.previous.sourceTokenCount >= 0;
    const previous = input.previous?.content.trim() && (detachedPreviousValid || isBrainstormSummaryBoundary(input.messages, previousBoundaryIndex)) ? input.previous : undefined;
    const previousIndex = previous && previousBoundaryIndex >= 0 ? previousBoundaryIndex : -1;
    const start = previousIndex + 1;
    const previousTokenCount = previous ? (typeof previous.tokenCount === "number" && previous.tokenCount > 0 ? Math.ceil(previous.tokenCount) : estimateBrainstormTextTokens(previous.content)) : 0;
    const unsummarizedTokens = input.messages.slice(start).reduce((total, message) => total + messageTokens(message), 0);
    if (previousTokenCount + unsummarizedTokens < Math.max(0, Math.floor(input.triggerTokens))) return null;

    const retainTokens = Math.max(0, Math.floor(input.retainTokens));
    const boundaries = input.messages.map((message, index) => ({ message, index })).filter(({ index }) => index >= start && isBrainstormSummaryBoundary(input.messages, index));
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
        coveredMessageCount: (previous?.coveredMessageCount ?? (previousIndex >= 0 ? previousIndex + 1 : 0)) + source.length,
        sourceTokenCount: (previous?.sourceTokenCount ?? (previousIndex >= 0 ? input.messages.slice(0, start).reduce((total, message) => total + messageTokens(message), 0) : 0)) + sourceTokens,
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
