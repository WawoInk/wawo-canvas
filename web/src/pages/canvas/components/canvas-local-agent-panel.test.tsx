import assert from "node:assert/strict";
import test from "node:test";
import "../../../../test/register-dom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "antd";
import { CanvasLocalAgentPanel } from "./canvas-local-agent-panel";
import { beginCanvasAgentRequest, beginCanvasAgentSession, isCurrentCanvasAgentRequest, useCanvasAgentStore } from "../stores/use-canvas-agent-store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("session request epochs reject await-delayed and A-B-A work", async () => {
    const oldA = beginCanvasAgentRequest("threads", beginCanvasAgentSession("replica-a"));
    let release!: () => void;
    let wroteAfterAwait = false;
    const delayed = new Promise<void>((resolve) => {
        release = resolve;
    }).then(() => {
        wroteAfterAwait = isCurrentCanvasAgentRequest(oldA);
    });
    beginCanvasAgentSession("replica-b");
    const newA = beginCanvasAgentRequest("threads", beginCanvasAgentSession("replica-a"));
    release();
    await delayed;
    assert.equal(wroteAfterAwait, false);
    assert.equal(isCurrentCanvasAgentRequest(oldA), false);
    assert.equal(isCurrentCanvasAgentRequest(newA), true);
});

test("panel connects with fragment credentials only after clearing the URL, including StrictMode replay", async () => {
    window.history.replaceState(null, "", "/canvas/project/test?mode=new#agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=fake-fragment-token&tab=chat");
    useCanvasAgentStore.setState({ enabled: true, connected: false, token: "fake-old-token", url: "http://127.0.0.1:17372", confirmTools: true });
    const connections: string[] = [];
    const originalSource = globalThis.EventSource;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "EventSource", {
        configurable: true,
        writable: true,
        value: class {
            constructor(url: string) {
                assert.equal(window.location.hash, "#tab=chat");
                connections.push(url);
            }
            addEventListener() {}
            close() {}
        },
    });
    globalThis.fetch = async () => {
        throw new Error("No discovery or network expected");
    };
    const root = createRoot(document.createElement("div"));
    try {
        await act(async () =>
            root.render(
                <StrictMode>
                    <BrowserRouter>
                        <App>
                            <CanvasLocalAgentPanel
                                headless
                                snapshot={{ projectId: "test", title: "Test", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }}
                                canUndoOps={false}
                                onApplyOps={() => null}
                                onUndoOps={() => null}
                            />
                        </App>
                    </BrowserRouter>
                </StrictMode>,
            ),
        );
        assert.ok(connections.length > 0, "fragment should initiate the connection");
        assert.ok(connections.every((url) => new URL(url).searchParams.get("token") === "fake-fragment-token"));
        assert.equal(window.location.search, "?mode=new");
    } finally {
        await act(async () => root.unmount());
        globalThis.EventSource = originalSource;
        globalThis.fetch = originalFetch;
    }
});

for (const fragment of ["#agentToken=fake-incomplete", "#agentUrl=javascript%3Afake&agentToken=fake-invalid"]) {
    test(`invalid fragment is cleared without falling back to saved credentials: ${fragment.split("=")[0]}`, async () => {
        window.history.replaceState(null, "", `/canvas/project/test?mode=new${fragment}`);
        useCanvasAgentStore.setState({ enabled: true, connected: false, token: "fake-saved-token" });
        const originalSource = globalThis.EventSource;
        const originalFetch = globalThis.fetch;
        let connections = 0;
        let discovery = 0;
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: class {
                constructor() {
                    connections++;
                }
                addEventListener() {}
                close() {}
            },
        });
        globalThis.fetch = async () => {
            discovery++;
            throw new Error("No network expected");
        };
        const root = createRoot(document.createElement("div"));
        try {
            await act(async () =>
                root.render(
                    <StrictMode>
                        <BrowserRouter>
                            <App>
                                <CanvasLocalAgentPanel
                                    headless
                                    autoConnect
                                    snapshot={{ projectId: "test", title: "Test", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }}
                                    canUndoOps={false}
                                    onApplyOps={() => null}
                                    onUndoOps={() => null}
                                />
                            </App>
                        </BrowserRouter>
                    </StrictMode>,
                ),
            );
            assert.equal(window.location.hash, "");
            assert.equal(connections, 0);
            assert.equal(discovery, 0);
        } finally {
            await act(async () => root.unmount());
            globalThis.EventSource = originalSource;
            globalThis.fetch = originalFetch;
        }
    });
}

test("switching projects reconnects with the new replica and clears the previous thread state", async () => {
    window.history.replaceState(null, "", "/canvas/project/replica-a");
    useCanvasAgentStore.setState({
        canvasId: "replica-a",
        enabled: true,
        connected: false,
        token: "fake-token",
        url: "http://127.0.0.1:17371",
        activeThreadId: "thread-a",
        messages: [{ id: "message-a", role: "assistant", text: "Replica A" }],
        eventLogs: [{ id: "event-a", time: "00:00", title: "A", text: "Replica A event" }],
        pendingTool: { requestId: "request-a", name: "canvas_apply_ops", input: { ops: [] } },
    });
    const connections: string[] = [];
    const requests: Array<{ url: string; body?: string }> = [];
    const originalSource = globalThis.EventSource;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "EventSource", {
        configurable: true,
        writable: true,
        value: class {
            onerror: (() => void) | null = null;
            constructor(url: string) {
                connections.push(url);
            }
            addEventListener() {}
            close() {}
        },
    });
    globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const root = createRoot(document.createElement("div"));
    const renderPanel = (projectId: string) => (
        <BrowserRouter>
            <App>
                <CanvasLocalAgentPanel headless snapshot={{ projectId, title: projectId, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }} canUndoOps={false} onApplyOps={() => null} onUndoOps={() => null} />
            </App>
        </BrowserRouter>
    );
    try {
        await act(async () => root.render(renderPanel("replica-a")));
        await act(async () => root.render(null));
        await act(async () => root.render(renderPanel("replica-b")));
        const state = useCanvasAgentStore.getState();
        assert.equal(state.canvasId, "replica-b");
        assert.equal(state.activeThreadId, "");
        assert.deepEqual(state.messages, []);
        assert.deepEqual(state.eventLogs, []);
        assert.equal(state.pendingTool, null);
        const rejected = requests.find((request) => new URL(request.url).pathname === "/canvas/result");
        assert.equal(new URL(rejected?.url || "http://invalid").searchParams.get("canvasId"), "replica-a");
        assert.match(rejected?.body || "", /画布已切换/);
        assert.ok(connections.some((url) => new URL(url).searchParams.get("canvasId") === "replica-a"));
        assert.ok(connections.some((url) => new URL(url).searchParams.get("canvasId") === "replica-b"));
    } finally {
        await act(async () => root.unmount());
        globalThis.EventSource = originalSource;
        globalThis.fetch = originalFetch;
    }
});
