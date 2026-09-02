import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { StoryboardRecord } from "./storyboard";
import type { StoryboardRecordSummary } from "./storyboard-storage";

const options = { aspectRatio: "9:16" as const, targetDurationSec: 60, style: "电影叙事", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: false };

function record(id: string, title: string): StoryboardRecord {
    return {
        id,
        title,
        source: `${title}原文`,
        options,
        model: "text-model",
        sourceHash: `sha256:${id}`,
        status: "ready",
        revision: 3,
        directorPlan: null,
        document: null,
        validation: null,
        createdAt: 1,
        updatedAt: 2,
    };
}

function summary(value: StoryboardRecord): StoryboardRecordSummary {
    return {
        id: value.id,
        title: value.title,
        source: value.source,
        options: value.options,
        model: value.model,
        sourceHash: value.sourceHash,
        status: value.status,
        revision: value.revision,
        validationStatus: "passed",
        sceneCount: 0,
        shotCount: 0,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

let accountId = "user-1";
let listRecords: () => Promise<StoryboardRecordSummary[]> = async () => [summary(record("project-1", "项目一")), summary(record("project-2", "项目二"))];
let loadRecord: (id: string) => Promise<StoryboardRecord> = async (id) => record(id, id === "project-1" ? "项目一详情" : "项目二详情");
const calls: string[] = [];
const panelProjects: Array<StoryboardRecord | null> = [];
const adminTextSettings = {
    modelChannel: {
        availableModels: ["admin-text-model", "admin-alt-model"],
        modelCosts: [
            { model: "admin-text-model", displayName: "管理员文本" },
            { model: "admin-alt-model", displayName: "管理员备选" },
        ],
        imageRequestFormats: [],
        defaultModel: "admin-text-model",
        defaultImageModel: "",
        defaultVideoModel: "",
        defaultTextModel: "admin-text-model",
        defaultAudioModel: "",
        imageModels: [],
        videoModels: [],
        textModels: ["admin-text-model", "admin-alt-model"],
        textModelProtocols: { "admin-text-model": "openai", "admin-alt-model": "xvanai" },
        audioModels: [],
        systemPrompt: "",
        allowCustomChannel: false,
    },
    auth: { allowRegister: true, linuxDo: { enabled: false } },
};

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: accountId } }) }));
mock.module("@/services/api/settings", () => ({ fetchPublicSettings: async () => structuredClone(adminTextSettings) }));
mock.module("./storyboard-storage", () => ({
    listStoryboardRecords: async () => {
        calls.push(`list:${accountId}`);
        return listRecords();
    },
    loadStoryboardRecord: async (id: string) => {
        calls.push(`load:${id}`);
        return loadRecord(id);
    },
}));
mock.module("./brainstorm-agent-panel", () => ({
    BrainstormAgentPanel: ({ project, model, disabled = false, onActiveChange, onProjectUpdated }: { project: StoryboardRecord | null; model?: string; disabled?: boolean; onActiveChange?: (active: boolean) => void; onProjectUpdated?: () => void }) => {
        panelProjects.push(project);
        return (
            <div data-testid="brainstorm-agent-panel" data-disabled={String(disabled)} data-model={model || ""}>
                脑暴 Agent · {project?.title || "独立脑暴工作区"}
                <button type="button" onClick={() => onActiveChange?.(true)}>
                    开始运行
                </button>
                <button type="button" onClick={() => onProjectUpdated?.()}>
                    更新项目
                </button>
            </div>
        );
    },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrainstormAgentStudio } = await import("./brainstorm-agent-studio");
mock.restore();

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function mount() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<BrainstormAgentStudio />));
    await flush();
    return { container, root };
}

async function selectModel(container: ParentNode, value: string) {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="脑暴模型"]');
    assert.ok(select);
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    return select;
}

async function selectProject(container: ParentNode, value: string) {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]');
    assert.ok(select);
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    return select;
}

function button(container: ParentNode, label: string) {
    const item = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((element) => element.textContent?.includes(label));
    assert.ok(item, `未找到按钮：${label}`);
    return item;
}

async function cleanup(container: HTMLElement, root: ReturnType<typeof createRoot>) {
    await act(async () => root.unmount());
    container.remove();
}

test("Studio 展示管理员文本模型并将用户选择传给 Brainstorm Panel", async () => {
    calls.length = 0;
    panelProjects.length = 0;
    accountId = "user-1";
    listRecords = async () => [];

    const { container, root } = await mount();
    const layout = container.querySelector(".brainstorm-agent-layout");
    assert.ok(layout);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="脑暴模型"]');
    assert.ok(select);
    assert.equal(select.value, "admin-text-model");
    assert.match(select.querySelector('option[value="admin-text-model"]')?.textContent || "", /管理员文本/);
    assert.match(select.querySelector('option[value="admin-alt-model"]')?.textContent || "", /管理员备选/);
    assert.equal(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.getAttribute("data-model"), "admin-text-model");

    await selectModel(container, "admin-alt-model");
    assert.equal(select.value, "admin-alt-model");
    assert.equal(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.getAttribute("data-model"), "admin-alt-model");

    await act(async () => button(container, "开始运行").click());
    assert.equal(select.disabled, true);
    await cleanup(container, root);
});

test("Studio 默认展示独立脑暴并异步加载可选项目摘要，不自动加载项目", async () => {
    calls.length = 0;
    panelProjects.length = 0;
    accountId = "user-1";
    listRecords = async () => [summary(record("project-1", "项目一"))];

    const { container, root } = await mount();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]');
    assert.ok(select);
    assert.equal(select.value, "");
    assert.equal(select.options[0]?.textContent, "独立脑暴（不绑定分镜）");
    assert.match(container.textContent || "", /独立脑暴工作区/);
    assert.deepEqual(calls, ["list:user-1"]);
    assert.deepEqual(panelProjects.at(-1), null);

    await cleanup(container, root);
});

test("Studio 选择项目后加载详情并传给面板，清空后回到 standalone", async () => {
    calls.length = 0;
    panelProjects.length = 0;
    accountId = "user-1";
    listRecords = async () => [summary(record("project-1", "项目一")), summary(record("project-2", "项目二"))];
    loadRecord = async (id) => record(id, id === "project-1" ? "项目一详情" : "项目二详情");

    const { container, root } = await mount();
    const select = await selectProject(container, "project-2");
    assert.equal(select.value, "project-2");
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /项目二详情/);
    assert.deepEqual(calls, ["list:user-1", "load:project-2"]);

    await selectProject(container, "");
    assert.equal(select.value, "");
    assert.deepEqual(panelProjects.at(-1), null);
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /独立脑暴工作区/);

    await cleanup(container, root);
});

test("Studio 脑暴活动时锁定项目选择器", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => [summary(record("project-1", "项目一")), summary(record("project-2", "项目二"))];
    loadRecord = async (id) => record(id, "项目详情");

    const { container, root } = await mount();
    const select = await selectProject(container, "project-1");
    await act(async () => button(container, "开始运行").click());
    assert.equal(select.disabled, true);
    assert.equal(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.getAttribute("data-disabled"), "false");

    await cleanup(container, root);
});

test("Studio 项目更新后重载详情并同步标题", async () => {
    calls.length = 0;
    accountId = "user-1";
    let loadCount = 0;
    const refresh = deferred<StoryboardRecord>();
    listRecords = async () => [summary(record("project-1", "项目一"))];
    loadRecord = async (id) => (loadCount++ === 0 ? record(id, "更新前详情") : refresh.promise);

    const { container, root } = await mount();
    await selectProject(container, "project-1");
    await act(async () => button(container, "更新项目").click());
    await flush();

    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /更新前详情/);
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]')?.disabled, true);

    refresh.resolve(record("project-1", "更新后详情"));
    await flush();
    assert.deepEqual(calls, ["list:user-1", "load:project-1", "load:project-1"]);
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /更新后详情/);
    assert.equal(container.querySelector<HTMLOptionElement>('option[value="project-1"]')?.textContent?.trim(), "更新后详情");

    await cleanup(container, root);
});

test("Studio 后台项目重载失败时保留当前面板并可重试", async () => {
    calls.length = 0;
    accountId = "user-1";
    let loadCount = 0;
    listRecords = async () => [summary(record("project-1", "项目一"))];
    loadRecord = async (id) => {
        if (loadCount++ === 0) return record(id, "当前项目");
        if (loadCount === 2) throw new Error("network failed");
        return record(id, "恢复后的项目");
    };

    const { container, root } = await mount();
    await selectProject(container, "project-1");
    await act(async () => button(container, "更新项目").click());
    await flush();

    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /当前项目/);
    assert.match(container.textContent || "", /分镜项目加载失败/);

    await act(async () => button(container, "重新加载").click());
    await flush();
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /恢复后的项目/);
    assert.doesNotMatch(container.textContent || "", /分镜项目加载失败/);

    await cleanup(container, root);
});

test("Studio 项目摘要加载失败时仍显示独立面板并可重试", async () => {
    calls.length = 0;
    accountId = "user-1";
    let attempts = 0;
    listRecords = async () => {
        if (attempts++ === 0) throw new Error("network failed");
        return [summary(record("project-1", "恢复后的项目"))];
    };

    const { container, root } = await mount();
    assert.match(container.textContent || "", /历史记录加载失败/);
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /独立脑暴工作区/);

    await act(async () => button(container, "重新加载").click());
    await flush();
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]')?.value, "");
    assert.match(container.querySelector('option[value="project-1"]')?.textContent || "", /恢复后的项目/);
    assert.deepEqual(calls, ["list:user-1", "list:user-1"]);

    await cleanup(container, root);
});

test("Studio 账号切换后隔离旧账号迟到的项目详情", async () => {
    calls.length = 0;
    panelProjects.length = 0;
    accountId = "user-1";
    const stale = deferred<StoryboardRecord>();
    listRecords = async () => {
        const value = accountId === "user-1" ? record("project-1", "账号一项目") : record("project-2", "账号二项目");
        return [summary(value)];
    };
    loadRecord = async (id) => (id === "project-1" ? stale.promise : record(id, "账号二详情"));

    const { container, root } = await mount();
    await selectProject(container, "project-1");

    accountId = "user-2";
    await act(async () => root.render(<BrainstormAgentStudio />));
    await flush();
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]')?.value, "");
    assert.match(container.querySelector('[data-testid="brainstorm-agent-panel"]')?.textContent || "", /独立脑暴工作区/);

    stale.resolve(record("project-1", "迟到的账号一详情"));
    await flush();
    assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="脑暴项目"]')?.value, "");
    assert.doesNotMatch(container.textContent || "", /迟到的账号一详情/);
    assert.deepEqual(calls, ["list:user-1", "load:project-1", "list:user-2"]);

    await cleanup(container, root);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
