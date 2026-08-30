import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { StoryboardRecord } from "./storyboard";

const options = { aspectRatio: "9:16" as const, targetDurationSec: 60, style: "电影叙事", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: false };
function record(id: string, title: string): StoryboardRecord {
    return {
        id,
        title,
        source: `${title}原文`,
        options,
        model: "text-model",
        sourceHash: `sha256:${id}`,
        directorPlan: { schemaVersion: "1.0" as const, title, sourceType: "script" as const, scenes: [] },
        document: { schemaVersion: "1.0" as const, title, sourceType: "script" as const, aspectRatio: "9:16" as const, targetDurationSec: 60, scenes: [] },
        validation: { status: "passed" as const, errors: [], warnings: [] },
        createdAt: 1,
        updatedAt: 2,
    };
}

function summary(value: ReturnType<typeof record>) {
    return {
        id: value.id,
        title: value.title,
        source: value.source,
        options: value.options,
        model: value.model,
        sourceHash: value.sourceHash,
        validationStatus: value.validation.status,
        sceneCount: value.document.scenes.length,
        shotCount: value.document.scenes.flatMap((scene) => scene.segments.flatMap((segment) => segment.shots)).length,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

function generatedResult(title: string) {
    const value = record("generated", title);
    return { sourceHash: value.sourceHash, directorPlan: value.directorPlan, document: value.document, validation: value.validation };
}

let accountId = "user-1";
let listRecords = async () => [summary(record("storyboard-1", "账号一"))];
let loadRecord = async (id: string) => record(id, "账号一详情");
let saveRecord = async (value: ReturnType<typeof record>) => value;
let deleteRecord = async (_id: string) => {};
let generate = async (..._args: unknown[]) => generatedResult("生成结果");
const calls: Array<[string, string?]> = [];

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, values?: { defaultValue?: string }) => values?.defaultValue || _key, i18n: { language: "zh-CN" } }) }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: accountId } }) }));
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => ({ textModel: "text-model", model: "text-model" }),
    useConfigStore: (selector: (state: unknown) => unknown) => selector({ updateConfig: () => {}, isAiConfigReady: () => true, openConfigDialog: () => {} }),
}));
mock.module("@/components/model-picker", () => ({ ModelPicker: () => <div /> }));
mock.module("@/services/api/storyboard", () => ({ generateStoryboard: (...args: unknown[]) => generate(...args) }));
mock.module("./storyboard-storage", () => ({
    listStoryboardRecords: async () => {
        calls.push(["list", accountId]);
        return listRecords();
    },
    loadStoryboardRecord: async (id: string) => {
        calls.push(["load", id]);
        return loadRecord(id);
    },
    saveStoryboardRecord: (value: ReturnType<typeof record>) => saveRecord(value),
    deleteStoryboardRecord: (id: string) => {
        calls.push(["delete", id]);
        return deleteRecord(id);
    },
}));

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { StoryboardStudio } = await import("./storyboard-studio");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

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
    await act(async () =>
        root.render(
            <App>
                <StoryboardStudio />
            </App>,
        ),
    );
    await flush();
    return { container, root };
}

test("先加载 PostgreSQL 摘要，再按需加载第一条 S3 详情", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => [summary(record("storyboard-1", "账号一"))];
    loadRecord = async (id) => record(id, "账号一详情");

    const { container, root } = await mount();

    assert.deepEqual(calls, [
        ["list", "user-1"],
        ["load", "storyboard-1"],
    ]);
    assert.equal(container.querySelector<HTMLInputElement>('input[maxlength="100"]')?.value, "账号一详情");

    await act(async () => root.unmount());
    container.remove();
});

test("账号切换后忽略旧账号迟到的详情响应", async () => {
    calls.length = 0;
    accountId = "user-1";
    const stale = deferred<ReturnType<typeof record>>();
    listRecords = async () => [summary(record(accountId === "user-1" ? "storyboard-1" : "storyboard-2", "摘要"))];
    loadRecord = async (id) => (id === "storyboard-1" ? stale.promise : record(id, "账号二详情"));

    const { container, root } = await mount();
    accountId = "user-2";
    await act(async () =>
        root.render(
            <App>
                <StoryboardStudio />
            </App>,
        ),
    );
    await flush();
    stale.resolve(record("storyboard-1", "迟到的账号一详情"));
    await flush();

    assert.equal(container.querySelector<HTMLInputElement>('input[maxlength="100"]')?.value, "账号二详情");

    await act(async () => root.unmount());
    container.remove();
});

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: ParentNode, label: string) {
    const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes(label));
    assert.ok(match);
    return match;
}

test("生成结果只有服务端持久化成功后才进入历史记录", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => [];
    generate = async () => generatedResult("新分镜");
    const pending = deferred<ReturnType<typeof record>>();
    saveRecord = async () => pending.promise;

    const { container, root } = await mount();
    const title = container.querySelector<HTMLInputElement>('input[maxlength="100"]');
    const source = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(title && source);
    await act(async () => {
        setInputValue(title, "新分镜");
        setInputValue(source, "第一场");
    });
    await act(async () => button(container, "生成分镜").click());
    await flush();

    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "0");
    assert.match(container.textContent || "", /0 场 · 0 镜头/);

    pending.resolve(record("storyboard-server-1", "新分镜"));
    await flush();
    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "1");

    await act(async () => root.unmount());
    container.remove();
});

test("删除历史记录要等服务端删除成功后再更新页面", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => [summary(record("storyboard-1", "待删除"))];
    loadRecord = async () => record("storyboard-1", "待删除");
    const pending = deferred<void>();
    deleteRecord = async () => pending.promise;

    const { container, root } = await mount();
    const trigger = container.querySelector<HTMLButtonElement>('aside button[aria-label="删除"]');
    assert.ok(trigger);
    await act(async () => trigger.click());
    await flush();
    const confirm = document.querySelector<HTMLButtonElement>(".ant-popconfirm-buttons .ant-btn-primary");
    assert.ok(confirm);
    await act(async () => confirm.click());
    await flush();

    assert.deepEqual(calls.at(-1), ["delete", "storyboard-1"]);
    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "1");

    pending.resolve();
    await flush();
    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "0");

    await act(async () => root.unmount());
    container.remove();
});

test("服务端保存失败时保留生成结果但不伪造历史记录", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => [];
    generate = async () => generatedResult("未保存分镜");
    saveRecord = async () => {
        throw new Error("save failed");
    };

    const { container, root } = await mount();
    const title = container.querySelector<HTMLInputElement>('input[maxlength="100"]');
    const source = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(title && source);
    await act(async () => {
        setInputValue(title, "未保存分镜");
        setInputValue(source, "第一场");
    });
    await act(async () => button(container, "生成分镜").click());
    await flush();

    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "0");
    assert.match(container.textContent || "", /0 场 · 0 镜头/);

    await act(async () => root.unmount());
    container.remove();
});

test("账号切换后忽略旧账号迟到的保存响应", async () => {
    calls.length = 0;
    accountId = "user-1";
    listRecords = async () => (accountId === "user-1" ? [] : [summary(record("storyboard-2", "账号二"))]);
    loadRecord = async () => record("storyboard-2", "账号二详情");
    generate = async () => generatedResult("账号一生成结果");
    const pending = deferred<ReturnType<typeof record>>();
    saveRecord = async () => pending.promise;

    const { container, root } = await mount();
    const title = container.querySelector<HTMLInputElement>('input[maxlength="100"]');
    const source = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(title && source);
    await act(async () => {
        setInputValue(title, "账号一生成结果");
        setInputValue(source, "第一场");
    });
    await act(async () => button(container, "生成分镜").click());
    await flush();

    accountId = "user-2";
    await act(async () =>
        root.render(
            <App>
                <StoryboardStudio />
            </App>,
        ),
    );
    await flush();
    pending.resolve(record("storyboard-1", "迟到的账号一保存结果"));
    await flush();

    assert.equal(container.querySelector<HTMLInputElement>('input[maxlength="100"]')?.value, "账号二详情");
    assert.equal(container.querySelector("aside .ant-tag")?.textContent, "1");

    await act(async () => root.unmount());
    container.remove();
});
