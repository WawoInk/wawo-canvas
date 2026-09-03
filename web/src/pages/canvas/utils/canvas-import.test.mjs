import assert from "node:assert/strict";
import test from "node:test";

import { replaceCanvasFileReference, restoreCanvasExportFiles } from "./canvas-import.ts";

test("rewrites imported platform file references to the current account file", () => {
    const project = {
        nodes: [{ metadata: { fileId: "old-file", content: "https://old.example/file", storageKey: "" } }],
        chatSessions: [{ messages: [{ images: [{ fileId: "old-file", dataUrl: "https://old.example/file" }] }] }],
    };
    replaceCanvasFileReference(project, "old-file", { fileId: "new-file", url: "blob:new", mimeType: "image/png", bytes: 3, width: 1, height: 1 });
    assert.deepEqual(project.nodes[0].metadata, { fileId: "new-file", content: "blob:new", storageKey: "" });
    assert.equal(project.chatSessions[0].messages[0].images[0].fileId, "new-file");
    assert.equal(project.chatSessions[0].messages[0].images[0].dataUrl, "blob:new");
});

test("restores archived platform files into the current account and remaps the project", async () => {
    const project = { nodes: [{ metadata: { fileId: "old-file", content: "https://old.example/file", storageKey: "" } }] };
    const data = {
        projects: [{ project, files: [{ fileId: "old-file", path: "files/image.png", mimeType: "image/png", bytes: 3 }] }],
    };
    const uploads = [];
    await restoreCanvasExportFiles(data, new Map([["files/image.png", new Blob(["img"], { type: "image/png" })]]), {
        setImageBlob: async () => "",
        setMediaBlob: async () => "",
        uploadBlob: async (blob, kind) => {
            uploads.push([blob.type, kind]);
            return { fileId: "new-file", url: "blob:new", mimeType: blob.type, bytes: blob.size, width: 1, height: 1 };
        },
    });
    assert.deepEqual(uploads, [["image/png", "images"]]);
    assert.equal(project.nodes[0].metadata.fileId, "new-file");
    assert.equal(project.nodes[0].metadata.content, "blob:new");
});
