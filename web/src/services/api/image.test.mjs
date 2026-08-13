import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { pollAsyncImageTask } from "./image.ts";

test("accepts top-level image data as a completed async task", async (t) => {
    const server = createServer((_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ model: "seedream-5-0-260128", data: [{ url: "https://example.com/result.png", size: "2048x2048" }] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const model = "seedream-5-0-260128";
    const config = {
        ...defaultConfig,
        channelMode: "local",
        baseUrl,
        apiKey: "test-key",
        model,
        imageModel: model,
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: [model] }],
    };

    assert.deepEqual(await pollAsyncImageTask(config, { id: "task-1", model }), {
        status: "succeeded",
        images: [{ dataUrl: "https://example.com/result.png" }],
    });
});
