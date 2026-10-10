import "./register-dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import axios from "axios";
import i18n from "@/i18n";
import { useCanvasStore, type CanvasProject } from "@/pages/canvas/stores/use-canvas-store";
import { clearSyncTimers } from "@/pages/canvas/stores/canvas-sync";
import { CanvasNodeType } from "@/pages/canvas/types";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";

Object.assign(globalThis, { __APP_VERSION__: "test", IS_REACT_ACT_ENVIRONMENT: true });
const { default: CanvasPage } = await import("@/pages/canvas/project/index");
await i18n.changeLanguage("zh-CN");

for (const autoFocusOnSelect of [false, true]) {
    test(`canvas page preserves saved viewport, copies inbound references and honors auto-focus=${autoFocusOnSelect}`, async () => {
        const originalUser = useUserStore.getState();
        const originalConfig = useConfigStore.getState().config;
        const originalAdapter = axios.defaults.adapter;
        const originalFetch = globalThis.fetch;
        const originalRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function () {
            if (this.hasAttribute("data-node-id")) return new DOMRect(100, 80, 170, 250);
            if (this.hasAttribute("data-node-panel")) return new DOMRect(0, 346, 500, 300);
            if (this.hasAttribute("data-canvas-bottom-toolbar")) return new DOMRect(300, 624, 600, 56);
            return originalRect.call(this);
        };
        globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { items: [], total: 0 } }), { headers: { "content-type": "application/json" } });
        useUserStore.setState({ token: "canvas-release-token", user: { id: "canvas-release-user" } as typeof originalUser.user });
        await useCanvasStore.persist.rehydrate();
        const project: CanvasProject = {
            id: "canvas-release-operations",
            title: "画布操作",
            createdAt: "",
            updatedAt: "",
            revision: 1,
            localVersion: 0,
            dirty: false,
            nodes: [
                { id: "reference", type: CanvasNodeType.Text, title: "参考文本", position: { x: -500, y: 0 }, width: 340, height: 240, metadata: { content: "必须保留的引用" } },
                { id: "image", type: CanvasNodeType.Image, title: "目标图片", position: { x: 100, y: 80 }, width: 340, height: 500 },
            ],
            connections: [{ id: "inbound", fromNodeId: "reference", toNodeId: "image" }],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            viewport: { x: 37, y: 53, k: 0.5 },
        };
        const otherProject = { ...project, id: "other-canvas", title: "另一画布" };
        useCanvasStore.setState({ hydrated: true, synced: true, projects: [project, otherProject], tombstones: [] });
        useConfigStore.setState({ config: { ...originalConfig, autoFocusOnSelect } });
        axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: [], total: 0 } } });
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        try {
            await act(async () =>
                root.render(
                    <QueryClientProvider client={client}>
                        <MemoryRouter initialEntries={[`/canvas/${project.id}`]}>
                            <App>
                                <Link to="/canvas/other-canvas">切换画布</Link>
                                <Routes>
                                    <Route path="/canvas/:id" element={<CanvasPage />} />
                                </Routes>
                            </App>
                        </MemoryRouter>
                    </QueryClientProvider>,
                ),
            );
            const image = required(host.querySelector<HTMLElement>('[data-node-id="image"]'));
            const plane = required(image.parentElement);
            const canvas = required(plane.parentElement);
            canvas.getBoundingClientRect = () => new DOMRect(0, 0, 900, 700);
            assert.equal(plane.style.transform, "translate(37px, 53px) scale(0.5)");

            await act(async () => {
                required(image.firstElementChild).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 80 }));
                window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 100, clientY: 80 }));
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            assert.equal(plane.style.transform !== "translate(37px, 53px) scale(0.5)", autoFocusOnSelect);
            if (autoFocusOnSelect) assert.ok(Math.abs(Number(plane.style.transform.match(/scale\(([^)]+)\)/)?.[1]) - 0.51616) < 0.000001, "auto-focus measures the mounted panel and leaves it above the dock");
            assert.ok(image.querySelector('[data-canvas-reference-node-id="reference"]'));
            await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true })));
            await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true })));
            const pasted = [...host.querySelectorAll<HTMLElement>("[data-node-id]")].find((node) => !["reference", "image"].includes(node.dataset.nodeId || ""));
            assert.ok(pasted, "the pasted node is visible");
            assert.ok(pasted.querySelector('[data-canvas-reference-node-id="reference"]'), "the pasted generation panel keeps its original reference");
            const beforeFocus = plane.style.transform;
            await act(async () => required(host.querySelector<HTMLButtonElement>('[aria-label="居中选中节点"]')).click());
            assert.notEqual(plane.style.transform, beforeFocus);
            await act(async () => {
                required(host.querySelector<HTMLAnchorElement>('a[href="/canvas/other-canvas"]')).click();
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true })));
            assert.equal(host.querySelectorAll("[data-node-id]").length, 2, "switching projects clears the canvas clipboard even when node IDs match");
        } finally {
            await act(async () => root.unmount());
            client.clear();
            clearSyncTimers();
            host.remove();
            axios.defaults.adapter = originalAdapter;
            useConfigStore.setState({ config: originalConfig });
            useUserStore.setState(originalUser, true);
            globalThis.fetch = originalFetch;
            HTMLElement.prototype.getBoundingClientRect = originalRect;
        }
    });
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
