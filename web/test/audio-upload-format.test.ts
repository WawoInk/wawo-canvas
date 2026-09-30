import assert from "node:assert/strict";
import test from "node:test";

import { uploadBlob } from "../src/services/upload-blob.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

test("audio upload preserves the original filename, MIME type and bytes", async () => {
    const originalFetch = globalThis.fetch;
    const originalState = useUserStore.getState();
    let uploaded: File;
    let contentType = "";
    let filename = "";
    useUserStore.setState({ token: "test-token", user: { id: "test-user" } as NonNullable<typeof originalState.user> });
    globalThis.fetch = (async (_input, init) => {
        const request = new Request("http://localhost/api/v1/files", init);
        const multipart = await request.clone().text();
        contentType = multipart.match(/Content-Type: ([^\r\n]+)/i)?.[1] || "";
        filename = multipart.match(/filename="([^"]+)"/)?.[1] || "";
        const form = await request.formData();
        assert.equal(form.get("fileType"), "audios");
        uploaded = form.get("file") as File;
        return { json: async () => ({ code: 1, msg: "captured upload request" }) } as Response;
    }) as typeof fetch;

    try {
        for (const [name, type] of [
            ["旁白.mp3", "audio/mpeg"],
            ["旁白.MP3", "audio/mpeg"],
            ["recording.wav", "audio/x-wav"],
            ["recording.m4a", "audio/mp4"],
            ["recording.aac", "audio/aac"],
            ["recording.ogg", "audio/ogg"],
            ["recording.opus", "audio/ogg"],
            ["recording.flac", "audio/flac"],
            ["unknown.mp3", ""],
        ]) {
            const file = new File(["original-audio-bytes"], name, { type });
            await assert.rejects(uploadBlob(file, "audios"), /captured upload request/);
            assert.equal(filename, file.name);
            assert.equal(contentType, file.type || "application/octet-stream");
            assert.deepEqual(await uploaded!.arrayBuffer(), await file.arrayBuffer());
        }
    } finally {
        globalThis.fetch = originalFetch;
        useUserStore.setState(originalState);
    }
});
