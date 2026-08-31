import type {
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

export async function runBrainstormTurn(
    context: BrainstormContextResult,
    dependencies: BrainstormTurnDependencies,
    options: BrainstormTurnOptions = {},
): Promise<BrainstormTurnResult> {
    const messages: BrainstormModelMessage[] = [...context.messages];
    const output: BrainstormOutputItem[] = [];
    let toolRounds = 0;
    let usage: BrainstormTokenUsage | undefined;
    const append = (item: BrainstormOutputItem) => {
        output.push(item);
        options.onEvent?.({ type: "output_item", item });
    };

    options.onEvent?.({ type: "status", status: "streaming" });
    while (true) {
        let streamed = "";
        const completion = await dependencies.complete(
            { messages: [...messages], tools: context.tools },
            {
                signal: options.signal,
                onEvent: (event) => {
                    if (event.type !== "text_delta") return;
                    streamed += event.delta;
                    options.onEvent?.(event);
                },
            },
        );
        usage = addUsage(usage, completion.usage);
        const roundContent = completion.content || streamed;
        if (roundContent) {
            append({ type: "text", text: roundContent });
            messages.push({ type: "message", role: "assistant", content: roundContent });
        }
        if (!completion.toolCalls.length) {
            options.onEvent?.({ type: "status", status: "completed" });
            return { status: "completed", content: output.filter((item) => item.type === "text").map((item) => item.text).join(""), output, diagnostics: context.diagnostics, toolRounds, usage };
        }

        toolRounds += 1;
        for (const call of completion.toolCalls) {
            append(call);
            const execution = await dependencies.executeTool(call, { signal: options.signal, definition: context.tools.find((tool) => tool.name === call.name) });
            const result: BrainstormToolResult = { type: "tool_result", callId: call.callId, name: call.name, ...execution };
            append(result);
            messages.push(call, result);
        }
    }
}
