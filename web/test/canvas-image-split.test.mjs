import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the editor's real callback without mounting the full canvas or a browser.
const source = readFileSync(new URL("../src/pages/canvas/project/index.tsx", import.meta.url), "utf8");
const callback = source.slice(source.indexOf("    const splitImageNode ="), source.indexOf("    const maskEditImageNode ="));
const metadata = source.slice(source.indexOf("function imageMetadata("), source.indexOf("function videoMetadata("));
const code = ts.transpileModule(`${metadata}\n${callback}\nreturn splitImageNode;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

async function split({ fail = false, switchAt } = {}) {
    let session = { token: "token-a", user: { id: "user-a" } };
    const projectIdRef = { current: "project-a" };
    const changeSession = () => { session = { token: "token-b", user: { id: "user-b" } }; };
    let nextId = 0;
    const nodes = [], uploads = [], errors = [], connections = [];
    const noop = () => {};
    const dependencies = {
        useUserStore: { getState: () => session },
        projectId: "project-a",
        projectIdRef,
        isCurrentSession: (a, b) => a.token === b.token && a.userId === b.userId,
        useCallback: (fn) => fn,
        splitDataUrl: async () => {
            if (switchAt === "split") changeSession();
            return [0, 1].map((column) => ({ row: 0, column, dataUrl: "data:image/png;base64,aW1hZ2U=" }));
        },
        uploadImage: async () => ({ url: "blob:local", storageKey: "image:local", width: 20, height: 10 }),
        uploadBlob: async (blob, fileType) => {
            uploads.push({ blob, fileType });
            if (switchAt === "upload") projectIdRef.current = "project-b";
            if (fail) throw new Error("upload failed");
            return { fileId: `file-${uploads.length}`, url: `https://storage.test/${uploads.length}`, width: 20, height: 10, bytes: blob.size, mimeType: blob.type };
        },
        nanoid: () => `id-${++nextId}`,
        CanvasNodeType: { Image: "image" },
        t: (key) => key,
        formatNumber: String,
        setSplitNodeId: noop,
        setNodes: (update) => nodes.push(...update([])),
        setConnections: (update) => connections.push(...update([])),
        setSelectedNodeIds: noop,
        setSelectedConnectionId: noop,
        setDialogNodeId: noop,
        message: { success: noop, error: (error) => errors.push(error) },
    };
    const run = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
    try {
        await run({ id: "source", title: "source", width: 40, height: 10, position: { x: 0, y: 0 }, metadata: { content: "source", prompt: "prompt" } }, { rows: 1, columns: 2 });
    } catch (error) {
        // The dialog owns the error display and retry state.
        errors.push(error);
    }
    return { nodes, uploads, errors, connections };
}

test("split images use platform upload and retain durable file references", async () => {
    const { nodes, uploads, connections } = await split();
    assert.equal(uploads.length, 2, "each piece must use the authenticated platform upload instead of IndexedDB");
    assert.ok(uploads.every(({ blob, fileType }) => blob.type === "image/png" && fileType === "images"));
    assert.deepEqual(nodes.map((node) => node.metadata.fileId), ["file-1", "file-2"]);
    assert.ok(nodes.every((node) => node.metadata.storageKey === "" && node.metadata.prompt === "prompt"));
    assert.equal(connections.length, 2);
});

test("failed split upload does not publish local-only nodes", async () => {
    const { nodes, connections, errors } = await split({ fail: true });
    assert.equal(nodes.length, 0);
    assert.equal(connections.length, 0);
    assert.equal(errors.length, 1);
});

test("account changes during splitting prevent uploads for the new account", async () => {
    const { nodes, uploads } = await split({ switchAt: "split" });
    assert.equal(uploads.length, 0);
    assert.equal(nodes.length, 0);
});

test("switching canvas during upload does not append stale nodes", async () => {
    const { nodes, connections } = await split({ switchAt: "upload" });
    assert.equal(nodes.length, 0);
    assert.equal(connections.length, 0);
});
