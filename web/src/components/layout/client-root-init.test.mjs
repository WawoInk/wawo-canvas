import "../../../test/register-dom.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";
import { App } from "antd";
import axios from "axios";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";

import enUS from "@/i18n/locales/en-US.json";
import zhCN from "@/i18n/locales/zh-CN.json";

const { ClientRootInit, seoPage } = await import("./client-root-init.tsx");

test("剧本 Agent 路由使用正确的浏览器标题", () => {
    for (const pathname of ["/storyboard/script-agent", "/storyboard/script-agent/project-1"]) {
        const page = seoPage(pathname);
        assert.equal(page, "scriptAgent");
        assert.equal(zhCN.seo.pages[page].title, "剧本 Agent | Canvan");
        assert.equal(enUS.seo.pages[page].title, "Script Agent | Canvan");
    }
});

test("脑暴 Agent 路由沿用分镜创作室浏览器标题", () => {
    const page = seoPage("/storyboard/brainstorm-agent");
    assert.equal(page, "storyboard");
    assert.equal(zhCN.seo.pages[page].title, "分镜创作室 | Canvan");
    assert.equal(enUS.seo.pages[page].title, "Storyboard Studio | Canvan");
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
const adapter = axios.defaults.adapter;
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = undefined;
    host?.remove();
    axios.defaults.adapter = adapter;
});

async function mountImport(search, publicSettings = null, configHydrated = true, children) {
    window.history.replaceState({ usr: { kept: true } }, "", `/login?${search}#keep`);
    useConfigStore.setState({ config: { ...defaultConfig, channelMode: "remote" }, configHydrated, publicSettings, isConfigOpen: false });
    // Hold the external settings response to exercise the unresolved platform gate.
    axios.defaults.adapter = () => new Promise(() => {});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(StrictMode, null, createElement(BrowserRouter, null, createElement(App, null, createElement(ClientRootInit, null, children))))));
}

test("credential parameters are scrubbed before platform settings arrive, without opening custom configuration", async () => {
    await mountImport("baseUrl=https%3A%2F%2Fprovider.example&apiKey=secret&baseurl=other&apikey=other-secret&keep=yes");
    assert.equal(window.location.search, "?keep=yes");
    assert.equal(window.location.hash, "#keep");
    assert.deepEqual(window.history.state.usr, { kept: true });
    assert.deepEqual(useConfigStore.getState().config, { ...defaultConfig, channelMode: "remote" });
    assert.equal(useConfigStore.getState().isConfigOpen, false);
});

test("import waits for hydrated channels and updates the saved match using scrubbed credentials only once", async () => {
    await mountImport("baseurl=https%3A%2F%2Fprovider.example%2Fv1&apikey=new-key", { modelChannel: { allowCustomChannel: true } }, false);
    assert.equal(window.location.search, "");
    assert.deepEqual(useConfigStore.getState().config, { ...defaultConfig, channelMode: "remote" });
    const savedChannel = { id: "saved", name: "已保存", baseUrl: "https://provider.example", apiKey: "saved-key", apiFormat: "gemini", models: ["saved-model"] };
    await act(async () => useConfigStore.setState({ config: { ...defaultConfig, channels: [...defaultConfig.channels, savedChannel] }, configHydrated: true }));
    const expected = { ...defaultConfig, channels: [...defaultConfig.channels, { ...savedChannel, baseUrl: "https://provider.example/v1", apiKey: "new-key" }] };
    assert.deepEqual(useConfigStore.getState().config, expected);
    await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: true } }, config: { ...expected, channels: [...defaultConfig.channels, savedChannel] } }));
    assert.deepEqual(useConfigStore.getState().config.channels, [...defaultConfig.channels, savedChannel]);
});

test("a delayed platform denial discards credentials and never opens the custom-channel dialog", async () => {
    await mountImport("baseUrl=https%3A%2F%2Fprovider.example&apiKey=blocked");
    const before = useConfigStore.getState().config;
    await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: false } } }));
    assert.equal(window.location.search, "");
    assert.equal(useConfigStore.getState().config, before);
    assert.equal(useConfigStore.getState().isConfigOpen, false);
    await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: true } } }));
    assert.equal(useConfigStore.getState().config, before);
    assert.equal(useConfigStore.getState().isConfigOpen, false);
});

test("allowed imports append one channel after settings arrive without switching away from remote generation", async () => {
    await mountImport("baseUrl=https%3A%2F%2Fapi.new.example%2Fv1&apiKey=new-key");
    await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: true } } }));
    const config = useConfigStore.getState().config;
    const added = config.channels[1];
    assert.deepEqual(config, { ...defaultConfig, channelMode: "remote", channels: [...defaultConfig.channels, { id: added.id, name: "new.example", baseUrl: "https://api.new.example/v1", apiKey: "new-key", apiFormat: "openai", models: [] }] });
    assert.equal(useConfigStore.getState().isConfigOpen, true);
    await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: true } } }));
    assert.equal(useConfigStore.getState().config, config);
});

test("invalid, key-only and empty credential URLs are scrubbed without configuration changes or a dialog", async () => {
    for (const search of ["baseUrl=invalid&apiKey=secret", "apikey=secret", "baseUrl=&apiKey="]) {
        await mountImport(search, { modelChannel: { allowCustomChannel: true } });
        assert.equal(window.location.search, "");
        assert.deepEqual(useConfigStore.getState().config, { ...defaultConfig, channelMode: "remote" });
        assert.equal(useConfigStore.getState().isConfigOpen, false);
        await act(async () => root.unmount());
        root = undefined;
        host.remove();
    }
});

function QueryNavigation() {
    const location = useLocation();
    const navigate = useNavigate();
    return createElement(
        "div",
        null,
        createElement(LanguageSwitcher),
        createElement("output", { "data-router-query": true }, location.search),
        createElement("button", { "data-keep-query": true, onClick: () => navigate({ pathname: "/login", search: location.search, hash: location.hash }, { state: location.state }) }, "保留查询参数导航"),
    );
}

test("language switching and query-preserving navigation cannot resurrect scrubbed credentials", async () => {
    const language = i18n.language;
    await i18n.changeLanguage("zh-CN");
    try {
        const historyLength = window.history.length;
        await mountImport("baseUrl=https%3A%2F%2Fprovider.example&apiKey=secret&baseurl=other&apikey=other-secret&keep=yes", null, true, createElement(QueryNavigation));
        const before = useConfigStore.getState().config;
        assert.equal(window.history.length, historyLength);
        assert.deepEqual(window.history.state.usr, { kept: true });
        assert.equal(window.location.search, "?keep=yes");
        assert.equal(host.querySelector("[data-router-query]").textContent, "?keep=yes");
        await act(async () => host.querySelector("button[aria-label]").click());
        const english = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent.includes("English"));
        assert.ok(english, "真实语言切换菜单提供 English 选项");
        await act(async () => english.click());
        assert.equal(window.location.pathname, "/en-US/login");
        assert.equal(window.location.search, "?keep=yes");
        assert.equal(host.querySelector("[data-router-query]").textContent, "?keep=yes");
        assert.equal(window.location.hash, "#keep");
        await act(async () => host.querySelector("[data-keep-query]").click());
        assert.equal(window.location.pathname, "/login");
        assert.equal(window.location.search, "?keep=yes");
        await act(async () => useConfigStore.setState({ publicSettings: { modelChannel: { allowCustomChannel: false } } }));
        assert.equal(useConfigStore.getState().config, before);
        assert.equal(useConfigStore.getState().isConfigOpen, false);
    } finally {
        await act(async () => i18n.changeLanguage(language));
    }
});
