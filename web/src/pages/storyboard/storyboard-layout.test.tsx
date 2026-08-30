import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("./storyboard-studio", () => ({ StoryboardStudio: () => <div data-testid="storyboard-studio" /> }));
mock.module("./script-agent-page", () => ({ ScriptAgentPage: () => <div data-testid="script-agent-page" /> }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { default: StoryboardPage } = await import("./index");

test("分镜创作室保留内容边界并提供页面级纵向滚动", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<MemoryRouter initialEntries={["/storyboard"]}><StoryboardPage /></MemoryRouter>));

    const page = container.firstElementChild;
    assert.ok(page);
    assert.match(page.className, /overflow-y-auto/);
    assert.doesNotMatch(page.className, /overflow-hidden/);

    const tabs = container.querySelector(".ant-tabs");
    assert.ok(tabs);
    assert.match(tabs.className, /mx-auto/);
    assert.match(tabs.className, /max-w-\[2400px\]/);
    assert.match(tabs.className, /px-4/);

    const storyboardPane = container.querySelector("main");
    assert.ok(storyboardPane);
    assert.doesNotMatch(storyboardPane.className, /lg:overflow-hidden/);

    await act(async () => root.unmount());
    container.remove();
});
