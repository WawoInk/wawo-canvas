import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("./storyboard-studio", () => ({ StoryboardStudio: () => <div data-testid="storyboard-studio" /> }));
mock.module("./brainstorm-agent-studio", () => ({ BrainstormAgentStudio: () => <div data-testid="brainstorm-agent-studio" /> }));
mock.module("./script-agent-page", () => ({ ScriptAgentPage: () => <div data-testid="script-agent-page" /> }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { default: StoryboardPage } = await import("./index");

test("分镜创作室保留内容边界并提供页面级纵向滚动", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={["/storyboard"]}>
                <StoryboardPage />
            </MemoryRouter>,
        ),
    );

    const page = container.firstElementChild;
    assert.ok(page);
    assert.match(page.className, /overflow-y-auto/);
    assert.doesNotMatch(page.className, /overflow-hidden/);

    const tabs = container.querySelector(".ant-tabs");
    assert.ok(tabs);
    const tabClasses = new Set(tabs.className.split(/\s+/));
    assert.ok(tabClasses.has("mx-auto"));
    assert.ok(tabClasses.has("max-w-[2400px]"));
    assert.ok(tabClasses.has("[&_.ant-tabs-nav-wrap]:mx-auto"));
    assert.ok(tabClasses.has("[&_.ant-tabs-nav-wrap]:max-w-7xl"));
    assert.ok(tabClasses.has("[&_.ant-tabs-nav-wrap]:px-6"));
    assert.ok(tabClasses.has("[&>.ant-tabs-content-holder]:px-4"));
    assert.ok(tabClasses.has("sm:[&>.ant-tabs-content-holder]:px-6"));
    assert.equal(tabClasses.has("px-4"), false);

    const storyboardPane = container.querySelector("main");
    assert.ok(storyboardPane);
    assert.doesNotMatch(storyboardPane.className, /lg:overflow-hidden/);

    await act(async () => root.unmount());
    container.remove();
});

function tab(container: ParentNode, label: string) {
    const item = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((element) => element.textContent?.trim() === label);
    assert.ok(item, `未找到 Tab：${label}`);
    return item;
}

test("脑暴 Agent 位于分镜创作室左侧并可独立切换", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={["/storyboard"]}>
                <StoryboardPage />
            </MemoryRouter>,
        ),
    );

    const labels = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).map((element) => element.textContent?.trim());
    assert.ok(labels.indexOf("脑暴 Agent") < labels.indexOf("分镜创作室"));
    assert.equal(tab(container, "分镜创作室").getAttribute("aria-selected"), "true");
    assert.ok(container.querySelector('[data-testid="storyboard-studio"]'));

    await act(async () => tab(container, "脑暴 Agent").click());
    assert.equal(tab(container, "脑暴 Agent").getAttribute("aria-selected"), "true");
    assert.ok(container.querySelector('[data-testid="brainstorm-agent-studio"]'));

    await act(async () => tab(container, "分镜创作室").click());
    assert.equal(tab(container, "分镜创作室").getAttribute("aria-selected"), "true");

    await act(async () => root.unmount());
    container.remove();
});
