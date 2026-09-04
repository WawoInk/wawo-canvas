import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StoryboardItems = {
    brainstormAgent: boolean;
    storyboard: boolean;
    scriptAgent: boolean;
};

let storyboardItems: StoryboardItems | undefined;
afterEach(() => {
    storyboardItems = undefined;
});

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/stores/use-config-store", () => ({
    useConfigStore: (selector: (state: unknown) => unknown) => selector({ publicSettings: storyboardItems ? { navigation: { storyboardItems } } : null }),
}));
mock.module("./storyboard-studio", () => ({ StoryboardStudio: () => <div data-testid="storyboard-studio" /> }));
mock.module("./brainstorm-agent-studio", () => ({ BrainstormAgentStudio: () => <div data-testid="brainstorm-agent-studio" /> }));
mock.module("./script-agent-page", () => ({ ScriptAgentPage: ({ projectId }: { projectId?: string }) => <div data-testid="script-agent-page">{projectId || "space"}</div> }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { default: StoryboardPage } = await import("./index");

async function render(pathname: string, visibility?: StoryboardItems) {
    storyboardItems = visibility;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={[pathname]}>
                <StoryboardPage />
            </MemoryRouter>,
        ),
    );
    return { container, root };
}

function tabLabels(container: ParentNode) {
    return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.textContent?.trim());
}

test("分镜子导航只显示 public.navigation.storyboardItems 开启的 Tab", async () => {
    const { container, root } = await render("/storyboard", { brainstormAgent: false, storyboard: true, scriptAgent: false });
    assert.deepEqual(tabLabels(container), ["分镜创作室"]);
    assert.ok(container.querySelector('[data-testid="storyboard-studio"]'));

    await act(async () => root.unmount());
    container.remove();
});

test("三个子项全隐藏时仍按当前 URL 渲染对应内容", async () => {
    const hidden = { brainstormAgent: false, storyboard: false, scriptAgent: false };
    const cases = [
        ["/storyboard/brainstorm-agent", "brainstorm-agent-studio"],
        ["/storyboard", "storyboard-studio"],
        ["/storyboard/script-agent/project-1", "script-agent-page"],
    ] as const;

    for (const [pathname, testId] of cases) {
        const { container, root } = await render(pathname, hidden);
        assert.deepEqual(tabLabels(container), []);
        assert.ok(container.querySelector(`[data-testid="${testId}"]`), `${pathname} 未渲染 ${testId}`);
        await act(async () => root.unmount());
        container.remove();
    }
});
