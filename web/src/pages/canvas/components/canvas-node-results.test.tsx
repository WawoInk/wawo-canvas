import assert from "node:assert/strict";
import test from "node:test";
import "../../../../test/register-dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { default: i18n } = await import("@/i18n");
const { CanvasNode } = await import("./canvas-node");
const { CanvasNodeHoverToolbar } = await import("./canvas-node-hover-toolbar");
const { CanvasNodeType } = await import("../types");
await i18n.changeLanguage("zh-CN");

test("group nodes render as non-generating containers and expose ungroup", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const node = {
        id: "group-1",
        type: CanvasNodeType.Group,
        title: "镜头参考",
        position: { x: 20, y: 30 },
        width: 760,
        height: 480,
        metadata: { status: "error" as const, prompt: "不应生成" },
    };
    let ungrouped = "";

    try {
        await act(async () =>
            root.render(
                <App>
                    <CanvasNode
                        data={node}
                        scale={1}
                        isSelected
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        isConnecting={false}
                        showPanel
                        showImageInfo={false}
                        groupChildCount={3}
                        renderPanel={() => <div data-generation-panel>生成面板</div>}
                        onMouseDown={() => {}}
                        onHoverStart={() => {}}
                        onHoverEnd={() => {}}
                        onConnectStart={() => {}}
                        onResize={() => {}}
                        onContentChange={() => {}}
                        onContextMenu={() => {}}
                    />
                    <CanvasNodeHoverToolbar
                        node={node}
                        viewport={{ x: 0, y: 0, k: 1 }}
                        onKeep={() => {}}
                        onLeave={() => {}}
                        onInfo={() => {}}
                        onEditText={() => {}}
                        onDecreaseFont={() => {}}
                        onIncreaseFont={() => {}}
                        onToggleDialog={() => {}}
                        onGenerateImage={() => {}}
                        onUpload={() => {}}
                        onDownload={() => {}}
                        onSaveAsset={() => {}}
                        onMaskEdit={() => {}}
                        onCrop={() => {}}
                        onSplit={() => {}}
                        onUpscale={() => {}}
                        onSuperResolve={() => {}}
                        onAngle={() => {}}
                        onViewImage={() => {}}
                        onReversePrompt={() => {}}
                        onRetry={() => {}}
                        onToggleFreeResize={() => {}}
                        onDelete={() => {}}
                        onUngroup={(target) => {
                            ungrouped = target.id;
                        }}
                    />
                </App>,
            ),
        );

        const element = required(container.querySelector<HTMLElement>('[data-node-id="group-1"]'));
        const shell = required(element.firstElementChild as HTMLElement | null);
        assert.match(element.className, /z-\[5\]/);
        assert.equal(shell.style.background, "transparent");
        assert.equal(shell.style.borderStyle, "dashed");
        assert.match(element.textContent || "", /镜头参考/);
        assert.match(element.textContent || "", /3/);
        assert.equal(container.querySelector("[data-generation-panel]"), null);
        assert.equal(container.querySelector('[data-toolbar-action="retry"]'), null);

        await act(async () => click(required(container.querySelector<HTMLButtonElement>('[data-toolbar-action="ungroup"]'))));
        assert.equal(ungrouped, node.id);

        await act(async () =>
            root.render(
                <App>
                    <CanvasNode
                        data={{ ...node, id: "image-1", type: CanvasNodeType.Image }}
                        scale={1}
                        isSelected
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        isConnecting={false}
                        showPanel
                        showImageInfo={false}
                        renderPanel={() => <div data-generation-panel>生成面板</div>}
                        onMouseDown={() => {}}
                        onHoverStart={() => {}}
                        onHoverEnd={() => {}}
                        onConnectStart={() => {}}
                        onResize={() => {}}
                        onContentChange={() => {}}
                        onContextMenu={() => {}}
                    />
                </App>,
            ),
        );
        assert.ok(container.querySelector("[data-generation-panel]"));
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

test("batch result controls keep independent node identities", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const calls: string[] = [];
    const node = {
        id: "image-run-2",
        type: CanvasNodeType.Image,
        title: "第二张图",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: {
            content: "data:image/png;base64,AA==",
            status: "success" as const,
            batchRootId: "image-batch",
            generationTaskId: "run-2",
            fileId: "file-2",
            materialSource: "volcengine" as const,
            volcengineAssetOutboundName: "企业素材库",
        },
    };

    try {
        await act(async () =>
            root.render(
                <App>
                    <CanvasNode
                        data={node}
                        scale={1}
                        isSelected={false}
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        isConnecting={false}
                        showPanel={false}
                        showImageInfo
                        onMouseDown={() => {}}
                        onHoverStart={() => {}}
                        onHoverEnd={() => {}}
                        onConnectStart={() => {}}
                        onResize={() => {}}
                        onContentChange={() => {}}
                        onSetBatchPrimary={(target) => calls.push(`primary:${target.id}:${target.metadata?.generationTaskId}`)}
                        onCopy={(target) => calls.push(`copy:${target.id}:${target.metadata?.generationTaskId}`)}
                        onDownload={(target) => calls.push(`download:${target.id}:${target.metadata?.fileId}`)}
                        onDelete={(target) => calls.push(`delete:${target.id}:${target.metadata?.generationTaskId}`)}
                        onContextMenu={() => {}}
                    />
                </App>,
            ),
        );

        const element = required(container.querySelector<HTMLElement>('[data-node-id="image-run-2"]'));
        const shell = required(element.firstElementChild as HTMLElement | null);
        const content = required(shell.firstElementChild as HTMLElement | null);
        assert.equal(shell.style.background, "transparent");
        assert.equal(content.style.background, "transparent");
        assert.match(element.textContent || "", /火山|企业素材库/);
        assert.match(element.textContent || "", /320/);

        for (const action of ["set-primary", "copy", "download", "delete"]) {
            await act(async () => click(required(container.querySelector<HTMLButtonElement>(`[data-result-action="${action}"]`))));
        }
        assert.deepEqual(calls, ["primary:image-run-2:run-2", "copy:image-run-2:run-2", "download:image-run-2:file-2", "delete:image-run-2:run-2"]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

test("failed batch children expose retry and delete", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const calls: string[] = [];
    const node = {
        id: "image-run-failed",
        type: CanvasNodeType.Image,
        title: "失败结果",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { status: "error" as const, batchRootId: "image-batch", generationTaskId: "run-failed", errorDetails: "生成失败" },
    };

    try {
        await act(async () =>
            root.render(
                <App>
                    <CanvasNode
                        data={node}
                        scale={1}
                        isSelected={false}
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        isConnecting={false}
                        showPanel={false}
                        showImageInfo={false}
                        onMouseDown={() => {}}
                        onHoverStart={() => {}}
                        onHoverEnd={() => {}}
                        onConnectStart={() => {}}
                        onResize={() => {}}
                        onContentChange={() => {}}
                        onRetry={(target) => calls.push(`retry:${target.id}:${target.metadata?.generationTaskId}`)}
                        onDelete={(target) => calls.push(`delete:${target.id}:${target.metadata?.generationTaskId}`)}
                        onContextMenu={() => {}}
                    />
                </App>,
            ),
        );

        await act(async () => click(required(container.querySelector<HTMLButtonElement>('[data-result-action="retry"]'))));
        await act(async () => click(required(container.querySelector<HTMLButtonElement>('[data-result-action="delete"]'))));
        assert.deepEqual(calls, ["retry:image-run-failed:run-failed", "delete:image-run-failed:run-failed"]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

for (const status of ["loading", "error"] as const)
    test(`paused video observation does not keep displaying active generation (${status})`, async () => {
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        const node = {
            id: "video-observation-paused",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            metadata: {
                status,
                generationTaskId: "existing-video-task",
                generationTaskStatus: "running" as const,
                generationPollingPaused: true,
                errorDetails: "视频任务查询暂时失败，已暂停自动查询",
            },
        };
        try {
            await act(async () =>
                root.render(
                    <App>
                        <CanvasNode
                            data={node}
                            scale={1}
                            isSelected={false}
                            isRelated={false}
                            isFocusRelated={false}
                            isConnectionTarget={false}
                            isConnecting={false}
                            showPanel={false}
                            showImageInfo={false}
                            onMouseDown={() => {}}
                            onHoverStart={() => {}}
                            onHoverEnd={() => {}}
                            onConnectStart={() => {}}
                            onResize={() => {}}
                            onContentChange={() => {}}
                            onContextMenu={() => {}}
                        />
                    </App>,
                ),
            );
            assert.equal(Boolean(container.querySelector(".animate-spin")), false, "paused observation must not show an active spinner");
            assert.equal(Boolean(container.querySelector(".canvan-gen-active")), false, "paused observation must not keep generation animation active");
            assert.doesNotMatch(container.textContent || "", /生成中/);
            assert.match(container.textContent || "", /暂停/);
            assert.equal(container.querySelector('[data-result-action="retry"]'), null, "observation should resume the existing task instead of submitting a retry");
        } finally {
            await act(async () => root.unmount());
            container.remove();
        }
    });

test("text batch roots toggle and text children expose primary copy delete", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const calls: string[] = [];
    const rootNode = {
        id: "text-batch",
        type: CanvasNodeType.Text,
        title: "文案批次",
        position: { x: 0, y: 0 },
        width: 360,
        height: 220,
        metadata: { content: "主文案", isBatchRoot: true, batchChildIds: ["text-run-1", "text-run-2"], imageBatchExpanded: false },
    };
    const childNode = {
        id: "text-run-2",
        type: CanvasNodeType.Text,
        title: "第二条文案",
        position: { x: 400, y: 0 },
        width: 360,
        height: 220,
        metadata: { content: "独立文案结果", status: "success" as const, batchRootId: "text-batch", generationTaskId: "text-run-task-2" },
    };
    const props = {
        scale: 1,
        isSelected: false,
        isRelated: false,
        isFocusRelated: false,
        isConnectionTarget: false,
        isConnecting: false,
        showPanel: false,
        showImageInfo: false,
        onMouseDown: () => {},
        onHoverStart: () => {},
        onHoverEnd: () => {},
        onConnectStart: () => {},
        onResize: () => {},
        onContentChange: () => {},
        onContextMenu: () => {},
    };

    try {
        await act(async () =>
            root.render(
                <App>
                    <CanvasNode data={rootNode} {...props} batchCount={2} onToggleBatch={(id) => calls.push(`toggle:${id}`)} />
                    <CanvasNode
                        data={childNode}
                        {...props}
                        onSetBatchPrimary={(target) => calls.push(`primary:${target.id}:${target.metadata?.generationTaskId}`)}
                        onCopy={(target) => calls.push(`copy:${target.id}:${target.metadata?.generationTaskId}`)}
                        onDelete={(target) => calls.push(`delete:${target.id}:${target.metadata?.generationTaskId}`)}
                    />
                </App>,
            ),
        );

        assert.match(required(container.querySelector<HTMLElement>('[data-node-id="text-batch"]')).textContent || "", /主文案/);
        await act(async () => click(required(container.querySelector<HTMLButtonElement>('[data-node-id="text-batch"] [data-batch-toggle]'))));
        for (const action of ["set-primary", "copy", "delete"]) {
            await act(async () => click(required(container.querySelector<HTMLButtonElement>(`[data-node-id="text-run-2"] [data-result-action="${action}"]`))));
        }
        assert.deepEqual(calls, ["toggle:text-batch", "primary:text-run-2:text-run-task-2", "copy:text-run-2:text-run-task-2", "delete:text-run-2:text-run-task-2"]);
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
