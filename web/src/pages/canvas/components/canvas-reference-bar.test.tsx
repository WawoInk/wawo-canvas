import assert from "node:assert/strict";
import test from "node:test";
import "../../../../test/register-dom";

import { CanvasNodeType, type CanvasNodeData } from "../types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasNodeReferenceBar } = await import("./canvas-node-reference-bar");

const nodes: CanvasNodeData[] = [
    { id: "group-1", type: CanvasNodeType.Group, title: "参考组", position: { x: 0, y: 0 }, width: 300, height: 200 },
    { id: "image-1", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId: "group-1", content: "data:image/png;base64,preview" } },
    { id: "video-1", type: CanvasNodeType.Video, title: "参考视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId: "group-1", content: "https://example.com/preview.mp4" } },
    { id: "text-1", type: CanvasNodeType.Text, title: "参考文案", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "一段参考文案" } },
];

test("expands group previews and reports the original connection when removing a reference", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const disconnected: string[][] = [];
    const selected: string[] = [];
    const root = createRoot(container);

    try {
        await act(async () =>
            root.render(
                <CanvasNodeReferenceBar
                    nodeId="target-1"
                    nodes={nodes}
                    connectedNodes={[nodes[0], nodes[1], nodes[3]]}
                    onDisconnect={(fromNodeId, toNodeId) => disconnected.push([fromNodeId, toNodeId])}
                    onStartSelection={(nodeId) => selected.push(nodeId)}
                />,
            ),
        );

        const items = Array.from(container.querySelectorAll<HTMLElement>("[data-canvas-reference-node-id]"));
        assert.deepEqual(
            items.map((item) => item.dataset.canvasReferenceNodeId),
            ["image-1", "video-1", "text-1"],
        );
        assert.equal(items[0].querySelector("img")?.getAttribute("src"), "data:image/png;base64,preview");
        assert.equal(items[1].querySelector("video")?.getAttribute("src"), "https://example.com/preview.mp4");

        await act(async () => click(required(items[0].querySelector<HTMLButtonElement>("[data-canvas-reference-remove]"))));
        await act(async () => click(required(items[2].querySelector<HTMLButtonElement>("[data-canvas-reference-remove]"))));
        await act(async () => click(required(container.querySelector<HTMLButtonElement>("[data-canvas-reference-picker]"))));

        assert.deepEqual(disconnected, [
            ["group-1", "target-1"],
            ["text-1", "target-1"],
        ]);
        assert.deepEqual(selected, ["target-1"]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

function click(button: HTMLButtonElement) {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
