export type CanvasTool = "select" | "pan";

type CanvasToolModifiers = {
    ctrlKey?: boolean;
    metaKey?: boolean;
    spacePressed?: boolean;
};

export function effectiveCanvasTool(tool: CanvasTool, modifiers: CanvasToolModifiers) {
    return modifiers.ctrlKey || modifiers.metaKey || modifiers.spacePressed ? (tool === "pan" ? "select" : "pan") : tool;
}

export function isCanvasShortcutTarget(target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null) {
    if (!target || typeof target !== "object") return true;
    const element = target as HTMLElement;
    const tagName = element.tagName?.toUpperCase();
    if (tagName && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)) return false;
    if (element.isContentEditable) return false;
    return !element.closest?.("[contenteditable='true'],[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown");
}
