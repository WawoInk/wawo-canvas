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

test("pixel width and height update the crop preview", async () => {
    const confirmed: Array<{ x: number; y: number; width: number; height: number }> = [];
    const dialog = await renderDialog((crop) => confirmed.push(crop));
    try {
        const sizeFields = required(document.querySelector<HTMLElement>(`[role="group"][aria-label="裁剪尺寸"]`));
        assert.equal(sizeFields.querySelectorAll("input").length, 2);
        assert.ok(sizeFields.textContent?.includes(":"));

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

test("ratio fields reshape the crop from the original image dimensions", async () => {
    const dialog = await renderDialog(() => {});
    try {
        const ratioFields = required(document.querySelector<HTMLElement>(`[role="group"][aria-label="裁剪比例"]`));
        assert.equal(ratioFields.querySelectorAll("input").length, 2);
        assert.ok(ratioFields.textContent?.includes(":"));

        await changeInput(input("裁剪宽度"), "800");
        await changeInput(input("裁剪高度"), "600");
        assert.equal(input("裁剪宽比例").value, "4");
        assert.equal(input("裁剪高比例").value, "3");

        await changeInput(input("裁剪宽比例"), "");
        await changeInput(input("裁剪高比例"), "");
        await changeInput(input("裁剪宽比例"), "16");
        await changeInput(input("裁剪高比例"), "9");

        assert.equal(input("裁剪宽比例").value, "16");
        assert.equal(input("裁剪高比例").value, "9");
        assert.equal(input("裁剪宽度").value, "1600");
        assert.equal(input("裁剪高度").value, "900");
        assert.equal(cropFrame().style.width, "100%");
        assert.equal(cropFrame().style.height, "100%");
    } finally {
        await dialog.unmount();
    }
});

test("resizing the crop frame updates pixel and ratio fields in real time", async () => {
    const dialog = await renderDialog(() => {});
    try {
        const frame = cropFrame();
        const box = required(frame.parentElement);
        Object.defineProperty(box, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON() {} }),
        });
        const handles = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[aria-label="调整裁剪框"]`));
        assert.equal(handles.length, 8);

        await act(async () => {
            handles[4].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
            document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: -16, clientY: 216 }));
            document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        });

        assert.equal(input("裁剪宽度").value, "1200");
        assert.equal(input("裁剪高度").value, "900");
        assert.equal(input("裁剪宽比例").value, "4");
        assert.equal(input("裁剪高比例").value, "3");
        assert.equal(frame.style.width, "75%");
        assert.equal(frame.style.height, "100%");
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
