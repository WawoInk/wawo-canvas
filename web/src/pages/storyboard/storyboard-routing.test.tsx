import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("./storyboard-studio", () => ({ StoryboardStudio: () => <div data-testid="storyboard-studio" /> }));
mock.module("./script-agent-page", () => ({ ScriptAgentPage: ({ projectId }: { projectId?: string }) => <div data-testid="script-agent-page">{projectId || "space"}</div> }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { default: StoryboardPage } = await import("./index");

async function render(pathname: string) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<MemoryRouter initialEntries={[pathname]}><StoryboardPage /></MemoryRouter>));
    return { container, root };
}

test("进入剧本 Agent 时首先显示剧本空间", async () => {
    const { container, root } = await render("/storyboard/script-agent");
    assert.equal(container.querySelector('[data-testid="script-agent-page"]')?.textContent, "space");
    assert.equal(container.querySelector('[data-testid="storyboard-studio"]'), null);
    await act(async () => root.unmount());
    container.remove();
});

test("具体剧本路径把项目 ID 绑定到 Agent 页面", async () => {
    const { container, root } = await render("/storyboard/script-agent/project-1");
    assert.equal(container.querySelector('[data-testid="script-agent-page"]')?.textContent, "project-1");
    await act(async () => root.unmount());
    container.remove();
});
