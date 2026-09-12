import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CanvasSession } from "../src/canvas-session.js";

class FakeResponse extends EventEmitter {
    chunks: string[] = [];
    writeHead() {}
    write(chunk: string) {
        this.chunks.push(chunk);
        return true;
    }
}

function event(response: FakeResponse, type: string) {
    const match = response.chunks.join("").match(new RegExp(`event: ${type}\\ndata: (.+)\\n\\n`));
    return match ? (JSON.parse(match[1]) as Record<string, unknown>) : null;
}

test("two Canvas replicas isolate state, events, pending results, and ambiguous MCP calls", async () => {
    const session = new CanvasSession();
    const a = new FakeResponse();
    const b = new FakeResponse();
    session.openEvents(new URL("http://agent/events?canvasId=replica-a&clientId=client-a"), a as unknown as ServerResponse);
    session.openEvents(new URL("http://agent/events?canvasId=replica-b&clientId=client-b"), b as unknown as ServerResponse);
    session.updateState({ projectId: "replica-a", title: "A", nodes: [], connections: [] }, "client-a", "replica-a");
    session.updateState({ projectId: "replica-b", title: "B", nodes: [], connections: [] }, "client-b", "replica-b");

    assert.equal((await session.callTool("canvas_get_state", {}, "replica-a") as { title: string }).title, "A");
    assert.equal((await session.callTool("canvas_get_state", {}, "replica-b") as { title: string }).title, "B");
    await assert.rejects(session.callTool("canvas_get_state", {}), /必须指定 Replica identity/);

    a.chunks = [];
    b.chunks = [];
    session.emit("replica-a", "agent_event", { type: "turn.started" });
    assert.equal(event(a, "agent_event")?.type, "turn.started");
    assert.equal(event(b, "agent_event"), null);

    a.chunks = [];
    const pendingA = session.callTool("canvas_apply_ops", { ops: [] }, "replica-a");
    const requestA = String(event(a, "tool_call")?.requestId || "");
    assert.ok(requestA);
    assert.equal(event(b, "tool_call"), null);
    let settled = false;
    void pendingA.finally(() => { settled = true; });
    assert.throws(() => session.resolveResult({ requestId: requestA, result: "wrong replica" }, "replica-b"), /Replica identity 不匹配/);
    await Promise.resolve();
    assert.equal(settled, false);
    session.resolveResult({ requestId: requestA, result: "replica a result" }, "replica-a");
    assert.equal(await pendingA, "replica a result");

    a.emit("close");
    b.emit("close");
});

test("legacy single-canvas HTTP and MCP calls remain deterministic", async () => {
    const session = new CanvasSession();
    const response = new FakeResponse();
    session.openEvents(new URL("http://agent/events?clientId=legacy-client"), response as unknown as ServerResponse);
    session.emitter("legacy-project");
    session.updateState({ projectId: "legacy-project", title: "Legacy", nodes: [], connections: [] }, "legacy-client");
    assert.equal((await session.callTool("canvas_get_state", {}) as { title: string }).title, "Legacy");
    assert.equal((await session.callTool("canvas_get_state", {}, "legacy-project") as { title: string }).title, "Legacy");
    response.emit("close");
});

test("resolving the last pending request removes a disconnected replica", async () => {
    const session = new CanvasSession();
    const response = new FakeResponse();
    session.openEvents(new URL("http://agent/events?canvasId=replica-a&clientId=client-a"), response as unknown as ServerResponse);
    session.updateState({ projectId: "replica-a", nodes: [], connections: [] }, "client-a", "replica-a");
    response.chunks = [];
    const pending = session.callTool("canvas_apply_ops", { ops: [] }, "replica-a");
    const requestId = String(event(response, "tool_call")?.requestId || "");
    response.emit("close");
    session.resolveResult({ requestId, result: "done" }, "replica-a");
    assert.equal(await pending, "done");
    assert.equal(session.health().replicas, 0);
});
