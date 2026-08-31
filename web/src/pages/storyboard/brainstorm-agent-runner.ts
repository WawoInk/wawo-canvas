import type {
    BrainstormCompletionResult,
    BrainstormContextResult,
    BrainstormModelMessage,
    BrainstormOutputItem,
    BrainstormTokenUsage,
    BrainstormToolResult,
    BrainstormTurnDependencies,
    BrainstormTurnOptions,
    BrainstormTurnResult,
} from "./brainstorm-agent";

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
    return signal?.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function runBrainstormTurn(
    context: BrainstormContextResult,
    dependencies: BrainstormTurnDependencies,
    options: BrainstormTurnOptions = {},
): Promise<BrainstormTurnResult> {
    const messages: BrainstormModelMessage[] = [...context.messages];
    const output: BrainstormOutputItem[] = [];
    let toolRounds = 0;
    let usage: BrainstormTokenUsage | undefined;
    let producedOutput = false;
    let wrote = false;
    let retried = false;
    const append = (item: BrainstormOutputItem) => {
        producedOutput = true;
        output.push(item);
        options.onEvent?.({ type: "output_item", item });
    };
    const base = () => ({
        content: output.filter((item) => item.type === "text").map((item) => item.text).join(""),
        output,
        diagnostics: context.diagnostics,
        toolRounds,
        ...(usage ? { usage } : {}),
    });

    options.onEvent?.({ type: "status", status: "streaming" });
    while (true) {
        let completion: BrainstormCompletionResult | undefined;
        let streamed = "";
        while (!completion) {
            streamed = "";
            let eventUsage: BrainstormTokenUsage | undefined;
            try {
                if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
                completion = await dependencies.complete(
                    { messages: [...messages], tools: context.tools },
                    {
                        signal: options.signal,
                        onEvent: (event) => {
                            if (event.type === "text_delta") {
                                producedOutput = true;
                                streamed += event.delta;
                                options.onEvent?.(event);
                            } else if (event.type === "tool_call_delta") {
                                producedOutput = true;
                            } else {
                                eventUsage = event.usage;
                            }
                        },
                    },
                );
                usage = addUsage(usage, completion.usage || eventUsage);
            } catch (error) {
                if (streamed) append({ type: "text", text: streamed });
                if (isAborted(error, options.signal)) {
                    options.onEvent?.({ type: "status", status: "cancelled" });
                    return { status: "cancelled", error: { code: "ABORTED", message: "Brainstorm turn was cancelled." }, ...base() };
                }
                if (!retried && !producedOutput && !wrote && dependencies.isRetryableCompletionError?.(error)) {
                    retried = true;
                    options.onEvent?.({ type: "retry" });
                    continue;
                }
                options.onEvent?.({ type: "status", status: "failed" });
                return { status: "failed", error: { code: "COMPLETION_FAILED", message: errorMessage(error, "Brainstorm completion failed.") }, ...base() };
            }
        }

        const roundContent = completion.content || streamed;
        if (roundContent) {
            append({ type: "text", text: roundContent });
            messages.push({ type: "message", role: "assistant", content: roundContent });
        }
        if (!completion.toolCalls.length) {
            options.onEvent?.({ type: "status", status: "completed" });
            return { status: "completed", ...base() };
        }

        toolRounds += 1;
        let stopped = false;
        for (const call of completion.toolCalls) {
            append(call);
            const definition = context.tools.find((tool) => tool.name === call.name);
            if (definition?.approval === "required") {
                append({ type: "tool_result", callId: call.callId, name: call.name, status: "awaiting_approval", content: "Tool requires approval before execution.", sideEffect: definition.risk === "write" ? "write" : "none" });
                options.onEvent?.({ type: "status", status: "awaiting_approval" });
                return { status: "awaiting_approval", call, ...base() };
            }
            const execution = stopped
                ? { status: "skipped" as const, content: "Skipped because a previous tool call failed." }
                : await dependencies.executeTool(call, { signal: options.signal, definition });
            const result: BrainstormToolResult = { type: "tool_result", callId: call.callId, name: call.name, ...execution };
            wrote ||= execution.sideEffect === "write";
            append(result);
            messages.push(call, result);
            stopped ||= execution.status !== "succeeded";
        }
        if (toolRounds === 4) {
            options.onEvent?.({ type: "status", status: "failed" });
            return { status: "failed", error: { code: "TOOL_ROUND_LIMIT", message: "Brainstorm tool loop reached the maximum of 4 rounds." }, ...base() };
        }
    }
}
