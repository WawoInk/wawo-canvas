import assert from "node:assert/strict";
import test from "node:test";
import "./register-dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mock } = await import("bun:test");
mock.module("@/lib/image-utils", () => ({
    readImageMeta: async () => ({ width: 1600, height: 900, mimeType: "image/png" }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("@/i18n");
const { CanvasNodeCropDialog } = await import("../src/pages/canvas/components/canvas-node-crop-dialog");
await i18n.changeLanguage("zh-CN");

test("manual crop dimensions update the preview and confirmed crop", async () => {
    const confirmed: Array<{ x: number; y: number; width: number; height: number }> = [];
    const dialog = await renderDialog((crop) => confirmed.push(crop));
    try {
        await changeInput(input("裁剪宽度"), "800");
        await changeInput(input("裁剪高度"), "600");

        assert.equal(input("裁剪宽度").value, "800");
        assert.equal(input("裁剪高度").value, "600");
        assert.equal(cropFrame().style.width, "50%");
        assert.equal(cropFrame().style.height, "66.66666666666666%");

        await click(button("确认裁剪"));
        assert.equal(confirmed.length, 1);
        assertCropClose(confirmed[0], { x: 0.25, y: 1 / 6, width: 0.5, height: 2 / 3 });
    } finally {
        await dialog.unmount();
    }
});

test("manual crop ratio reshapes the preview immediately", async () => {
    const dialog = await renderDialog(() => {});
    try {
        await changeInput(input("裁剪比例"), "1:1");

        assert.equal(input("裁剪宽度").value, "900");
        assert.equal(input("裁剪高度").value, "900");
        assert.equal(cropFrame().style.width, "56.25%");
        assert.equal(cropFrame().style.height, "100%");
    } finally {
        await dialog.unmount();
    }
});

async function renderDialog(onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<CanvasNodeCropDialog dataUrl="data:image/png;base64,source" open onClose={() => {}} onConfirm={onConfirm} />);
        await Promise.resolve();
    });
    return {
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

async function changeInput(target: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
        setter?.call(target, value);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

async function click(target: HTMLButtonElement) {
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function input(label: string) {
    return required(document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`));
}

function cropFrame() {
    return required(document.querySelector<HTMLElement>(`[aria-label="裁剪区域"]`));
}

function button(text: string) {
    return required(Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text)) || null);
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}

function assertCropClose(actual: { x: number; y: number; width: number; height: number }, expected: { x: number; y: number; width: number; height: number }) {
    for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-12, `${key} differs`);
}
