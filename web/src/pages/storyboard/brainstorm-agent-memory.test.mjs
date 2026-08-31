import assert from "node:assert/strict";
import { test } from "node:test";

import { applyBrainstormMemoryStateChange, prepareBrainstormMemoryConfirmation, projectBrainstormMemories, selectBrainstormMemories, validateBrainstormMemoryCandidate } from "./brainstorm-agent-memory.ts";

const candidate = (overrides = {}) => ({
    id: "memory-1",
    kind: "constraint",
    content: "雨夜保持冷蓝色调",
    confirmed: false,
    tags: [" tone ", "rain", "tone"],
    sourceMessageId: "message-1",
    scope: { kind: "shot", shotId: "shot-1" },
    ...overrides,
});

const memory = (overrides = {}) => ({
    id: "memory-1",
    kind: "constraint",
    scope: "shot",
    path: "shot-1",
    content: "雨夜保持冷蓝色调",
    tags: ["tone", "rain"],
    sourceMessageId: "message-1",
    operationId: "operation-1",
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T00:00:00Z",
    ...overrides,
});

test("validates candidates and prepares a stable normalized confirmation command", () => {
    assert.deepEqual(validateBrainstormMemoryCandidate(candidate()), []);

    const first = prepareBrainstormMemoryConfirmation(candidate(), " operation-1 ");
    const retry = prepareBrainstormMemoryConfirmation(candidate(), " operation-1 ");
    assert.deepEqual(first, retry);
    assert.deepEqual(first, {
        id: "memory-1",
        kind: "constraint",
        scope: "shot",
        path: "shot-1",
        content: "雨夜保持冷蓝色调",
        tags: ["tone", "rain"],
        sourceMessageId: "message-1",
        operationId: "operation-1",
    });

    const issues = validateBrainstormMemoryCandidate(candidate({ id: " ", kind: " ", content: " ", tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`), scope: { kind: "scene", sceneId: " " } }));
    assert.deepEqual(
        issues.map((issue) => issue.field),
        ["id", "kind", "scope", "content", "tags"],
    );
    assert.throws(() => prepareBrainstormMemoryConfirmation(candidate({ content: " " }), "operation-1"), /Memory 内容无效/);
});

test("projects confirmed server Memory and applies confirm, edit, and delete state changes", () => {
    const draft = candidate();
    let state = { candidates: [draft], memories: [] };

    state = applyBrainstormMemoryStateChange(state, { type: "confirmed", candidateId: draft.id, memory: memory() });
    assert.deepEqual(state.candidates, []);
    assert.deepEqual(projectBrainstormMemories(state.memories), [
        {
            id: "memory-1",
            kind: "constraint",
            content: "雨夜保持冷蓝色调",
            confirmed: true,
            tags: ["tone", "rain"],
            sourceMessageId: "message-1",
            operationId: "operation-1",
            updatedAt: "2026-08-31T00:00:00Z",
            scope: { kind: "shot", shotId: "shot-1" },
        },
    ]);

    state = applyBrainstormMemoryStateChange(state, { type: "edited", memory: memory({ content: "EDITED_MEMORY", operationId: "operation-2", updatedAt: "2026-08-31T01:00:00Z" }) });
    assert.equal(projectBrainstormMemories(state.memories)[0].content, "EDITED_MEMORY");
    assert.equal(projectBrainstormMemories(state.memories)[0].operationId, "operation-2");

    state = applyBrainstormMemoryStateChange(state, { type: "deleted", memoryId: "memory-1" });
    assert.deepEqual(state.memories, []);
});

test("selects scoped Memory deterministically, deduplicates by id/content, and reports bounds", () => {
    const memories = [
        candidate({ id: "project-duplicate", confirmed: true, updatedAt: "2026-08-31T03:00:00Z", scope: { kind: "project" }, content: "  SAME   MEMORY  " }),
        candidate({ id: "scene-b", confirmed: true, updatedAt: "2026-08-31T02:00:00Z", scope: { kind: "scene", sceneId: "scene-1" }, content: "SCENE_B" }),
        candidate({ id: "shot-duplicate", confirmed: true, updatedAt: "2026-08-31T01:00:00Z", scope: { kind: "shot", shotId: "shot-1" }, content: "same memory" }),
        candidate({ id: "scene-a", confirmed: true, updatedAt: "2026-08-31T02:00:00Z", scope: { kind: "scene", sceneId: "scene-1" }, content: "SCENE_A" }),
        candidate({ id: "other-scene", confirmed: true, scope: { kind: "scene", sceneId: "scene-2" }, content: "OTHER" }),
        candidate({ id: "too-long", confirmed: true, scope: { kind: "project" }, content: "X".repeat(40) }),
        candidate({ id: "project-extra", confirmed: true, scope: { kind: "project" }, content: "PROJECT_EXTRA" }),
    ];

    const result = selectBrainstormMemories(memories, { kind: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1" }, { maxItems: 3, maxContentBytes: 32, maxTotalBytes: 64 });
    assert.deepEqual(
        result.included.map((item) => item.id),
        ["shot-duplicate", "scene-a", "scene-b"],
    );
    assert.match(result.excluded.find((item) => item.memory.id === "project-duplicate").reason, /重复内容/);
    assert.match(result.excluded.find((item) => item.memory.id === "other-scene").reason, /焦点/);
    assert.match(result.excluded.find((item) => item.memory.id === "too-long").reason, /长度/);
    assert.match(result.excluded.find((item) => item.memory.id === "project-extra").reason, /数量上限/);

    const shuffled = selectBrainstormMemories([...memories].reverse(), { kind: "shot", sceneId: "scene-1", segmentId: "segment-1", shotId: "shot-1" }, { maxItems: 3, maxContentBytes: 32, maxTotalBytes: 64 });
    assert.deepEqual(
        shuffled.included.map((item) => item.id),
        result.included.map((item) => item.id),
    );
});

test("rejects invalid server Memory projections before they enter Context", () => {
    assert.throws(() => projectBrainstormMemories([memory({ scope: "conversation" })]), /scope\/path/);
    assert.throws(() => projectBrainstormMemories([memory({ scope: "project", path: "scene-1" })]), /scope\/path/);
    assert.throws(() => projectBrainstormMemories([memory({ operationId: " " })]), /operationId/);
});
