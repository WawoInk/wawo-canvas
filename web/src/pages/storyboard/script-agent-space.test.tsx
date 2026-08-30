import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";
import type { ScriptAgentProjectSummary } from "./script-agent-storage";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ScriptAgentSpace } = await import("./script-agent-space");

const project: ScriptAgentProjectSummary = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "一名记者在雾城调查连环失踪案。",
    currentStage: "collecting_config",
    version: 3,
    revision: 4,
    createdAt: "2026-08-30T07:00:00.000Z",
    updatedAt: "2026-08-30T08:00:00.000Z",
};

function click(element: Element) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(text: string) {
    const matched = [...document.querySelectorAll("button")].filter((item) => item.textContent?.replace(/\s/g, "") === text);
    assert.ok(matched.length, `未找到按钮：${text}`);
    return matched.at(-1)!;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
    });
}

test("空剧本空间可以通过表单创建剧本", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const created: Array<[string, string]> = [];

    await act(async () =>
        root.render(
            <App>
                <ScriptAgentSpace projects={[]} onCreate={(title, source) => created.push([title, source])} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );

    assert.match(container.textContent || "", /剧本空间/);
    assert.match(container.textContent || "", /还没有剧本/);

    await act(async () => click(button("创建剧本")));
    const title = document.querySelector<HTMLInputElement>('input[aria-label="剧本名称"]');
    const source = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="原作素材"]');
    assert.ok(title);
    assert.ok(source);

    await act(async () => {
        input(title, "深海回声");
        input(source, "潜艇收到来自未来的求救信号。");
    });
    await act(async () => click(button("创建")));
    await flush();

    assert.equal(JSON.stringify(created), JSON.stringify([["深海回声", "潜艇收到来自未来的求救信号。"]]));

    await act(async () => root.unmount());
    container.remove();
});

test("剧本卡片支持进入、重命名和二次确认删除", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const opened: string[] = [];
    const renamed: Array<[string, string]> = [];
    const deleted: string[] = [];

    await act(async () =>
        root.render(
            <App>
                <ScriptAgentSpace projects={[project]} onCreate={() => {}} onOpen={(projectId) => opened.push(projectId)} onRename={(projectId, title) => renamed.push([projectId, title])} onDelete={(projectId) => deleted.push(projectId)} />
            </App>,
        ),
    );

    assert.match(container.textContent || "", /雾城追凶/);
    assert.match(container.textContent || "", /版本 3/);
    await act(async () => click(button("进入剧本")));
    assert.deepEqual(opened, ["project-1"]);

    const rename = document.querySelector('button[aria-label="重命名《雾城追凶》"]');
    assert.ok(rename);
    await act(async () => click(rename));
    const title = document.querySelector<HTMLInputElement>('input[aria-label="剧本名称"]');
    assert.ok(title);
    assert.equal(title.value, "雾城追凶");
    await act(async () => input(title, "雾城来信"));
    await act(async () => click(button("保存")));
    await flush();
    assert.deepEqual(renamed, [["project-1", "雾城来信"]]);

    const remove = document.querySelector('button[aria-label="删除《雾城追凶》"]');
    assert.ok(remove);
    await act(async () => click(remove));
    assert.match(document.body.textContent || "", /删除后将无法恢复/);
    assert.deepEqual(deleted, []);
    await act(async () => click(button("删除")));
    await flush();
    assert.deepEqual(deleted, ["project-1"]);

    await act(async () => root.unmount());
    container.remove();
});

test("创建剧本时原作素材可以稍后补充", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const created: Array<[string, string]> = [];

    await act(async () =>
        root.render(
            <App>
                <ScriptAgentSpace projects={[]} onCreate={(title, source) => created.push([title, source])} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );
    await act(async () => click(button("创建剧本")));
    const title = document.querySelector<HTMLInputElement>('input[aria-label="剧本名称"]');
    assert.ok(title);
    await act(async () => input(title, "空白项目"));
    await act(async () => click(button("创建")));
    await flush();
    assert.deepEqual(created, [["空白项目", ""]]);

    await act(async () => root.unmount());
    container.remove();
});
