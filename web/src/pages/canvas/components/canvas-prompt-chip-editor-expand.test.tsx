import assert from "node:assert/strict";
import test from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("@/i18n");
const { CanvasPromptChipEditor } = await import("./canvas-prompt-chip-editor");
await i18n.changeLanguage("zh-CN");

test("video references keep their preview in the mention menu and chip", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setPrompt = (_value: string) => {};
    const previewUrl = "blob:http://localhost/video-preview";

    function Harness() {
        const [value, setValue] = useState("");
        setPrompt = setValue;
        return <CanvasPromptChipEditor value={value} references={[{ id: "video-1", nodeId: "video-1", kind: "video", label: "视频1", title: "参考视频", previewUrl, active: true }]} onChange={setValue} className="h-24 w-full" />;
    }

    const root = createRoot(container);
    try {
        await act(async () => root.render(<Harness />));

        const editor = required(document.querySelector<HTMLElement>(`[role="textbox"][aria-label="${i18n.t("canvas.promptEditor.promptAria")}"]`));
        const mention = document.createTextNode("@");
        editor.replaceChildren(mention);
        setCaret(mention, 1);
        await act(async () => editor.dispatchEvent(new Event("input", { bubbles: true })));

        assert.equal(required(document.querySelector<HTMLElement>('[role="option"]')).querySelector("video")?.getAttribute("src"), previewUrl);

        await act(async () => setPrompt("视频1"));
        assert.equal(required(editor.querySelector<HTMLElement>("[data-prompt-label='视频1']")).querySelector("video")?.getAttribute("src"), previewUrl);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

test("prompt keeps resource-chip caret and submits only with Shift+Enter", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let submitted = "";

    function Harness() {
        const [value, setValue] = useState("让 图片1 站在这里");
        return (
            <CanvasPromptChipEditor
                value={value}
                references={[{ id: "image-1", nodeId: "image-1", kind: "image", label: "图片1", title: "参考图", active: true }]}
                onChange={setValue}
                onSubmit={() => {
                    submitted = value;
                }}
                className="h-24 w-full"
            />
        );
    }

    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    let editor = required(document.querySelector<HTMLElement>(`[role="textbox"][aria-label="${i18n.t("canvas.promptEditor.promptAria")}"]`));
    const chip = required(editor.querySelector<HTMLElement>("[data-prompt-label='图片1']"));
    setCaret(editor, Array.from(editor.childNodes).indexOf(chip) + 1);

    await act(async () => click(required(document.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("canvas.promptEditor.expand")}"]`))));

    editor = required(document.querySelector<HTMLElement>(`[role="textbox"][aria-label="${i18n.t("canvas.promptEditor.promptAria")}"]`));
    assert.equal(document.activeElement, editor);
    assertCaret(editor, 2);

    const inserted = document.createTextNode("清晰");
    const range = currentRange();
    range.insertNode(inserted);
    setCaret(inserted, inserted.data.length);
    await act(async () => editor.dispatchEvent(new Event("input", { bubbles: true })));

    await act(async () => click(required(document.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("canvas.promptEditor.collapse")}"]`))));

    editor = required(document.querySelector<HTMLElement>(`[role="textbox"][aria-label="${i18n.t("canvas.promptEditor.promptAria")}"]`));
    assert.equal(document.activeElement, editor);
    assert.equal(currentRange().startContainer.textContent, "清晰 站在这里");
    assert.equal(currentRange().startOffset, "清晰".length);

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => editor.dispatchEvent(enter));
    assert.equal(submitted, "");
    assert.equal(enter.defaultPrevented, false);

    const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => editor.dispatchEvent(shiftEnter));
    assert.equal(submitted, "让 图片1清晰 站在这里");
    assert.equal(shiftEnter.defaultPrevented, true);

    await act(async () => root.unmount());
    container.remove();
});

function click(button: HTMLButtonElement) {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setCaret(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>("[contenteditable='true']")?.focus();
}

function assertCaret(node: Node, offset: number) {
    const range = currentRange();
    assert.equal(range.startContainer, node);
    assert.equal(range.startOffset, offset);
}

function currentRange() {
    const selection = window.getSelection();
    assert.ok(selection?.rangeCount);
    return selection.getRangeAt(0);
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
