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

test("分镜创作室沿用画布和素材页的页面外壳与滚动内容区", async () => {
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
    for (const className of ["flex", "h-full", "flex-col", "overflow-hidden", "bg-background", "text-foreground"]) {
        assert.ok(page.className.split(/\s+/).includes(className), `缺少页面外壳 class：${className}`);
    }
    assert.doesNotMatch(page.className, /overflow-y-auto/);

    const contentShell = page.firstElementChild;
    assert.ok(contentShell);
    assert.equal(contentShell.tagName, "MAIN");
    for (const className of ["thin-scrollbar", "min-h-0", "flex-1", "overflow-y-auto", "px-6", "py-8"]) {
        assert.ok(contentShell.className.split(/\s+/).includes(className), `缺少滚动内容区 class：${className}`);
    }

    const tabs = container.querySelector(".ant-tabs");
    assert.ok(tabs);
    const tabClasses = new Set(tabs.className.split(/\s+/));
    assert.ok(tabClasses.has("mx-auto"));
    assert.ok(tabClasses.has("max-w-7xl"));
    assert.ok(!tabClasses.has("max-w-[2400px]"));
    assert.ok(tabClasses.has("flex"));
    assert.ok(tabClasses.has("h-full"));
    assert.ok(tabClasses.has("min-h-0"));
    assert.ok(tabClasses.has("storyboard-tabs"));

    const tabHeader = container.querySelector(".ant-tabs-nav");
    assert.ok(tabHeader);
    assert.equal(tabHeader.getAttribute("role"), "tablist");

    assertAlignedContent(container, "storyboard-studio");

    const storyboardPane = container.querySelector('[data-testid="storyboard-studio"]')?.parentElement;
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

function assertAlignedContent(container: ParentNode, testId: string) {
    const content = container.querySelector(`[data-testid="${testId}"]`)?.parentElement;
    assert.ok(content);
    const classes = new Set(content.className.split(/\s+/));
    assert.ok(classes.has("w-full"));
    assert.ok(!content.style.maxWidth);
    assert.ok(!content.style.marginInline);
    assert.ok(!content.style.paddingInline);
    assert.ok(content.closest(".storyboard-tabs"));
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
    assertAlignedContent(container, "brainstorm-agent-studio");

    await act(async () => tab(container, "分镜创作室").click());
    assert.equal(tab(container, "分镜创作室").getAttribute("aria-selected"), "true");
    assertAlignedContent(container, "storyboard-studio");

    await act(async () => tab(container, "剧本 Agent").click());
    assert.equal(tab(container, "剧本 Agent").getAttribute("aria-selected"), "true");
    assertAlignedContent(container, "script-agent-page");

    await act(async () => root.unmount());
    container.remove();
});
