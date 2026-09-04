import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type PropsWithChildren, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// @ts-expect-error Bun provides module mocking at test runtime.
import { mock } from "bun:test";

type MenuItem = {
    key: string;
    label: ReactNode;
    children?: MenuItem[];
};

const Layout = Object.assign(({ children }: PropsWithChildren) => createElement("div", null, children), {
    Sider: ({ children }: PropsWithChildren) => createElement("aside", null, children),
    Header: ({ children }: PropsWithChildren) => createElement("header", null, children),
    Content: ({ children }: PropsWithChildren) => createElement("main", null, children),
});

mock.module("antd", () => ({
    Button: ({ children, href }: PropsWithChildren<{ href?: string }>) => createElement(href ? "a" : "button", href ? { href } : null, children),
    Flex: ({ children }: PropsWithChildren) => createElement("div", null, children),
    Layout,
    Menu: ({ items = [], selectedKeys = [], defaultOpenKeys = [] }: { items?: MenuItem[]; selectedKeys?: string[]; defaultOpenKeys?: string[] }) =>
        createElement(
            "nav",
            { "data-selected": selectedKeys.join(","), "data-open": defaultOpenKeys.join(",") },
            items.map((item) =>
                createElement(
                    "section",
                    { key: item.key, "data-menu-key": item.key },
                    createElement("h2", null, item.label),
                    item.children?.map((child) => createElement("div", { key: child.key, "data-menu-key": child.key }, child.label)),
                ),
            ),
        ),
    Typography: {
        Text: ({ children }: PropsWithChildren) => createElement("span", null, children),
        Title: ({ children }: PropsWithChildren) => createElement("h1", null, children),
    },
    theme: {
        useToken: () => ({ token: { colorBgLayout: "", colorBgContainer: "", colorBorder: "", colorBorderSecondary: "", colorText: "" } }),
    },
}));

mock.module("react-router-dom", () => ({
    Link: ({ children, to }: PropsWithChildren<{ to: string }>) => createElement("a", { href: to }, children),
    useLocation: () => ({ pathname: "/zh-CN/admin/assets" }),
    useNavigate: () => () => undefined,
}));

const translations: Record<string, string> = {
    "common.brand": "Canvan",
    "common.goToCanvas": "进入画布",
    "common.logout": "退出登录",
    "admin.menus.memberManagement": "成员管理",
    "admin.menus.contentManagement": "内容管理",
    "admin.menus.siteManagement": "站点管理",
    "admin.menus.operationsManagement": "运维管理",
    "admin.menus.enterprises": "企业管理",
    "admin.menus.users": "用户管理",
    "admin.menus.creditLogs": "算力点日志",
    "admin.menus.generationTasks": "使用日志",
    "admin.menus.canvasNodes": "画布节点信息",
    "admin.menus.prompts": "提示词管理",
    "admin.menus.assets": "素材库",
    "admin.menus.assetsManagement": "素材库管理",
    "admin.menus.volcengineAssets": "火山引擎资产",
    "admin.menus.brandConfig": "品牌配置",
    "admin.menus.settings": "系统设置",
};

mock.module("react-i18next", () => ({
    initReactI18next: { type: "3rdParty", init: () => undefined },
    useTranslation: () => ({ t: (key: string) => translations[key] || key }),
}));

mock.module("@/components/layout/brand-logo", () => ({
    BrandLogo: () => createElement("span", null, "logo"),
}));

mock.module("@/components/layout/user-status-actions", () => ({
    UserStatusActions: () => createElement("span", null, "actions"),
}));

mock.module("@/stores/use-user-store", () => {
    const state = { token: "token", user: { role: "admin" }, isReady: true, clearSession: () => undefined };
    return { useUserStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

const { default: AdminLayout } = await import("./admin-layout");

test("groups admin navigation into member, content, site, and operations submenus", () => {
    const html = renderToStaticMarkup(createElement(AdminLayout, null, createElement("div", null, "page")));

    assert.match(html, /成员管理.*企业管理.*用户管理/s);
    assert.match(html, /成员管理.*内容管理.*站点管理.*运维管理/s);
    assert.match(html, /内容管理.*提示词管理.*素材库.*火山引擎资产/s);
    assert.match(html, /站点管理.*品牌配置/s);
    assert.match(html, /运维管理.*算力点日志.*使用日志.*画布节点信息.*系统设置/s);

    for (const path of ["/admin/enterprises", "/admin/users", "/admin/prompts", "/admin/assets", "/admin/volcengine-assets", "/admin/brand-config", "/admin/credit-logs", "/admin/generation-tasks", "/admin/canvas-nodes", "/admin/settings"]) {
        assert.match(html, new RegExp(`href="${path}"`));
    }

    assert.match(html, /data-selected="\/admin\/assets"/);
    assert.match(html, /data-open="content-management"/);
});
