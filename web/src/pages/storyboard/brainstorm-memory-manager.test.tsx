import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";
import type { StoryboardMemory, StoryboardMemoryPage, UpdateStoryboardMemoryInput } from "@/services/api/storyboard-brainstorm";

if (typeof window === "undefined") GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PageQuery = { page?: number; pageSize?: number };

const memory = (id: string, overrides: Partial<StoryboardMemory> = {}): StoryboardMemory => ({
    id,
    projectId: "project-1",
    kind: "constraint",
    scope: "scene",
    path: "scene-1",
    content: `内容-${id}`,
    tags: ["悬疑", "雨夜"],
    sourceMessageId: "message-1",
    operationId: "operation-1",
    createdAt: "2026-08-30T07:00:00.000Z",
    updatedAt: "2026-08-30T08:00:00.000Z",
    ...overrides,
});

const fetchCalls: Array<[string, PageQuery]> = [];
const updateCalls: Array<[string, string, UpdateStoryboardMemoryInput]> = [];
const deleteCalls: Array<[string, string]> = [];
let fetchMemories: (projectId: string, query: PageQuery) => Promise<StoryboardMemoryPage> = async () => ({ items: [], total: 0 });
let updateMemory: (projectId: string, memoryId: string, input: UpdateStoryboardMemoryInput) => Promise<StoryboardMemory> = async (_projectId, memoryId, input) => memory(memoryId, input);
let deleteMemory: (projectId: string, memoryId: string) => Promise<{ id: string; deletedAt: string }> = async (_projectId, memoryId) => ({ id: memoryId, deletedAt: "now" });

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/services/api/storyboard-brainstorm", () => ({
    fetchStoryboardMemories: (projectId: string, query: PageQuery) => {
        fetchCalls.push([projectId, query]);
        return fetchMemories(projectId, query);
    },
    updateStoryboardMemory: (projectId: string, memoryId: string, input: UpdateStoryboardMemoryInput) => {
        updateCalls.push([projectId, memoryId, input]);
        return updateMemory(projectId, memoryId, input);
    },
    deleteStoryboardMemory: (projectId: string, memoryId: string) => {
        deleteCalls.push([projectId, memoryId]);
        return deleteMemory(projectId, memoryId);
    },
}));

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrainstormMemoryManager } = await import("./brainstorm-memory-manager");
mock.restore();

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function click(element: Element) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(label: string) {
    const matched = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.replace(/\s/g, "") === label);
    assert.ok(matched.length, `未找到按钮：${label}`);
    return matched.at(-1)!;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function mount(projectId = "project-1", refreshKey?: number, standalone = false) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId={projectId} refreshKey={refreshKey} standalone={standalone} />
            </App>,
        ),
    );
    return { container, root };
}

test("加载全部已确认 Memory，并明确候选只能经 Tool 审批保存", async () => {
    fetchCalls.length = 0;
    fetchMemories = async (_projectId, query) => (query.page === 1 ? { items: [memory("memory-1")], total: 2 } : { items: [memory("memory-2", { scope: "shot", path: "shot-8", kind: "character", content: "主角害怕深水", tags: ["角色"] })], total: 2 });

    const { container, root } = await mount();
    await flush();

    assert.deepEqual(fetchCalls, [
        ["project-1", { page: 1, pageSize: 500 }],
        ["project-1", { page: 2, pageSize: 500 }],
    ]);
    assert.match(container.textContent || "", /Memory 候选必须在 Tool 审批卡中确认后才保存/);
    assert.match(container.textContent || "", /constraint/);
    assert.match(container.textContent || "", /场景/);
    assert.match(container.textContent || "", /scene-1/);
    assert.match(container.textContent || "", /悬疑/);
    assert.match(container.textContent || "", /内容-memory-1/);
    assert.match(container.textContent || "", /character/);
    assert.match(container.textContent || "", /镜头/);
    assert.match(container.textContent || "", /shot-8/);
    assert.match(container.textContent || "", /主角害怕深水/);
    assert.match(container.textContent || "", /更新于/);
    assert.doesNotMatch(container.textContent || "", /新建 Memory/);

    await act(async () => root.unmount());
    container.remove();
});

test("standalone 模式固定脑暴工作区范围并以 project 提交", async () => {
    fetchCalls.length = 0;
    updateCalls.length = 0;
    fetchMemories = async () => ({ items: [memory("memory-standalone", { projectId: "__brainstorm__", scope: "project", path: "", content: "独立创意" })], total: 1 });
    updateMemory = async (_projectId, memoryId, value) => memory(memoryId, { projectId: "__brainstorm__", ...value });

    const { container, root } = await mount("__brainstorm__", undefined, true);
    await flush();

    assert.deepEqual(fetchCalls, [["__brainstorm__", { page: 1, pageSize: 500 }]]);
    assert.match(container.textContent || "", /脑暴工作区/);
    assert.doesNotMatch(container.textContent || "", /场景|镜头|scene-1|shot-8/);

    const edit = container.querySelector('button[aria-label="编辑 Memory memory-standalone"]');
    assert.ok(edit);
    await act(async () => click(edit));
    assert.equal(document.querySelector('input[type="radio"]'), null);
    assert.equal(document.querySelector('input[aria-label="Memory 路径"]'), null);

    const content = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory 内容"]');
    assert.ok(content);
    await act(async () => input(content, "独立创意更新"));
    await act(async () => click(button("保存")));
    await flush();

    assert.deepEqual(updateCalls, [
        [
            "__brainstorm__",
            "memory-standalone",
            {
                kind: "constraint",
                scope: "project",
                path: "",
                content: "独立创意更新",
                tags: ["悬疑", "雨夜"],
                sourceMessageId: "message-1",
                operationId: "operation-1",
            },
        ],
    ]);

    await act(async () => root.unmount());
    container.remove();
});

test("编辑必须显式保存，切换 scope 时不会沿用旧 path", async () => {
    fetchCalls.length = 0;
    updateCalls.length = 0;
    const original = memory("memory-edit");
    fetchMemories = async () => ({ items: [original], total: 1 });
    updateMemory = async (_projectId, memoryId, value) => memory(memoryId, { ...value, updatedAt: "2026-08-31T09:30:00.000Z" });

    const { container, root } = await mount();
    await flush();

    const edit = container.querySelector('button[aria-label="编辑 Memory memory-edit"]');
    assert.ok(edit);
    await act(async () => click(edit));

    const kind = document.querySelector<HTMLInputElement>('input[aria-label="Memory 类型"]');
    const scenePath = document.querySelector<HTMLInputElement>('input[aria-label="Memory 路径"]');
    const tags = document.querySelector<HTMLInputElement>('input[aria-label="Memory 标签"]');
    const content = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory 内容"]');
    const shotScope = document.querySelector<HTMLInputElement>('input[type="radio"][value="shot"]');
    assert.ok(kind && scenePath && tags && content && shotScope);
    assert.equal(scenePath.value, "scene-1");

    await act(async () => click(shotScope));
    const shotPath = document.querySelector<HTMLInputElement>('input[aria-label="Memory 路径"]');
    assert.ok(shotPath);
    assert.equal(shotPath.value, "");
    assert.equal(updateCalls.length, 0);

    await act(async () => {
        input(kind, "character");
        input(shotPath, "shot-9");
        input(tags, "角色, 深水, 角色");
        input(content, "主角在深水中会恐慌");
    });
    assert.equal(updateCalls.length, 0);
    await act(async () => click(button("保存")));
    await flush();

    assert.deepEqual(updateCalls, [
        [
            "project-1",
            "memory-edit",
            {
                kind: "character",
                scope: "shot",
                path: "shot-9",
                content: "主角在深水中会恐慌",
                tags: ["角色", "深水"],
                sourceMessageId: "message-1",
                operationId: "operation-1",
            },
        ],
    ]);
    assert.match(container.textContent || "", /主角在深水中会恐慌/);

    await act(async () => root.unmount());
    container.remove();
});

test("删除必须经过 Popconfirm 确认后才调用服务端", async () => {
    deleteCalls.length = 0;
    fetchMemories = async () => ({ items: [memory("memory-delete")], total: 1 });
    deleteMemory = async (_projectId, memoryId) => ({ id: memoryId, deletedAt: "now" });

    const { container, root } = await mount();
    await flush();

    const remove = container.querySelector('button[aria-label="删除 Memory memory-delete"]');
    assert.ok(remove);
    await act(async () => click(remove));
    assert.deepEqual(deleteCalls, []);
    await act(async () => click(button("删除")));
    await flush();

    assert.deepEqual(deleteCalls, [["project-1", "memory-delete"]]);
    assert.doesNotMatch(container.textContent || "", /内容-memory-delete/);

    await act(async () => root.unmount());
    container.remove();
});

test("projectId 或 refreshKey 变化后忽略旧请求的迟到结果和错误", async () => {
    fetchCalls.length = 0;
    const oldProject = deferred<StoryboardMemoryPage>();
    const oldRefresh = deferred<StoryboardMemoryPage>();
    let newProjectLoads = 0;
    fetchMemories = async (projectId) => {
        if (projectId === "project-old") return oldProject.promise;
        if (projectId === "project-new") {
            newProjectLoads += 1;
            if (newProjectLoads === 1) return { items: [memory("new-project", { projectId, content: "新项目 Memory" })], total: 1 };
            if (newProjectLoads === 2) return oldRefresh.promise;
            return { items: [memory("new-refresh", { projectId, content: "刷新后的 Memory" })], total: 1 };
        }
        return { items: [], total: 0 };
    };

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId="project-old" refreshKey={0} />
            </App>,
        ),
    );
    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId="project-new" refreshKey={0} />
            </App>,
        ),
    );
    await flush();
    assert.match(container.textContent || "", /新项目 Memory/);

    oldProject.resolve({ items: [memory("old-project", { content: "迟到的旧项目 Memory" })], total: 1 });
    await flush();
    assert.doesNotMatch(container.textContent || "", /迟到的旧项目 Memory/);
    assert.match(container.textContent || "", /新项目 Memory/);

    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId="project-new" refreshKey={1} />
            </App>,
        ),
    );
    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId="project-new" refreshKey={2} />
            </App>,
        ),
    );
    await flush();
    assert.match(container.textContent || "", /刷新后的 Memory/);

    oldRefresh.reject(new Error("迟到的旧刷新错误"));
    await flush();
    assert.doesNotMatch(container.textContent || "", /迟到的旧刷新错误/);
    assert.match(container.textContent || "", /刷新后的 Memory/);

    await act(async () => root.unmount());
    container.remove();
});

test("显示 loading、空态和加载错误提示", async () => {
    const pending = deferred<StoryboardMemoryPage>();
    fetchMemories = async () => pending.promise;
    const loading = await mount("project-loading");
    assert.match(loading.container.textContent || "", /正在加载 Memory/);
    pending.resolve({ items: [], total: 0 });
    await flush();
    assert.match(loading.container.textContent || "", /暂无已确认 Memory/);
    await act(async () => loading.root.unmount());
    loading.container.remove();

    fetchMemories = async () => {
        throw new Error("服务端不可用");
    };
    const failed = await mount("project-error");
    await flush();
    assert.match(failed.container.textContent || "", /Memory 加载失败/);
    assert.match(failed.container.textContent || "", /服务端不可用/);
    await act(async () => failed.root.unmount());
    failed.container.remove();
});

test("disabled 时禁止编辑和删除", async () => {
    fetchMemories = async () => ({ items: [memory("memory-disabled")], total: 1 });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId="project-1" disabled />
            </App>,
        ),
    );
    await flush();

    assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="编辑 Memory memory-disabled"]')?.disabled, true);
    assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="删除 Memory memory-disabled"]')?.disabled, true);

    await act(async () => root.unmount());
    container.remove();
});

test("项目切换后旧项目迟到的编辑和删除响应不能污染新项目", async () => {
    const sharedId = "shared-memory";
    const updatePending = deferred<StoryboardMemory>();
    const deletePending = deferred<{ id: string; deletedAt: string }>();
    fetchMemories = async (projectId) => ({ items: [memory(sharedId, { projectId, content: projectId === "project-new" ? "新项目内容" : "旧项目内容" })], total: 1 });
    updateMemory = async () => updatePending.promise;
    deleteMemory = async () => deletePending.promise;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (projectId: string) =>
        root.render(
            <App>
                <BrainstormMemoryManager projectId={projectId} />
            </App>,
        );

    await act(async () => render("project-old"));
    await flush();
    await act(async () => click(container.querySelector('button[aria-label="编辑 Memory shared-memory"]')!));
    const content = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory 内容"]');
    assert.ok(content);
    await act(async () => input(content, "旧项目编辑结果"));
    await act(async () => click(button("保存")));

    await act(async () => render("project-new"));
    await flush();
    assert.match(container.textContent || "", /新项目内容/);
    updatePending.resolve(memory(sharedId, { projectId: "project-old", content: "旧项目编辑结果" }));
    await flush();
    assert.match(container.textContent || "", /新项目内容/);
    assert.doesNotMatch(container.textContent || "", /旧项目编辑结果/);

    await act(async () => render("project-old"));
    await flush();
    await act(async () => click(container.querySelector('button[aria-label="删除 Memory shared-memory"]')!));
    await act(async () => click(button("删除")));
    await act(async () => render("project-new"));
    await flush();
    deletePending.resolve({ id: sharedId, deletedAt: "now" });
    await flush();
    assert.match(container.textContent || "", /新项目内容/);

    await act(async () => root.unmount());
    container.remove();
});
