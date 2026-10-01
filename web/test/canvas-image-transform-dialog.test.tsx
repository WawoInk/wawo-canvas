import "./register-dom";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import i18n from "../src/i18n";
import { CanvasNodeCropDialog } from "../src/pages/canvas/components/canvas-node-crop-dialog";
import { CanvasNodeUpscaleDialog } from "../src/pages/canvas/components/canvas-node-upscale-dialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
await i18n.changeLanguage("zh-CN");

class TestImage {
    naturalWidth = 400;
    naturalHeight = 200;
    onload?: () => void;
    set src(_value: string) {
        queueMicrotask(() => this.onload?.());
    }
}

function deferred() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function renderDialog(kind: "crop" | "upscale", onConfirm: () => Promise<void>) {
    const OriginalImage = globalThis.Image;
    globalThis.Image = TestImage as any;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    const Dialog = kind === "crop" ? CanvasNodeCropDialog : CanvasNodeUpscaleDialog;
    await act(async () => root.render(<Dialog dataUrl="data:image/png;base64,aW1hZ2U=" open onClose={() => closed++} onConfirm={onConfirm} />));
    return {
        get closed() {
            return closed;
        },
        button() {
            const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(i18n.t(kind === "crop" ? "canvas.crop.confirm" : "canvas.upscale.generate")));
            assert.ok(button);
            return button;
        },
        async unmount() {
            await act(async () => root.unmount());
            host.remove();
            globalThis.Image = OriginalImage;
        },
    };
}

async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

test("crop confirmation stays busy and prevents repeat submissions or dismissal until saved", async () => {
    const task = deferred();
    let submissions = 0;
    const dialog = await renderDialog("crop", () => {
        submissions++;
        return task.promise;
    });
    try {
        const button = dialog.button();
        await click(button);
        assert.equal(button.disabled, true);
        assert.ok(document.querySelector('[aria-busy="true"]'));
        assert.equal(document.querySelector(".ant-modal-close"), null);
        await click(button);
        await click(document.querySelector(".ant-modal-wrap")!);
        assert.equal(submissions, 1);
        assert.equal(dialog.closed, 0);
        await act(async () => task.resolve());
        assert.equal(dialog.button().disabled, false);
    } finally {
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});

test("upscale confirmation stays busy and prevents repeat submissions or dismissal until saved", async () => {
    const task = deferred();
    let submissions = 0;
    const dialog = await renderDialog("upscale", () => {
        submissions++;
        return task.promise;
    });
    try {
        const button = dialog.button();
        await click(button);
        assert.equal(button.disabled, true);
        assert.ok(document.querySelector('[aria-busy="true"]'));
        assert.equal(document.querySelector(".ant-modal-close"), null);
        await click(button);
        await click(document.querySelector(".ant-modal-wrap")!);
        assert.equal(submissions, 1);
        assert.equal(dialog.closed, 0);
        await act(async () => task.resolve());
        assert.equal(dialog.button().disabled, false);
    } finally {
        await act(async () => task.resolve());
        await dialog.unmount();
    }
});

for (const kind of ["crop", "upscale"] as const) {
    test(`${kind} displays upload errors and allows retry without dismissing the dialog`, async () => {
        let task = deferred();
        const dialog = await renderDialog(kind, () => task.promise);
        try {
            await click(dialog.button());
            await act(async () => task.reject(new Error("上传失败，请重试")));
            assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes("上传失败，请重试"));
            assert.equal(dialog.closed, 0);
            assert.equal(dialog.button().disabled, false);
            task = deferred();
            await click(dialog.button());
            assert.equal(document.querySelector('[role="alert"]'), null);
            assert.equal(dialog.button().disabled, true);
            await act(async () => task.resolve());
            assert.equal(dialog.button().disabled, false);
        } finally {
            await act(async () => task.resolve());
            await dialog.unmount();
        }
    });

    test(`${kind} prevents canvas delete shortcuts while the image is being saved`, async () => {
        const task = deferred();
        const dialog = await renderDialog(kind, () => task.promise);
        let deletions = 0;
        const shortcut = (event: KeyboardEvent) => {
            if (event.key === "Delete") deletions++;
        };
        window.addEventListener("keydown", shortcut);
        try {
            await click(dialog.button());
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", cancelable: true }));
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
}
