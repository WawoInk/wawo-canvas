import type {
    BrainstormFocus,
    BrainstormMemoryCandidate,
    BrainstormMemoryState,
    BrainstormMemoryWriteInput,
    BrainstormProjectMemory,
} from "./brainstorm-agent";

const MAX_ID_BYTES = 200;
const MAX_KIND_BYTES = 64;
const MAX_PATH_BYTES = 200;
const MAX_TAGS = 32;
const MAX_TAG_BYTES = 64;
const MAX_CONTENT_BYTES = 32 * 1024;
const encoder = new TextEncoder();

export const DEFAULT_BRAINSTORM_MEMORY_LIMITS = Object.freeze({ maxItems: 24, maxContentBytes: 8 * 1024, maxTotalBytes: 32 * 1024 });

export type BrainstormMemoryValidationIssue = { field: "id" | "kind" | "scope" | "content" | "tags" | "sourceMessageId" | "operationId"; message: string };
export type BrainstormMemoryLimits = { maxItems: number; maxContentBytes: number; maxTotalBytes: number };
export type BrainstormMemorySelection = { included: BrainstormMemoryCandidate[]; excluded: { memory: BrainstormMemoryCandidate; reason: string }[] };
export type BrainstormMemoryStateChange =
    | { type: "candidate_added"; candidate: BrainstormMemoryCandidate }
    | { type: "candidate_removed"; candidateId: string }
    | { type: "confirmed"; candidateId: string; memory: BrainstormProjectMemory }
    | { type: "edited"; memory: BrainstormProjectMemory }
    | { type: "deleted"; memoryId: string };

function bytes(value: string): number {
    return encoder.encode(value).length;
}

function validText(value: string | undefined, maxBytes: number): boolean {
    return Boolean(value?.trim()) && bytes(value!.trim()) <= maxBytes;
}

function normalizeTags(tags: string[] | undefined): string[] {
    const seen = new Set<string>();
    return (tags ?? []).flatMap((value) => {
        const tag = value.trim();
        if (!tag || seen.has(tag)) return [];
        seen.add(tag);
        return [tag];
    });
}

function scopePath(memory: BrainstormMemoryCandidate): string {
    return memory.scope.kind === "project" ? "" : memory.scope.kind === "scene" ? memory.scope.sceneId.trim() : memory.scope.shotId.trim();
}

export function validateBrainstormMemoryCandidate(candidate: BrainstormMemoryCandidate): BrainstormMemoryValidationIssue[] {
    const issues: BrainstormMemoryValidationIssue[] = [];
    if (!validText(candidate.id, MAX_ID_BYTES)) issues.push({ field: "id", message: "Memory ID 无效" });
    if (!validText(candidate.kind, MAX_KIND_BYTES)) issues.push({ field: "kind", message: "Memory kind 无效" });
    if (candidate.scope.kind !== "project" && !validText(scopePath(candidate), MAX_PATH_BYTES)) issues.push({ field: "scope", message: "Memory scope/path 无效" });
    if (!validText(candidate.content, MAX_CONTENT_BYTES)) issues.push({ field: "content", message: "Memory 内容无效" });
    const tags = candidate.tags ?? [];
    if (tags.length > MAX_TAGS || tags.some((tag) => !validText(tag, MAX_TAG_BYTES))) issues.push({ field: "tags", message: "Memory tags 无效" });
    if (candidate.sourceMessageId && !validText(candidate.sourceMessageId, MAX_ID_BYTES)) issues.push({ field: "sourceMessageId", message: "来源消息 ID 无效" });
    return issues;
}

export function prepareBrainstormMemoryConfirmation(candidate: BrainstormMemoryCandidate, operationId: string): BrainstormMemoryWriteInput {
    const issues = validateBrainstormMemoryCandidate(candidate);
    if (!validText(operationId, MAX_ID_BYTES)) issues.push({ field: "operationId", message: "operationId 无效" });
    if (issues.length) throw new Error(issues.map((issue) => issue.message).join("；"));
    return {
        id: candidate.id.trim(),
        kind: candidate.kind!.trim(),
        scope: candidate.scope.kind,
        path: scopePath(candidate),
        content: candidate.content,
        tags: normalizeTags(candidate.tags),
        sourceMessageId: candidate.sourceMessageId?.trim() ?? "",
        operationId: operationId.trim(),
    };
}

export function projectBrainstormMemory(memory: BrainstormProjectMemory): BrainstormMemoryCandidate {
    const scope = memory.scope === "project" ? { kind: "project" as const } : memory.scope === "scene" ? { kind: "scene" as const, sceneId: memory.path } : { kind: "shot" as const, shotId: memory.path };
    return {
        id: memory.id,
        kind: memory.kind,
        content: memory.content,
        confirmed: true,
        tags: memory.tags,
        sourceMessageId: memory.sourceMessageId,
        operationId: memory.operationId,
        ...(memory.updatedAt ? { updatedAt: memory.updatedAt } : {}),
        scope,
    };
}

export function projectBrainstormMemories(memories: BrainstormProjectMemory[]): BrainstormMemoryCandidate[] {
    return memories.map(projectBrainstormMemory);
}

function upsertMemory(memories: BrainstormProjectMemory[], memory: BrainstormProjectMemory): BrainstormProjectMemory[] {
    return [memory, ...memories.filter((item) => item.id !== memory.id)];
}

export function applyBrainstormMemoryStateChange(state: BrainstormMemoryState, change: BrainstormMemoryStateChange): BrainstormMemoryState {
    if (change.type === "candidate_added") return { ...state, candidates: [change.candidate, ...state.candidates.filter((item) => item.id !== change.candidate.id)] };
    if (change.type === "candidate_removed") return { ...state, candidates: state.candidates.filter((item) => item.id !== change.candidateId) };
    if (change.type === "confirmed") return { candidates: state.candidates.filter((item) => item.id !== change.candidateId), memories: upsertMemory(state.memories, change.memory) };
    if (change.type === "edited") return { ...state, memories: upsertMemory(state.memories, change.memory) };
    return { ...state, memories: state.memories.filter((item) => item.id !== change.memoryId) };
}

function specificity(memory: BrainstormMemoryCandidate): number {
    return memory.scope.kind === "shot" ? 3 : memory.scope.kind === "scene" ? 2 : 1;
}

function relevant(memory: BrainstormMemoryCandidate, focus: BrainstormFocus): boolean {
    if (memory.scope.kind === "project") return true;
    if (memory.scope.kind === "scene") return focus.kind !== "project" && focus.sceneId === memory.scope.sceneId;
    return focus.kind === "shot" && focus.shotId === memory.scope.shotId;
}

function normalizedContent(memory: BrainstormMemoryCandidate): string {
    return memory.content.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function compareMemory(left: BrainstormMemoryCandidate, right: BrainstormMemoryCandidate): number {
    return specificity(right) - specificity(left) || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.id.localeCompare(right.id);
}

export function selectBrainstormMemories(memories: BrainstormMemoryCandidate[], focus: BrainstormFocus, limits: BrainstormMemoryLimits = DEFAULT_BRAINSTORM_MEMORY_LIMITS): BrainstormMemorySelection {
    const included: BrainstormMemoryCandidate[] = [];
    const excluded: BrainstormMemorySelection["excluded"] = [];
    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    let totalBytes = 0;

    for (const memory of [...memories].sort(compareMemory)) {
        let reason = "";
        const contentBytes = bytes(memory.content);
        const contentKey = normalizedContent(memory);
        if (!memory.confirmed) reason = "Memory 尚未由用户确认";
        else if (!memory.content.trim()) reason = "Memory 内容为空";
        else if (!relevant(memory, focus)) reason = "Memory 与当前焦点无关";
        else if (seenIds.has(memory.id)) reason = "Memory ID 重复";
        else if (seenContent.has(contentKey)) reason = "Memory 重复内容已由更高优先级项覆盖";
        else if (contentBytes > limits.maxContentBytes) reason = "Memory 内容长度超过注入上限";
        else if (included.length >= limits.maxItems) reason = "Memory 数量上限已满";
        else if (totalBytes + contentBytes > limits.maxTotalBytes) reason = "Memory 总长度超过注入上限";

        if (reason) {
            excluded.push({ memory, reason });
            continue;
        }
        included.push(memory);
        seenIds.add(memory.id);
        seenContent.add(contentKey);
        totalBytes += contentBytes;
    }
    return { included, excluded };
}
