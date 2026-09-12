import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { CodexAppClient } from "../src/agents.js";

function fakeChild(reply: (request: Record<string, unknown>) => unknown) {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString()) as Record<string, unknown>;
        if ("id" in request) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result: reply(request) })}\n`));
    });
    return child;
}

test("a rejected cross-workspace resume does not replace the thread emitter", async () => {
    const child = fakeChild((request) => request.method === "turn/start" ? { turn: { id: "turn-a" } } : { thread: { id: "thread-a", cwd: "/workspace-a" } });
    const client = new CodexAppClient(child as unknown as ChildProcess);
    const a: string[] = [];
    const b: string[] = [];
    const activeTurn = client.startTurn("thread-a", "prompt", [], (type) => a.push(type));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(client.resumeThread("thread-a", "/workspace-b"), /不属于当前画布工作空间/);
    child.stdout.write(`${JSON.stringify({ method: "turn/started", params: { threadId: "thread-a", turn: { id: "turn-a" } } })}\n`);
    child.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-a", turn: { id: "turn-a" } } })}\n`);
    await activeTurn;
    assert.ok(a.includes("agent_event"));
    assert.deepEqual(b, []);
});

test("fast turn completion releases every emitter and item buffer", async () => {
    let child!: ReturnType<typeof fakeChild>;
    child = fakeChild((request) => {
        if (request.method === "turn/start") {
            child.stdout.write(`${JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "thread-fast", turnId: "turn-fast", itemId: "item-fast", delta: "done" } })}\n`);
            child.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-fast", turn: { id: "turn-fast" } } })}\n`);
            return { turn: { id: "turn-fast" } };
        }
        return {};
    });
    const client = new CodexAppClient(child as unknown as ChildProcess);
    await client.startTurn("thread-fast", "prompt", [], () => undefined);
    const state = client as unknown as Record<string, Map<unknown, unknown>>;
    assert.equal(state.emitByThread.size, 0);
    assert.equal(state.emitByTurn.size, 0);
    assert.equal(state.threadByTurn.size, 0);
    assert.equal(state.textByItem.size, 0);
    assert.equal(state.itemIdsByTurn.size, 0);
});
