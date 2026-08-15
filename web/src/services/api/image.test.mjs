import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { createAsyncImageEditTask, pollAsyncImageTask } from "./image.ts";

test("canvas image edits can use the generations endpoint with the image payload", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { id: "task-1" } };
    };

    const model = "Dola-Seedream-5.0-lite";
    const image = { id: "image-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2UtYnl0ZXM=" };
    try {
        const task = await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                size: "1024x1024",
                background: "transparent",
                imageRequestFormats: [{ model, format: "multipart/form-data", canvasRequestMode: "generations" }],
            },
            "给图中的猫戴上红色围巾",
            [image],
            2,
        );

        assert.deepEqual(task, { id: "task-1", model });
        assert.equal(request.url, "/api/v1/async/images/generations");
        assert.ok(request.body instanceof FormData);
        const uploadedImage = request.body.get("image");
        assert.ok(uploadedImage instanceof File);
        assert.equal(uploadedImage.name, image.name);
        assert.equal(uploadedImage.type, image.type);
        assert.equal(await uploadedImage.text(), "image-bytes");
        assert.deepEqual(Object.fromEntries([...request.body].filter(([key]) => key !== "image")), {
            model,
            prompt: "给图中的猫戴上红色围巾",
            n: "2",
            size: "1024x1024",
            background: "transparent",
            output_format: "png",
        });
        assert.equal(request.options.headers["X-Source"], "canvas");
    } finally {
        axios.post = previousPost;
    }
});

test("canvas generations send multiple reference images as a JSON array", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { id: "task-2" } };
    };

    const model = "Dola-Seedream-5.0-lite";
    const references = [
        { id: "image-1", name: "first.png", type: "image/png", dataUrl: "data:image/png;base64,Zmlyc3Q=" },
        { id: "image-2", name: "second.png", type: "image/png", dataUrl: "data:image/png;base64,c2Vjb25k" },
    ];
    try {
        await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                size: "2048x2048",
                imageRequestFormats: [{ model, format: "application/json", canvasRequestMode: "generations" }],
            },
            "融合两张参考图的风格与主体",
            references,
        );

        assert.equal(request.url, "/api/v1/async/images/generations");
        assert.equal(request.options.headers["Content-Type"], "application/json");
        assert.deepEqual(request.body, {
            model,
            prompt: "融合两张参考图的风格与主体",
            image: references.map((reference) => reference.dataUrl),
            n: 1,
            size: "2048x2048",
            output_format: "png",
        });
    } finally {
        axios.post = previousPost;
    }
});

test("canvas image requests reject more than nine reference images", async () => {
    const previousPost = axios.post;
    let posted = false;
    axios.post = async () => {
        posted = true;
        return { data: { id: "unexpected-task" } };
    };

    const model = "Dola-Seedream-5.0-lite";
    const references = Array.from({ length: 10 }, (_, index) => ({
        id: `image-${index + 1}`,
        name: `image-${index + 1}.png`,
        type: "image/png",
        dataUrl: "data:image/png;base64,aW1hZ2U=",
    }));
    try {
        await assert.rejects(
            () =>
                createAsyncImageEditTask(
                    {
                        ...defaultConfig,
                        channelMode: "remote",
                        model,
                        imageModel: model,
                        imageRequestFormats: [{ model, format: "application/json", canvasRequestMode: "generations" }],
                    },
                    "融合参考图",
                    references,
                ),
            /9/,
        );
        assert.equal(posted, false);
    } finally {
        axios.post = previousPost;
    }
});

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
