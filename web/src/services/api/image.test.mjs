import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { useUserStore } from "../../stores/use-user-store.ts";
import { createAsyncImageEditTask, createAsyncImageTask, pollAsyncImageTask } from "./image.ts";

test("workbench image generations preserve source and platform task identity", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return {
            data: { id: "upstream-task-7" },
            headers: new axios.AxiosHeaders({ "x-generation-task-id": "platform-task-42" }),
        };
    };

    const model = "Images";
    try {
        const task = await createAsyncImageTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
            },
            "画一座灯塔",
            1,
            "image_workbench",
        );

        assert.equal(request.options.headers["X-Source"], "image_workbench");
        assert.deepEqual(task, {
            id: "upstream-task-7",
            model,
            platformTaskId: "platform-task-42",
        });
    } finally {
        axios.post = previousPost;
    }
});

test("workbench image edits preserve source and platform task identity", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return {
            data: { id: "upstream-edit-8" },
            headers: { "x-generation-task-id": "platform-edit-43" },
        };
    };

    const model = "Images";
    try {
        const task = await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
            },
            "把天空改成晚霞",
            [{ id: "reference-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
            1,
            "image_workbench",
        );

        assert.equal(request.options.headers["X-Source"], "image_workbench");
        assert.deepEqual(task, {
            id: "upstream-edit-8",
            model,
            platformTaskId: "platform-edit-43",
        });
    } finally {
        axios.post = previousPost;
    }
});

test("workbench immediate results keep upstream and platform ids separate with AxiosHeaders", async () => {
    const previousPost = axios.post;
    axios.post = async () => ({
        data: { data: [{ url: "https://provider.test/immediate.png" }] },
        headers: new axios.AxiosHeaders({ "x-generation-task-id": "platform-immediate-44" }),
    });

    const model = "Images";
    try {
        const task = await createAsyncImageTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
            },
            "立即返回一张图",
            1,
            "image_workbench",
        );

        assert.deepEqual(task, {
            id: "platform-immediate-44",
            model,
            platformTaskId: "platform-immediate-44",
            images: [{ dataUrl: "https://provider.test/immediate.png" }],
        });
    } finally {
        axios.post = previousPost;
    }
});

test("async image task query envelope errors remain retryable", async () => {
    const previousGet = axios.get;
    axios.get = async () => ({ data: { code: 1, msg: "temporary upstream query failure" } });

    const model = "Images";
    try {
        await assert.rejects(
            pollAsyncImageTask(
                {
                    ...defaultConfig,
                    channelMode: "remote",
                    model,
                    imageModel: model,
                },
                { id: "upstream-query-retry", model },
            ),
            /temporary upstream query failure/,
        );
    } finally {
        axios.get = previousGet;
    }
});

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

test("canvas default image edits upload stored image bytes", async () => {
    const previousPost = axios.post;
    const previousFetch = globalThis.fetch;
    const previousToken = useUserStore.getState().token;
    let request;
    let downloadRequest;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { id: "task-images" } };
    };
    globalThis.fetch = async (input, init) => {
        downloadRequest = { input: String(input), init };
        return new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } });
    };
    useUserStore.setState({ token: "test-token" });

    const model = "Images";
    try {
        await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                size: "1024x1024",
                imageRequestFormats: [{ model, format: "default", canvasRequestMode: "split" }],
            },
            "替换背景",
            [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "https://example.test/presigned.png", fileId: "file-1" }],
        );

        assert.equal(request.url, "/api/v1/async/images/edits");
        assert.ok(request.body instanceof FormData);
        const uploadedImage = request.body.get("image");
        assert.ok(uploadedImage instanceof File);
        assert.equal(await uploadedImage.text(), "image-bytes");
        assert.equal(downloadRequest.input, "/api/v1/files/file-1/content");
        assert.equal(new Headers(downloadRequest.init.headers).get("Authorization"), "Bearer test-token");
    } finally {
        useUserStore.setState({ token: previousToken });
        globalThis.fetch = previousFetch;
        axios.post = previousPost;
    }
});

test("canvas accepts completed b64_json responses from async image edits", async () => {
    const previousPost = axios.post;
    const previousGet = axios.get;
    let queried = false;
    axios.post = async () => ({
        data: {
            data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }],
            model: "gpt-image-2",
            output_format: "png",
        },
        headers: { "x-generation-task-id": "generation-task-1" },
    });
    axios.get = async () => {
        queried = true;
        throw new Error("completed responses must not be polled");
    };

    const model = "Images";
    try {
        const task = await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                imageRequestFormats: [{ model, format: "default", canvasRequestMode: "split" }],
            },
            "替换背景",
            [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        );

        assert.equal(task.id, "generation-task-1");
        assert.deepEqual(await pollAsyncImageTask(defaultConfig, task), {
            status: "succeeded",
            images: [{ dataUrl: "data:image/png;base64,aW1hZ2UtYnl0ZXM=" }],
        });
        assert.equal(queried, false);
    } finally {
        axios.get = previousGet;
        axios.post = previousPost;
    }
});

test("canvas accepts completed result.data url responses from async image edits", async () => {
    const previousPost = axios.post;
    const previousGet = axios.get;
    let queried = false;
    const imageUrl = "https://example.test/generated.png";
    axios.post = async () => ({
        data: {
            id: "task-result-url",
            object: "task",
            status: "completed",
            result: {
                model: "seedream-5-0-260128",
                data: [{ url: imageUrl, size: "2048x2048" }],
            },
        },
    });
    axios.get = async () => {
        queried = true;
        throw new Error("completed responses must not be polled");
    };

    const model = "Images";
    try {
        const task = await createAsyncImageEditTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                imageRequestFormats: [{ model, format: "default", canvasRequestMode: "split" }],
            },
            "替换背景",
            [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        );

        assert.equal(task.id, "task-result-url");
        assert.deepEqual(await pollAsyncImageTask(defaultConfig, task), {
            status: "succeeded",
            images: [{ dataUrl: imageUrl }],
        });
        assert.equal(queried, false);
    } finally {
        axios.get = previousGet;
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
