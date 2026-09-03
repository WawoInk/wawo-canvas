import assert from "node:assert/strict";
import test from "node:test";
import "./register-dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mock } = await import("bun:test");
mock.module("@/lib/image-utils", () => ({
    readImageMeta: async () => ({ width: 4, height: 3, mimeType: "image/png" }),
    formatBytes: () => "",
    getDataUrlByteSize: () => 0,
}));

const canvasStates = new WeakMap<HTMLCanvasElement, CanvasState>();

type CanvasOperation = Record<string, unknown>;
type CanvasState = { operations: CanvasOperation[]; pixels: Uint8ClampedArray };

function stateFor(canvas: HTMLCanvasElement) {
    let state = canvasStates.get(canvas);
    const size = canvas.width * canvas.height * 4;
    if (!state) {
        state = { operations: [], pixels: new Uint8ClampedArray(size) };
        canvasStates.set(canvas, state);
    } else if (state.pixels.length !== size) {
        state.pixels = new Uint8ClampedArray(size);
    }
    return state;
}

function setAlpha(state: CanvasState, alpha: number) {
    for (let index = 3; index < state.pixels.length; index += 4) state.pixels[index] = alpha;
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement) {
        const state = stateFor(this);
        if ((state as CanvasState & { context?: CanvasRenderingContext2D }).context) return (state as CanvasState & { context: CanvasRenderingContext2D }).context;
        const context = {
            canvas: this,
            fillStyle: "#000",
            strokeStyle: "#000",
            globalAlpha: 1,
            globalCompositeOperation: "source-over",
            lineCap: "butt",
            lineJoin: "miter",
            lineWidth: 1,
            shadowBlur: 0,
            shadowColor: "transparent",
            beginPath() {},
            moveTo() {},
            lineTo() {},
            arc() {},
            save() {},
            restore() {},
            stroke() {
                setAlpha(state, this.globalCompositeOperation === "destination-out" ? 0 : 255);
                state.operations.push({ op: "stroke", composite: this.globalCompositeOperation, strokeStyle: this.strokeStyle });
            },
            fill() {
                setAlpha(state, this.globalCompositeOperation === "destination-out" ? 0 : 255);
                state.operations.push({ op: "fill", composite: this.globalCompositeOperation, fillStyle: this.fillStyle });
            },
            clearRect() {
                state.pixels.fill(0);
                state.operations.push({ op: "clearRect" });
            },
            fillRect() {
                if (this.globalCompositeOperation !== "source-in") setAlpha(state, this.globalCompositeOperation === "destination-out" ? 0 : 255);
                state.operations.push({ op: "fillRect", composite: this.globalCompositeOperation, fillStyle: this.fillStyle });
            },
            drawImage(source: CanvasImageSource) {
                if (source instanceof HTMLCanvasElement) {
                    const sourceState = stateFor(source);
                    state.pixels.set(sourceState.pixels.slice(0, state.pixels.length));
                    state.operations.push({ op: "drawImage", source: "canvas", sourceOperations: sourceState.operations, globalAlpha: this.globalAlpha });
                } else {
                    setAlpha(state, 255);
                    state.operations.push({ op: "drawImage", source: "image", globalAlpha: this.globalAlpha });
                }
            },
            getImageData() {
                return { data: new Uint8ClampedArray(state.pixels), width: this.canvas.width, height: this.canvas.height, colorSpace: "srgb" } as ImageData;
            },
            putImageData(imageData: ImageData) {
                state.pixels = new Uint8ClampedArray(imageData.data);
                let transparentPixels = 0;
                for (let index = 3; index < state.pixels.length; index += 4) if (state.pixels[index] === 0) transparentPixels += 1;
                state.operations.push({ op: "putImageData", transparentPixels });
            },
        } as unknown as CanvasRenderingContext2D;
        (state as CanvasState & { context: CanvasRenderingContext2D }).context = context;
        return context;
    },
});

Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value(this: HTMLCanvasElement) {
        return `data:image/png;base64,${Buffer.from(JSON.stringify(stateFor(this).operations)).toString("base64")}`;
    },
});

Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLCanvasElement) {
        return { x: 0, y: 0, left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, toJSON() {} };
    },
});

Object.defineProperties(HTMLCanvasElement.prototype, {
    setPointerCapture: { configurable: true, value() {} },
    releasePointerCapture: { configurable: true, value() {} },
    hasPointerCapture: {
        configurable: true,
        value() {
            return false;
        },
    },
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("@/i18n");
const { CanvasNodeMaskEditDialog } = await import("../src/pages/canvas/components/canvas-node-mask-edit-dialog");
await i18n.changeLanguage("zh-CN");

test("exports the origin edit mask and visible blue reference with an explicit generate flag", async () => {
    const payloads: Array<{ prompt: string; maskDataUrl: string; referenceDataUrl?: string; generate?: boolean }> = [];
    const editor = await renderEditor((payload) => payloads.push(payload));
    try {
        await paint(editor.previewCanvas);
        await changePrompt(editor.textarea, "  把选区改成金属  ");
        await click(button("导出到画布"));
        await click(button("立即生成"));

        assert.equal(payloads.length, 2);
        assert.deepEqual(
            payloads.map(({ prompt, generate }) => ({ prompt, generate })),
            [
                { prompt: "把选区改成金属", generate: false },
                { prompt: "把选区改成金属", generate: true },
            ],
        );
        for (const payload of payloads) {
            assert.ok(payload.referenceDataUrl);
            assert.notEqual(payload.maskDataUrl, payload.referenceDataUrl);
            const maskOperations = decodeOperations(payload.maskDataUrl);
            const referenceOperations = decodeOperations(payload.referenceDataUrl);
            assert.match(maskOperations, /#fff/);
            assert.match(maskOperations, /"transparentPixels":12/);
            assert.match(referenceOperations, /"source":"image"/);
            assert.match(referenceOperations, /#2563eb/);
        }
    } finally {
        await editor.unmount();
    }
});

test("keeps undo, redo, reset, and zoom controls working", async () => {
    const payloads: unknown[] = [];
    const editor = await renderEditor((payload) => payloads.push(payload));
    try {
        const undo = labelledButton("撤销");
        const redo = labelledButton("重做");
        assert.equal(undo.disabled, true);
        assert.equal(redo.disabled, true);
        assert.ok(document.body.textContent?.includes("100%"));

        await paint(editor.previewCanvas);
        assert.equal(undo.disabled, false);
        await click(undo);
        assert.equal(redo.disabled, false);
        await click(redo);
        assert.equal(undo.disabled, false);

        await click(labelledButton("放大"));
        assert.ok(document.body.textContent?.includes("120%"));
        await click(labelledButton("缩小"));
        assert.ok(document.body.textContent?.includes("100%"));

        await changePrompt(editor.textarea, "替换选区");
        await click(button("重置"));
        await click(button("导出到画布"));
        assert.equal(payloads.length, 0);
        assert.ok(document.body.textContent?.includes("请先涂抹局部区域"));
    } finally {
        await editor.unmount();
    }
});

async function renderEditor(onConfirm: (payload: { prompt: string; maskDataUrl: string; referenceDataUrl?: string; generate?: boolean }) => void) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<CanvasNodeMaskEditDialog dataUrl="data:image/png;base64,source" open onClose={() => {}} onConfirm={onConfirm} />);
        await Promise.resolve();
    });
    const canvases = Array.from(document.querySelectorAll("canvas"));
    assert.equal(canvases.length, 2);
    return {
        previewCanvas: canvases[1],
        textarea: required(document.querySelector("textarea")),
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

async function paint(canvas: HTMLCanvasElement) {
    await act(async () => {
        canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 1, clientY: 1 }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: 1, clientY: 1 }));
    });
}

async function changePrompt(textarea: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

async function click(target: HTMLButtonElement) {
    await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function button(text: string) {
    return required(Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text)) || null);
}

function labelledButton(label: string) {
    return required(document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`));
}

function decodeOperations(dataUrl: string) {
    return Buffer.from(dataUrl.split(",", 2)[1], "base64").toString();
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
