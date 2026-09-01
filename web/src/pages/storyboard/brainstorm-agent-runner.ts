import type {
    BrainstormCompletionResult,
    BrainstormContextResult,
    BrainstormModelMessage,
    BrainstormModelSnapshot,
    BrainstormOutputItem,
    BrainstormTokenUsage,
    BrainstormToolApprovalDecision,
    BrainstormToolCall,
    BrainstormToolResult,
    BrainstormTurnContinuation,
    BrainstormTurnDependencies,
    BrainstormTurnOptions,
    BrainstormTurnResult,
} from "./brainstorm-agent";

type TurnState = {
    context: BrainstormContextResult;
    messages: BrainstormModelMessage[];
    output: BrainstormOutputItem[];
    toolRounds: number;
    usage?: BrainstormTokenUsage;
    modelSnapshot?: BrainstormModelSnapshot;
    producedOutput: boolean;
    wrote: boolean;
    retried: boolean;
};

type ToolOutcome = Pick<BrainstormToolResult, "status" | "content" | "sideEffect">;

function addUsage(total: BrainstormTokenUsage | undefined, usage: BrainstormTokenUsage | undefined) {
    if (!usage) return total;
    const next: BrainstormTokenUsage = {};
    for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
        if (total?.[key] !== undefined || usage[key] !== undefined) next[key] = (total?.[key] || 0) + (usage[key] || 0);
    }
    return next;
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function isAborted(error: unknown, signal?: AbortSignal) {
    return signal?.aborted || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

function append(state: TurnState, item: BrainstormOutputItem, options: BrainstormTurnOptions) {
    state.producedOutput = true;
    state.output.push(item);
    options.onEvent?.({ type: "output_item", item });
}

function base(state: TurnState) {
    return {
        content: state.output
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join(""),
        output: state.output,
        diagnostics: state.context.diagnostics,
        toolRounds: state.toolRounds,
        ...(state.usage ? { usage: state.usage } : {}),
    };
}

function continuation(state: TurnState, pendingCalls: BrainstormToolCall[]): BrainstormTurnContinuation {
    return {
        context: state.context,
        messages: [...state.messages],
        output: [...state.output],
        pendingCalls: [...pendingCalls],
        toolRounds: state.toolRounds,
        ...(state.usage ? { usage: state.usage } : {}),
        ...(state.modelSnapshot ? { modelSnapshot: state.modelSnapshot } : {}),
    };
}

function pauseForApproval(state: TurnState, call: BrainstormToolCall, pendingCalls: BrainstormToolCall[], content: string, options: BrainstormTurnOptions): BrainstormTurnResult {
    append(
        state,
        {
            type: "tool_result",
            callId: call.callId,
            name: call.name,
            status: "awaiting_approval",
            content,
            sideEffect: "none",
            continuation: { pendingCalls: [...pendingCalls], toolRounds: state.toolRounds, ...(state.modelSnapshot ? { modelSnapshot: state.modelSnapshot } : {}) },
        },
        options,
    );
    options.onEvent?.({ type: "status", status: "awaiting_approval" });
    return { status: "awaiting_approval", call, continuation: continuation(state, pendingCalls), ...base(state) };
}

function appendCancelledRemainder(state: TurnState, calls: BrainstormToolCall[], options: BrainstormTurnOptions) {
    for (const call of calls) {
        append(state, call, options);
        const result: BrainstormToolResult = { type: "tool_result", callId: call.callId, name: call.name, status: "skipped", content: "Skipped because the turn was cancelled." };
        append(state, result, options);
        state.messages.push(call, result);
    }
}

async function executeCalls(
    state: TurnState,
    calls: BrainstormToolCall[],
    dependencies: BrainstormTurnDependencies,
    options: BrainstormTurnOptions,
    resume?: { decision: BrainstormToolApprovalDecision; firstCallAlreadyOutput: true },
): Promise<BrainstormTurnResult | null> {
    let stopped = false;
    for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        if (!(resume?.firstCallAlreadyOutput && index === 0)) append(state, call, options);
        const definition = state.context.tools.find((tool) => tool.name === call.name);
        if (options.signal?.aborted) {
            const result: BrainstormToolResult = { type: "tool_result", callId: call.callId, name: call.name, status: "failed", content: "Brainstorm turn was cancelled." };
            append(state, result, options);
            state.messages.push(call, result);
            appendCancelledRemainder(state, calls.slice(index + 1), options);
            options.onEvent?.({ type: "status", status: "cancelled" });
            return { status: "cancelled", error: { code: "ABORTED", message: "Brainstorm turn was cancelled." }, ...base(state) };
        }
        if (!stopped && definition?.approval === "required" && !(resume && index === 0)) {
            let content = "Tool requires approval before execution.";
            if (dependencies.preflightTool) {
                let preflight: ToolOutcome;
                let cancelled = false;
                try {
                    preflight = await dependencies.preflightTool(call, { signal: options.signal, definition });
                } catch (error) {
                    cancelled = isAborted(error, options.signal);
                    preflight = { status: "failed", content: cancelled ? "Brainstorm turn was cancelled." : errorMessage(error, "Tool preflight failed."), sideEffect: "none" };
                }
                if (preflight.status !== "succeeded" || preflight.sideEffect === "write") {
                    const result: BrainstormToolResult = {
                        type: "tool_result",
                        callId: call.callId,
                        name: call.name,
                        status: preflight.status === "rejected" ? "rejected" : "failed",
                        content: preflight.content,
                        sideEffect: "none",
                    };
                    append(state, result, options);
                    state.messages.push(call, result);
                    if (cancelled) {
                        appendCancelledRemainder(state, calls.slice(index + 1), options);
                        options.onEvent?.({ type: "status", status: "cancelled" });
                        return { status: "cancelled", error: { code: "ABORTED", message: "Brainstorm turn was cancelled." }, ...base(state) };
                    }
                    stopped = true;
                    continue;
                }
                content = preflight.content;
            }
            return pauseForApproval(state, call, calls.slice(index), content, options);
        }

        let execution: ToolOutcome;
        let cancelled = false;
        if (stopped) {
            execution = { status: "skipped", content: "Skipped because a previous tool call failed." };
        } else if (!definition) {
            execution = { status: "failed", content: "Tool is not registered." };
        } else if (resume?.decision === "rejected" && index === 0) {
            execution = { status: "rejected", content: "Tool execution was rejected by the user.", sideEffect: "none" };
        } else {
            try {
                execution = await dependencies.executeTool(call, {
                    signal: options.signal,
                    definition,
                    authorization: resume?.decision === "approved" && index === 0 ? "approved" : "auto",
                });
            } catch (error) {
                cancelled = isAborted(error, options.signal);
                execution = { status: "failed", content: cancelled ? "Brainstorm turn was cancelled." : errorMessage(error, "Tool execution failed.") };
            }
        }
        if (execution.status === "awaiting_approval") {
            return pauseForApproval(state, call, calls.slice(index), execution.content, options);
        }

        const result: BrainstormToolResult = { type: "tool_result", callId: call.callId, name: call.name, ...execution };
        state.wrote ||= execution.sideEffect === "write";
        append(state, result, options);
        state.messages.push(call, result);
        if (cancelled) {
            appendCancelledRemainder(state, calls.slice(index + 1), options);
            options.onEvent?.({ type: "status", status: "cancelled" });
            return { status: "cancelled", error: { code: "ABORTED", message: "Brainstorm turn was cancelled." }, ...base(state) };
        }
        stopped ||= execution.status !== "succeeded";
    }
    return null;
}

async function continueTurn(state: TurnState, dependencies: BrainstormTurnDependencies, options: BrainstormTurnOptions): Promise<BrainstormTurnResult> {
    while (true) {
        let completion: BrainstormCompletionResult | undefined;
        let streamed = "";
        while (!completion) {
            streamed = "";
            let eventUsage: BrainstormTokenUsage | undefined;
            try {
                if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
                completion = await dependencies.complete(
                    { messages: [...state.messages], tools: state.context.tools },
                    {
                        signal: options.signal,
                        onEvent: (event) => {
                            if (event.type === "text_delta") {
                                state.producedOutput = true;
                                streamed += event.delta;
                                options.onEvent?.(event);
                            } else if (event.type === "tool_call_delta") {
                                state.producedOutput = true;
                            } else {
                                eventUsage = event.usage;
                            }
                        },
                    },
                );
                state.usage = addUsage(state.usage, completion.usage || eventUsage);
            } catch (error) {
                if (streamed) append(state, { type: "text", text: streamed }, options);
                if (isAborted(error, options.signal)) {
                    options.onEvent?.({ type: "status", status: "cancelled" });
                    return { status: "cancelled", error: { code: "ABORTED", message: "Brainstorm turn was cancelled." }, ...base(state) };
                }
                if (!state.retried && !state.producedOutput && !state.wrote && dependencies.isRetryableCompletionError?.(error)) {
                    state.retried = true;
                    options.onEvent?.({ type: "retry" });
                    continue;
                }
                options.onEvent?.({ type: "status", status: "failed" });
                return { status: "failed", error: { code: "COMPLETION_FAILED", message: errorMessage(error, "Brainstorm completion failed.") }, ...base(state) };
            }
        }

        const roundContent = completion.content || streamed;
        if (roundContent) {
            append(state, { type: "text", text: roundContent }, options);
            state.messages.push({ type: "message", role: "assistant", content: roundContent });
        }
        if (!completion.toolCalls.length) {
            options.onEvent?.({ type: "status", status: "completed" });
            return { status: "completed", ...base(state) };
        }

        state.toolRounds += 1;
        const result = await executeCalls(state, completion.toolCalls, dependencies, options);
        if (result) return result;
        if (state.toolRounds === 4) {
            options.onEvent?.({ type: "status", status: "failed" });
            return { status: "failed", error: { code: "TOOL_ROUND_LIMIT", message: "Brainstorm tool loop reached the maximum of 4 rounds." }, ...base(state) };
        }
    }
}

export function runBrainstormTurn(context: BrainstormContextResult, dependencies: BrainstormTurnDependencies, options: BrainstormTurnOptions = {}): Promise<BrainstormTurnResult> {
    options.onEvent?.({ type: "status", status: "streaming" });
    return continueTurn({ context, messages: [...context.messages], output: [], toolRounds: 0, modelSnapshot: options.modelSnapshot, producedOutput: false, wrote: false, retried: false }, dependencies, options);
}

export async function resumeBrainstormTurn(pending: BrainstormTurnContinuation, decision: BrainstormToolApprovalDecision, dependencies: BrainstormTurnDependencies, options: BrainstormTurnOptions = {}): Promise<BrainstormTurnResult> {
    const call = pending.pendingCalls[0];
    if (!call) throw new Error("Brainstorm continuation has no pending tool call.");
    const output = [...pending.output];
    const awaitingIndex = output.findLastIndex((item) => item.type === "tool_result" && item.callId === call.callId && item.status === "awaiting_approval");
    if (awaitingIndex >= 0) output.splice(awaitingIndex, 1);
    const state: TurnState = {
        context: pending.context,
        messages: [...pending.messages],
        output,
        toolRounds: pending.toolRounds,
        usage: pending.usage,
        modelSnapshot: pending.modelSnapshot,
        producedOutput: true,
        wrote: false,
        retried: true,
    };

    options.onEvent?.({ type: "status", status: "streaming" });
    const result = await executeCalls(state, pending.pendingCalls, dependencies, options, { decision, firstCallAlreadyOutput: true });
    if (result) return result;
    if (state.toolRounds === 4) {
        options.onEvent?.({ type: "status", status: "failed" });
        return { status: "failed", error: { code: "TOOL_ROUND_LIMIT", message: "Brainstorm tool loop reached the maximum of 4 rounds." }, ...base(state) };
    }
    return continueTurn(state, dependencies, options);
}
