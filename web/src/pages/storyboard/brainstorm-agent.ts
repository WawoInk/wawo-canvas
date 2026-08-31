import type { StoryboardRecord } from "./storyboard";

export type BrainstormAssistantStatus = "pending" | "streaming" | "awaiting_approval" | "completed" | "failed" | "cancelled" | "interrupted";
export type BrainstormErrorCode = "CONTEXT_BUDGET_EXCEEDED" | "TOOL_ROUND_LIMIT" | "COMPLETION_FAILED" | "ABORTED";

export type BrainstormTokenUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
};

export type BrainstormToolCall = {
    type: "tool_call";
    callId: string;
    name: string;
    arguments: string;
    thoughtSignature?: string;
};

export type BrainstormToolResultStatus = "succeeded" | "failed" | "rejected" | "skipped" | "awaiting_approval";

export type BrainstormToolResult = {
    type: "tool_result";
    callId: string;
    name: string;
    status: BrainstormToolResultStatus;
    content: string;
    sideEffect?: "none" | "write";
};

export type BrainstormOutputItem = { type: "text"; text: string } | BrainstormToolCall | BrainstormToolResult;

export type BrainstormUserMessage = {
    id: string;
    parentId: string | null;
    role: "user";
    content: string;
    createdAt?: string;
};

export type BrainstormAssistantMessage = {
    id: string;
    parentId: string | null;
    role: "assistant";
    status: BrainstormAssistantStatus;
    output: BrainstormOutputItem[];
    usage?: BrainstormTokenUsage;
    createdAt?: string;
};

export type BrainstormMessage = BrainstormUserMessage | BrainstormAssistantMessage;

export type BrainstormStoryboardSnapshot = Pick<StoryboardRecord, "id" | "revision" | "title" | "sourceHash" | "status" | "options" | "directorPlan" | "document" | "validation">;

export type BrainstormFocus = { kind: "project" } | { kind: "scene"; sceneId: string } | { kind: "segment"; sceneId: string; segmentId: string } | { kind: "shot"; sceneId: string; segmentId: string; shotId: string };

export type BrainstormMemoryScope = { kind: "project" } | { kind: "scene"; sceneId: string } | { kind: "shot"; shotId: string };

export type BrainstormMemoryCandidate = {
    id: string;
    kind?: string;
    content: string;
    confirmed: boolean;
    tags?: string[];
    sourceMessageId?: string;
    operationId?: string;
    updatedAt?: string;
    scope: BrainstormMemoryScope;
};

export type BrainstormProjectMemory = {
    id: string;
    kind: string;
    scope: BrainstormMemoryScope["kind"];
    path: string;
    content: string;
    tags: string[];
    sourceMessageId: string;
    operationId: string;
    createdAt?: string;
    updatedAt?: string;
};

export type BrainstormMemoryWriteInput = Pick<BrainstormProjectMemory, "id" | "kind" | "scope" | "path" | "content" | "tags" | "sourceMessageId" | "operationId">;

export type BrainstormMemoryState = {
    candidates: BrainstormMemoryCandidate[];
    memories: BrainstormProjectMemory[];
};

export type BrainstormSummaryCheckpoint = {
    id: string;
    fromMessageId?: string;
    throughMessageId: string;
    content: string;
    tokenCount?: number;
    sourceTokenCount?: number;
    coveredMessageCount?: number;
    model?: string;
};

export type BrainstormSkillId = "divergent_ideation" | "character_conflict" | "visual_storytelling" | "shot_rhythm" | "continuity_check";

export type BrainstormSkill = Readonly<{
    id: BrainstormSkillId;
    version: string;
    label: string;
    description: string;
    instruction: string;
}>;

export type BrainstormToolDefinition = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    risk: "read" | "write";
    approval: "auto" | "required";
};

export type BrainstormModelMessage = { type: "message"; role: "system" | "user" | "assistant"; content: string } | BrainstormToolCall | BrainstormToolResult;

export type BrainstormTokenBudget = {
    contextWindowTokens: number;
    outputReserveTokens: number;
};

export type BrainstormContextKind = "system" | "skill" | "storyboard" | "memory" | "summary" | "history" | "tool_schema" | "current_user";

export type BrainstormContextDiagnosticItem = {
    kind: BrainstormContextKind;
    id: string;
    tokens: number;
    tokenSource: "usage" | "estimate";
    action: "included" | "trimmed";
    reason?: string;
};

export type BrainstormContextDiagnostics = {
    limitTokens: number;
    reservedOutputTokens: number;
    usedTokens: number;
    toolSchemaTokens: number;
    estimated: boolean;
    summary: "included" | "trimmed" | "missing";
    items: BrainstormContextDiagnosticItem[];
};

export type BrainstormContextInput = {
    skillId: BrainstormSkillId;
    storyboard: BrainstormStoryboardSnapshot;
    focus: BrainstormFocus;
    priorMessages: BrainstormMessage[];
    currentUserMessage: BrainstormUserMessage;
    memories: BrainstormMemoryCandidate[];
    summary?: BrainstormSummaryCheckpoint;
    tools: BrainstormToolDefinition[];
    budget: BrainstormTokenBudget;
};

export type BrainstormContextResult = {
    messages: BrainstormModelMessage[];
    tools: BrainstormToolDefinition[];
    diagnostics: BrainstormContextDiagnostics;
};

export type BrainstormCompletionEvent = { type: "text_delta"; delta: string } | { type: "tool_call_delta"; callId?: string; name?: string; argumentsDelta?: string } | { type: "usage"; usage: BrainstormTokenUsage };

export type BrainstormCompletionRequest = {
    messages: BrainstormModelMessage[];
    tools: BrainstormToolDefinition[];
};

export type BrainstormCompletionResult = {
    content: string;
    toolCalls: BrainstormToolCall[];
    usage?: BrainstormTokenUsage;
    finishReason?: string;
};

export type BrainstormComplete = (request: BrainstormCompletionRequest, options: { signal?: AbortSignal; onEvent: (event: BrainstormCompletionEvent) => void }) => Promise<BrainstormCompletionResult>;

export type BrainstormToolExecution = {
    status: "succeeded" | "failed" | "rejected" | "awaiting_approval";
    content: string;
    sideEffect?: "none" | "write";
};

export type BrainstormExecuteTool = (call: BrainstormToolCall, options: { signal?: AbortSignal; definition: BrainstormToolDefinition }) => Promise<BrainstormToolExecution>;

export type BrainstormTurnEvent = { type: "status"; status: BrainstormAssistantStatus } | { type: "text_delta"; delta: string } | { type: "output_item"; item: BrainstormOutputItem } | { type: "retry" };

export type BrainstormTurnBaseResult = {
    content: string;
    output: BrainstormOutputItem[];
    diagnostics: BrainstormContextDiagnostics;
    toolRounds: number;
    usage?: BrainstormTokenUsage;
};

export type BrainstormTurnContinuation = {
    context: BrainstormContextResult;
    messages: BrainstormModelMessage[];
    output: BrainstormOutputItem[];
    pendingCalls: BrainstormToolCall[];
    toolRounds: number;
    usage?: BrainstormTokenUsage;
};

export type BrainstormToolApprovalDecision = "approved" | "rejected";

export type BrainstormTurnResult =
    | (BrainstormTurnBaseResult & { status: "completed" })
    | (BrainstormTurnBaseResult & { status: "awaiting_approval"; call: BrainstormToolCall; continuation: BrainstormTurnContinuation })
    | (BrainstormTurnBaseResult & { status: "failed" | "cancelled"; error: { code: BrainstormErrorCode; message: string } });

export type BrainstormTurnDependencies = {
    complete: BrainstormComplete;
    executeTool: BrainstormExecuteTool;
    isRetryableCompletionError?: (error: unknown) => boolean;
};

export type BrainstormTurnOptions = {
    signal?: AbortSignal;
    onEvent?: (event: BrainstormTurnEvent) => void;
};
