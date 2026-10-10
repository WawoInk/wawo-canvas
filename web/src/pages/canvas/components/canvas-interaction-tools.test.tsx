import assert from "node:assert/strict";
import test from "node:test";
import "../../../../test/register-dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("@/i18n");
const { InfiniteCanvas } = await import("./infinite-canvas");
const { CanvasToolbar } = await import("./canvas-toolbar");
const { CanvasNodeContextMenu } = await import("./canvas-context-menu");
const { CanvasNodeType } = await import("../types");
await i18n.changeLanguage("zh-CN");

Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value() {} });

test("infinite canvas starts marquee or pan from the explicit tool", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    let marqueeStarts = 0;
    let viewportChanges = 0;
    const render = (tool: "select" | "pan") =>
        root.render(
            <InfiniteCanvas containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} tool={tool} onViewportChange={() => viewportChanges++} onCanvasMouseDown={() => marqueeStarts++}>
                <div data-node-id="node-1" />
            </InfiniteCanvas>,
        );

    try {
        await act(async () => render("select"));
        await act(async () => pointerDown(required(containerRef.current)));
        assert.equal(marqueeStarts, 1);
        assert.equal(viewportChanges, 0);

        await act(async () => render("pan"));
        await act(async () => pointerDown(required(containerRef.current)));
        assert.equal(marqueeStarts, 1);
    } finally {
        await act(async () => window.dispatchEvent(new PointerEvent("pointerup")));
        await act(async () => root.unmount());
        host.remove();
    }
});

function pointerDown(target: HTMLElement, init: PointerEventInit = {}) {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }));
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}

test("Ctrl, Cmd, and Space temporarily reverse tools without hijacking text editing", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    let marqueeStarts = 0;

    try {
        await act(async () =>
            root.render(
                <InfiniteCanvas containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} tool="pan" onViewportChange={() => {}} onCanvasMouseDown={() => marqueeStarts++}>
                    <div contentEditable data-editor />
                </InfiniteCanvas>,
            ),
        );
        const canvas = required(containerRef.current);

        await act(async () => pointerDown(canvas, { ctrlKey: true }));
        assert.equal(marqueeStarts, 1);
        await act(async () => pointerDown(canvas, { metaKey: true }));
        assert.equal(marqueeStarts, 2);

        await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true })));
        await act(async () => pointerDown(canvas));
        assert.equal(marqueeStarts, 3);
        await act(async () => window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true, cancelable: true })));

        const editor = required(canvas.querySelector<HTMLElement>("[data-editor]"));
        await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true })));
        await act(async () => pointerDown(canvas));
        assert.equal(marqueeStarts, 3);
    } finally {
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
            window.dispatchEvent(new PointerEvent("pointerup"));
        });
        await act(async () => root.unmount());
        host.remove();
    }
});

test("blank-canvas double-click ignores nodes and canvas controls", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    let doubleClicks = 0;

    try {
        await act(async () =>
            root.render(
                <InfiniteCanvas containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} onViewportChange={() => {}} onCanvasDoubleClick={() => doubleClicks++}>
                    <div data-node-id="node-1" />
                    <button data-canvas-no-zoom type="button" />
                </InfiniteCanvas>,
            ),
        );
        const canvas = required(containerRef.current);
        await act(async () => canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        await act(async () => required(canvas.querySelector<HTMLElement>("[data-node-id]")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        await act(async () => required(canvas.querySelector<HTMLElement>("[data-canvas-no-zoom]")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        assert.equal(doubleClicks, 1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("canvas toolbar exposes the current tool and requests explicit tool changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const requested: Array<"select" | "pan"> = [];
    let deselects = 0;
    let focuses = 0;
    const baseProps = {
        selectedCount: 0,
        canUndo: false,
        canRedo: false,
        backgroundMode: "lines" as const,
        showImageInfo: false,
        onAddImage: () => {},
        onAddVideo: () => {},
        onAddAudio: () => {},
        onAddText: () => {},
        onAddConfig: () => {},
        onAddGroup: () => {},
        onUndo: () => {},
        onRedo: () => {},
        onUpload: () => {},
        onDelete: () => {},
        onClear: () => {},
        onDeselect: () => deselects++,
        onBackgroundModeChange: () => {},
        onShowImageInfoChange: () => {},
        onOpenMyAssets: () => {},
        onFocusSelected: () => focuses++,
    };

    try {
        await act(async () => root.render(<CanvasToolbar {...baseProps} canvasTool="select" onCanvasToolChange={(tool) => requested.push(tool)} />));
        await act(async () => click(required(host.querySelector<HTMLButtonElement>('[data-canvas-tool="select"]'))));
        assert.deepEqual(requested, ["pan"]);
        assert.equal(deselects, 1);

        await act(async () => root.render(<CanvasToolbar {...baseProps} canvasTool="pan" onCanvasToolChange={(tool) => requested.push(tool)} />));
        await act(async () => click(required(host.querySelector<HTMLButtonElement>('[data-canvas-tool="pan"]'))));
        assert.deepEqual(requested, ["pan", "select"]);

        await act(async () => root.render(<CanvasToolbar {...baseProps} selectedCount={1} />));
        await act(async () => click(required(host.querySelector<HTMLButtonElement>('[aria-label="居中选中节点"]'))));
        assert.equal(focuses, 1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

function click(button: HTMLButtonElement) {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

test("selection toolbar exposes group and ungroup callbacks for multi-selection", async () => {
    const { CanvasSelectionToolbar } = await import("./canvas-selection-toolbar");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let groups = 0;
    let ungroups = 0;
    const nodes = [
        { id: "a", type: CanvasNodeType.Image, title: "A", position: { x: 10, y: 20 }, width: 100, height: 80 },
        { id: "b", type: CanvasNodeType.Text, title: "B", position: { x: 150, y: 40 }, width: 120, height: 60 },
    ];

    try {
        await act(async () => root.render(<CanvasSelectionToolbar nodes={nodes} viewport={{ x: 5, y: 10, k: 1 }} showToolbar canGroup canUngroup onGroup={() => groups++} onUngroup={() => ungroups++} />));
        await act(async () => click(required(host.querySelector<HTMLButtonElement>('[data-canvas-selection-action="group"]'))));
        await act(async () => click(required(host.querySelector<HTMLButtonElement>('[data-canvas-selection-action="ungroup"]'))));
        assert.equal(groups, 1);
        assert.equal(ungroups, 1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("node context menu exposes first, last, and current video-frame callbacks", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const captured: string[] = [];

    try {
        await act(async () =>
            root.render(<CanvasNodeContextMenu menu={{ type: "node", nodeId: "video-1", x: 20, y: 30 }} canCaptureVideoFrame onCaptureVideoFrame={(position) => captured.push(position)} onClose={() => {}} onDuplicate={() => {}} onDelete={() => {}} />),
        );
        for (const position of ["first", "last", "current"] as const) {
            await act(async () => click(required(host.querySelector<HTMLButtonElement>(`[data-video-frame-position="${position}"]`))));
        }
        assert.deepEqual(captured, ["first", "last", "current"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("canvas wheel handling leaves menus and overlays scrollable", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();

    try {
        await act(async () =>
            root.render(
                <InfiniteCanvas containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} onViewportChange={() => {}}>
                    <div className="ant-dropdown" data-menu />
                </InfiniteCanvas>,
            ),
        );
        const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 });
        required(required(containerRef.current).querySelector<HTMLElement>("[data-menu]")).dispatchEvent(wheel);
        assert.equal(wheel.defaultPrevented, false);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
