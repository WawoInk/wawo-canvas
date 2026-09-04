import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let publicSettings: { navigation: Record<string, unknown> } | null = null;
afterEach(() => {
    publicSettings = null;
});

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
mock.module("@/i18n", () => ({ appPathname: (pathname: string) => pathname }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
mock.module("@/stores/use-config-store", () => ({ useConfigStore: (selector: (state: { publicSettings: typeof publicSettings }) => unknown) => selector({ publicSettings }) }));
mock.module("@/components/layout/brand-logo", () => ({ BrandLogo: () => <div data-testid="brand-logo" /> }));
mock.module("@/components/layout/user-status-actions", () => ({ UserStatusActions: () => <div data-testid="user-status-actions" /> }));
mock.module("@/components/layout/app-config-modal", () => ({ AppConfigModal: () => null }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { AppTopNav } = await import("./app-top-nav");

async function render(navigation?: Record<string, unknown>) {
    publicSettings = navigation ? { navigation } : null;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={["/storyboard"]}>
                <AppTopNav />
            </MemoryRouter>,
        ),
    );
    return { container, root };
}

function hrefs(container: ParentNode, selector: string) {
    return Array.from(container.querySelectorAll<HTMLAnchorElement>(selector)).map((link) => link.getAttribute("href"));
}

test("桌面与移动导航使用同一份 public.navigation 过滤结果", async () => {
    const { container, root } = await render({ enabled: true, video: false, volcengineAssets: false });
    const expected = ["/canvas", "/storyboard", "/image", "/assets", "/prompts"];
    assert.deepEqual(hrefs(container, "header nav a"), expected);

    const menuButton = container.querySelector<HTMLButtonElement>('button[aria-label="navigation.openMenu"]');
    assert.ok(menuButton);
    await act(async () => menuButton.click());
    assert.deepEqual(hrefs(document.body, ".ant-drawer a"), expected);

    await act(async () => root.unmount());
    container.remove();
});

test("总开关关闭时保留品牌与账户 header，但隐藏产品导航和移动菜单入口", async () => {
    const { container, root } = await render({ enabled: false });
    assert.ok(container.querySelector("header"));
    assert.ok(container.querySelector('[data-testid="brand-logo"]'));
    assert.ok(container.querySelector('[data-testid="user-status-actions"]'));
    assert.deepEqual(hrefs(container, "header nav a"), []);
    assert.equal(container.querySelector('button[aria-label="navigation.openMenu"]'), null);

    await act(async () => root.unmount());
    container.remove();
});

test("导航配置缺失时保持全部产品入口可见", async () => {
    const { container, root } = await render();
    assert.deepEqual(hrefs(container, "header nav a"), ["/canvas", "/storyboard", "/image", "/video", "/assets", "/volcengine-assets", "/prompts"]);

    await act(async () => root.unmount());
    container.remove();
});
