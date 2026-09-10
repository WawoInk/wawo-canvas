import "../../../../test/register-dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import i18n from "@/i18n";
import axios from "axios";
import CanvasLibrary from "../index";

import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { useCanvasAgentStore } from "../stores/use-canvas-agent-store";
import { clearSyncTimers } from "../stores/canvas-sync";

Object.assign(globalThis, { __APP_VERSION__: "test", IS_REACT_ACT_ENVIRONMENT: true });
const { default: CanvasProjectPage } = await import("../project/index");
const project: CanvasProject = {
    id: "agent-entry",
    title: "Agent Entry Test",
    createdAt: "",
    updatedAt: "",
    revision: 1,
    localVersion: 0,
    dirty: false,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};
const fragment = "#agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=fake-entry-token";

for (const { mode, entryFragment, valid } of [
    ...["new", "recent", "choose"].map((mode) => ({ mode, entryFragment: fragment, valid: true })),
    { mode: "direct-partial", entryFragment: "#agentToken=fake-partial-token", valid: false },
    { mode: "direct-invalid", entryFragment: "#agentUrl=javascript%3Afake&agentToken=fake-invalid-token", valid: false },
]) {
    test(`${mode}: real routes consume credentials, retain compact mount, and replace sensitive history`, async () => {
        await useCanvasStore.persist.rehydrate();
        useCanvasStore.setState({ hydrated: true, synced: true, projects: [structuredClone(project)], tombstones: [] });
        useCanvasAgentStore.setState({ enabled: !valid, connected: false, token: valid ? "" : "fake-old-token", url: "http://127.0.0.1:17371" });
        window.history.replaceState(null, "", "/before-agent-entry");
        window.history.pushState(null, "", `${valid ? `/canvas?mode=${mode}` : `/canvas/${project.id}?mode=choose`}${entryFragment}`);
        const historyLength = window.history.length;
        const sources: Array<{ url: string; closed: boolean }> = [];
        const originalSource = globalThis.EventSource;
        const originalFetch = globalThis.fetch;
        const originalAdapter = axios.defaults.adapter;
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: class {
                entry: { url: string; closed: boolean };
                constructor(url: string) {
                    assert.equal(window.location.hash, "", "fragment must be cleared before connecting");
                    this.entry = { url, closed: false };
                    sources.push(this.entry);
                }
                addEventListener() {}
                close() {
                    this.entry.closed = true;
                }
            },
        });
        globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: [] }), { headers: { "content-type": "application/json" } });
        axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: [], total: 0 } } });
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        try {
            await act(async () =>
                root.render(
                    <StrictMode>
                        <QueryClientProvider client={client}>
                            <BrowserRouter>
                                <App>
                                    <Routes>
                                        <Route path="/canvas" element={<CanvasLibrary />} />
                                        <Route path="/canvas/:id" element={<CanvasProjectPage />} />
                                        <Route path="/before-agent-entry" element={<p>Before</p>} />
                                    </Routes>
                                </App>
                            </BrowserRouter>
                        </QueryClientProvider>
                    </StrictMode>,
                ),
            );
            if (mode === "choose") {
                const title = [...host.querySelectorAll("h2")].find((item) => item.textContent === project.title);
                assert.ok(title, "real project card should be available");
                await act(async () => title.click());
            }
            for (let attempt = 0; attempt < 10 && !sources.length; attempt++)
                await act(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                });
            if (valid)
                assert.ok(
                    sources.some((source) => !source.closed),
                    "headless connection must remain mounted after URL cleanup",
                );
            else assert.equal(sources.length, 0, "invalid bootstrap must never connect with saved credentials");
            assert.equal(window.location.hash, "");
            assert.ok(
                [...host.querySelectorAll("button")].some((button) => button.title === i18n.t("canvas.editor.agent.openPanel")),
                "compact status must remain after fragment cleanup, including rejected credentials",
            );
            assert.ok(sources.every((source) => new URL(source.url).searchParams.get("token") === "fake-entry-token"));
            assert.equal(window.history.length, historyLength, "credential entry should be replaced rather than pushed");
            await act(async () => {
                window.history.back();
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
            assert.equal(window.location.pathname, "/before-agent-entry");
            assert.equal(window.location.hash, "");
        } finally {
            await act(async () => root.unmount());
            client.clear();
            clearSyncTimers();
            host.remove();
            globalThis.EventSource = originalSource;
            globalThis.fetch = originalFetch;
            axios.defaults.adapter = originalAdapter;
        }
    });
}
