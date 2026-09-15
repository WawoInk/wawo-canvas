import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig, useConfigStore } from "../../stores/use-config-store.ts";
import { useUserStore } from "../../stores/use-user-store.ts";
import { createAsyncImageEditTask, createAsyncImageTask, pollAsyncImageTask, requestEdit } from "./image.ts";

test("canvas immediate image edits send an explicit source", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] } };
    };

    try {
        await requestEdit(
            { ...defaultConfig, channelMode: "remote", model: "admin-image", imageModel: "admin-image" },
            "编辑图片",
            [{ id: "image-1", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
            undefined,
            { source: "canvas" },
        );
        assert.equal(request.options.headers["X-Source"], "canvas");
    } finally {
        axios.post = previousPost;
    }
});

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

test("direct image edits submit multiple references as image[] and keep single image and mask fields", async () => {
    const { requestEdit } = await import("./image.ts");
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] } };
    };
    const refs = ["first", "second"].map((id) => ({ id, name: `${id}.png`, type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }));
    try {
        const config = { ...defaultConfig, model: "edit-image", size: "1024x1024", quality: "auto" };
        await requestEdit(config, "combine", refs, refs[0]);
        assert.equal(body.getAll("image").length, 0);
        assert.equal(body.getAll("image[]").length, 2);
        assert.ok(body.get("mask") instanceof File);
        await requestEdit(config, "edit", [refs[0]]);
        assert.equal(body.getAll("image").length, 1);
        assert.equal(body.getAll("image[]").length, 0);
    } finally {
        axios.post = previousPost;
    }
});

test("Gemini image generation sends imageConfig while preserving local transport and cancellation", async () => {
    const { requestGeneration } = await import("./image.ts");
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }] } };
    };
    const model = "gemini-3-pro-image-preview";
    const signal = new AbortController().signal;
    try {
        const result = await requestGeneration(
            {
                ...defaultConfig,
                channelMode: "local",
                model,
                imageModel: model,
                channels: [{ id: "gemini", name: "Gemini", baseUrl: "https://gemini.example", apiKey: "test-key", apiFormat: "gemini", models: [model] }],
                size: "16:9",
                quality: "high",
                count: "1",
            },
            "draw",
            { signal },
        );
        assert.deepEqual(request.body.generationConfig.imageConfig, { aspectRatio: "16:9", imageSize: "4K" });
        assert.equal(request.body.generationConfig.responseFormat, undefined);
        assert.deepEqual(request.body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
        assert.equal(request.options.signal, signal);
        assert.deepEqual(
            result.map((image) => image.dataUrl),
            ["data:image/png;base64,aW1hZ2U="],
        );
    } finally {
        axios.post = previousPost;
    }
});

test("image generation resolves ratio selections through the upstream fixed size table", async () => {
    const { requestGeneration } = await import("./image.ts");
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] } };
    };
    try {
        for (const [quality, size, expected] of [
            ["auto", "4:3", "1024x768"],
            ["medium", "16:9", "2048x1152"],
            ["high", "3:2", "3520x2336"],
        ]) {
            await requestGeneration({ ...defaultConfig, model: "image", size, quality, count: "1" }, "draw");
            assert.equal(body.size, expected);
        }
    } finally {
        axios.post = previousPost;
    }
});

test("Gemini image edits honor explicit preset resolution independently of quality and omit unsupported imageSize", async () => {
    const { requestEdit } = await import("./image.ts");
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }] } };
    };
    try {
        for (const [model, size, quality, expected] of [
            ["gemini-3-pro-image", "2880x2880", "auto", { aspectRatio: "1:1", imageSize: "4K" }],
            ["gemini-3-pro-image", "1536x1024", "high", { aspectRatio: "3:2", imageSize: "1K" }],
            ["gemini-2.5-flash-image", "2048x1152", "high", { aspectRatio: "16:9" }],
            ["gemini-3-pro-image", "auto", "auto", undefined],
        ]) {
            await requestEdit(
                { ...defaultConfig, channelMode: "local", model, channels: [{ id: "gemini", name: "Gemini", baseUrl: "https://gemini.example", apiKey: "test-key", apiFormat: "gemini", models: [model] }], size, quality, count: "1" },
                "draw",
                [{ id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
            );
            assert.deepEqual(body.generationConfig.imageConfig, expected);
            assert.equal(body.contents[0].parts[1].inlineData.data, "aW1hZ2U=");
        }
    } finally {
        axios.post = previousPost;
    }
});

test("async multipart image edits send image[] without changing source, route, or task identity", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { id: "upstream" }, headers: { "x-generation-task-id": "platform" } };
    };
    const references = ["first", "second"].map((id) => ({ id, name: `${id}.png`, type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }));
    try {
        const model = "image";
        const task = await createAsyncImageEditTask(
            { ...defaultConfig, channelMode: "remote", model, size: "2048x1152", imageRequestFormats: [{ model, format: "multipart/form-data", canvasRequestMode: "generations" }] },
            "draw",
            references,
            2,
            "image_workbench",
        );
        assert.equal(request.body.getAll("image[]").length, 2);
        assert.equal(request.body.getAll("image").length, 0);
        assert.equal(request.url, "/api/v1/async/images/generations");
        assert.equal(request.options.headers["X-Source"], "image_workbench");
        assert.deepEqual(task, { id: "upstream", platformTaskId: "platform", model });
    } finally {
        axios.post = previousPost;
    }
});

test("all image request boundaries normalize disabled remote resolutions without changing local sizes", async () => {
    const { requestGeneration, requestEdit } = await import("./image.ts");
    const previousPost = axios.post;
    const previousPublicSettings = useConfigStore.getState().publicSettings;
    useConfigStore.setState({ publicSettings: null });
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] }, headers: { "x-generation-task-id": "platform" } };
    };
    const reference = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
    const requests = [(config) => requestGeneration(config, "draw"), (config) => requestEdit(config, "edit", [reference], reference), (config) => createAsyncImageTask(config, "draw"), (config) => createAsyncImageEditTask(config, "edit", [reference])];
    try {
        for (const send of requests) {
            for (const channelMode of ["remote", "local"]) {
                for (const size of ["3840x2160", "auto"]) {
                    await send({
                        ...defaultConfig,
                        channelMode,
                        model: "image-1k",
                        imageModel: "other-4k",
                        size,
                        quality: "high",
                        count: "1",
                        imageRequestFormats: [
                            { model: "image-1k", format: "default", canvasRequestMode: "split", resolutions: ["1k"] },
                            { model: "other-4k", format: "default", canvasRequestMode: "split", resolutions: ["4k"] },
                        ],
                    });
                    const sentSize = body instanceof FormData ? (body.get("size") ?? undefined) : body.size;
                    assert.equal(sentSize, channelMode === "remote" ? (size === "auto" ? "1024x1024" : "1536x864") : size === "auto" ? undefined : "3840x2160");
                }
            }
        }
    } finally {
        axios.post = previousPost;
        useConfigStore.setState({ publicSettings: previousPublicSettings });
    }
});

test("history retries use current published model resolutions rather than saved config limits", async () => {
    const { requestGeneration, requestEdit } = await import("./image.ts");
    const { useConfigStore } = await import("../../stores/use-config-store.ts");
    const previousSettings = useConfigStore.getState().publicSettings;
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] }, headers: { "x-generation-task-id": "platform" } };
    };
    const reference = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
    useConfigStore.setState({ publicSettings: { modelChannel: { imageRequestFormats: [{ model: "image", format: "default", canvasRequestMode: "split", resolutions: ["1k"] }] } } });
    try {
        for (const send of [(config) => requestGeneration(config, "retry"), (config) => requestEdit(config, "retry", [reference]), (config) => createAsyncImageTask(config, "retry"), (config) => createAsyncImageEditTask(config, "retry", [reference])]) {
            for (const channelMode of ["remote", "local"]) {
                await send({
                    ...defaultConfig,
                    channelMode,
                    model: "image",
                    imageModel: "other",
                    size: "3840x2160",
                    quality: "high",
                    count: "1",
                    imageRequestFormats: [{ model: "image", format: "default", canvasRequestMode: "split", resolutions: ["4k"] }],
                });
                assert.equal(body instanceof FormData ? body.get("size") : body.size, channelMode === "remote" ? "1536x864" : "3840x2160");
            }
        }
    } finally {
        axios.post = previousPost;
        useConfigStore.setState({ publicSettings: previousSettings });
    }
});

test("Gemini public image requests reject unsupported 9:21 instead of silently generating 9:16", async () => {
    const { requestGeneration, requestEdit } = await import("./image.ts");
    const previousPost = axios.post;
    let sent = false;
    axios.post = async () => {
        sent = true;
        return { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }] } };
    };
    const language = (await import("../../i18n/index.ts")).default;
    const previousLanguage = language.language;
    await language.changeLanguage("zh-CN");
    const model = "gemini-3-pro-image";
    try {
        for (const size of ["9:21", "864x2016", "1152x2688", "1648x3840"]) {
            const config = { ...defaultConfig, channelMode: "local", model, size, quality: "auto", count: "1", channels: [{ id: "gemini", name: "Gemini", baseUrl: "https://gemini.example", apiKey: "test", apiFormat: "gemini", models: [model] }] };
            await assert.rejects(() => requestGeneration(config, "draw"), /Gemini 不支持所选图片比例/);
            await assert.rejects(() => requestEdit(config, "edit", []), /Gemini 不支持所选图片比例/);
        }
        assert.equal(sent, false);
    } finally {
        axios.post = previousPost;
        await language.changeLanguage(previousLanguage);
    }
});
