import "./register-dom";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import i18n from "../src/i18n";
import { CanvasNodeSplitDialog } from "../src/pages/canvas/components/canvas-node-split-dialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
await i18n.changeLanguage("zh-CN");

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function renderDialog(onConfirm: React.ComponentProps<typeof CanvasNodeSplitDialog>["onConfirm"]) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    await act(async () => root.render(<CanvasNodeSplitDialog dataUrl="data:image/png;base64,aW1hZ2U=" open onClose={() => closed++} onConfirm={onConfirm} />));
    return { get closed() { return closed; }, async unmount() { await act(async () => root.unmount()); host.remove(); } };
}

function generate() {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("生成子节点"));
    assert.ok(button);
    return button;
}

async function click(element: Element) {
    await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

test("confirming a split blocks duplicate submissions, editing and dismissal until it finishes", async () => {
    const task = deferred();
    let submissions = 0;
    const dialog = await renderDialog(() => { submissions++; return task.promise; });
    try {
        const button = generate();
        await click(button);
        assert.equal(button.disabled, true);
        assert.ok([...document.querySelectorAll("input")].every((input) => input.disabled));
        assert.equal(document.querySelector(".ant-modal-close"), null);
        const wrap = document.querySelector(".ant-modal-wrap")!;
        await click(wrap);
        await act(async () => { wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })); });
        await click(button);
        assert.equal(dialog.closed, 0);
        assert.equal(submissions, 1);
        await act(async () => task.resolve());
        assert.equal(generate().disabled, false);
    } finally {
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});

test("split progress shows preparation then the number of durably saved pieces", async () => {
    const task = deferred();
    let report!: (completed: number) => void;
    const dialog = await renderDialog((_params, onProgress) => { report = onProgress; return task.promise; });
    try {
        await click(generate());
        assert.ok(document.body.textContent?.includes("正在切图"));
        await act(async () => report(0));
        assert.ok(document.body.textContent?.includes("正在保存"));
        await act(async () => report(2));
        const progress = document.querySelector('[role="progressbar"]');
        assert.ok(progress);
        assert.equal(progress.getAttribute("aria-valuenow"), "50");
        assert.ok(document.body.textContent?.includes("已保存 2 / 4"));
        assert.equal(generate().disabled, true);
        await act(async () => task.resolve());
        assert.equal(document.querySelector('[role="progressbar"]'), null);
    } finally {
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});

test("a failed split displays the error, unlocks the dialog and can be retried", async () => {
    let task = deferred();
    const dialog = await renderDialog(() => task.promise);
    try {
        await click(generate());
        await act(async () => task.reject(new Error("上传失败，请重试")));
        assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes("上传失败，请重试"));
        assert.equal(generate().disabled, false);
        assert.ok(document.querySelector(".ant-modal-close"));
        task = deferred();
        await click(generate());
        assert.equal(document.querySelector('[role="alert"]'), null);
        assert.equal(generate().disabled, true);
        await act(async () => task.resolve());
        assert.equal(generate().disabled, false);
    } finally {
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});

test("canvas keyboard shortcuts do not receive keys while splitting", async () => {
    const task = deferred();
    const dialog = await renderDialog(() => task.promise);
    let deletions = 0;
    const shortcut = (event: KeyboardEvent) => { if (event.key === "Delete") deletions++; };
    window.addEventListener("keydown", shortcut);
    try {
        await click(generate());
        await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
        assert.equal(deletions, 0);
        await act(async () => task.resolve());
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
        assert.equal(deletions, 1);
    } finally {
        window.removeEventListener("keydown", shortcut);
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});
