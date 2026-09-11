import assert from "node:assert/strict";
import { test } from "node:test";

import i18n from "../../i18n/index.ts";
import {
    buildGenerationCommand,
    buildVideoGenerationSettings,
    buildShortDramaGenerationSettings,
    GenerationPollingPausedError,
    generationStatusLabel,
    generationTaskId,
    pollGenerationTask,
    readGeneratedVideoFile,
    resolveCanvasVideoSubmission,
} from "./generation-contract.ts";
import { generationErrorMessage, generationQueryErrorMessage, generationRequestErrorMessage, readGenerationError, retryableGenerationQueryError } from "./generations.ts";
import { ApiError } from "./request.ts";

await i18n.changeLanguage("en-US");

test("builds the first-party prompt-only video command", () => {
    assert.deepEqual(
        buildGenerationCommand({
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            prompt: "人物走进雨夜街道",
        }),
        {
            commandVersion: 1,
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            intent: { kind: "video.generate", prompt: "人物走进雨夜街道", references: { images: [], videos: [], audios: [] } },
        },
    );
});

test("builds Canvas settings from the public profile projection", () => {
    const profile = {
        id: "seedance-1-5-pro",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "16:9" },
                resolution: { type: "enum", values: ["720p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 8, allowAuto: true, default: -1 },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };

    assert.deepEqual(buildVideoGenerationSettings(profile, { aspectRatio: "21:9", resolution: "1080p", durationSeconds: 12, generateAudio: false, watermark: true }), {
        aspectRatio: "16:9",
        resolution: "720p",
        durationSeconds: 8,
        generateAudio: false,
        watermark: true,
    });
});

test("uses public Profile defaults for legacy Canvas nodes without video metadata", () => {
    const profile = {
        id: "seedance-1-5-pro",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["adaptive", "16:9"], default: "adaptive" },
                resolution: { type: "enum", values: ["720p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 12, allowAuto: true, default: -1 },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };

    assert.deepEqual(buildVideoGenerationSettings(profile, {}), {
        aspectRatio: "adaptive",
        resolution: "720p",
        durationSeconds: -1,
        generateAudio: true,
        watermark: false,
    });
});

test("builds only Sora-declared first-party video settings", () => {
    const profile = {
        id: "sora-pro",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "16:9" },
                resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 20, default: 4 },
            },
        },
    };

    assert.deepEqual(buildVideoGenerationSettings(profile, { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 8, generateAudio: true, watermark: true }), {
        aspectRatio: "9:16",
        resolution: "1080p",
        durationSeconds: 8,
    });
});

test("builds a first-party video command with typed platform settings", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const command = buildGenerationCommand({
        clientRequestId: "request-settings",
        modelProfileId: "seedance-1-5-pro",
        source: "canvas",
        prompt: "竖屏视频",
        settings,
    });

    assert.deepEqual(command.intent.settings, settings);
    const serialized = JSON.stringify(command);
    for (const providerField of ["ratio", "duration", "generate_audio"]) assert.equal(serialized.includes(`\"${providerField}\"`), false);
});

test("builds Drama settings with platform auto semantics", () => {
    const profile = {
        id: "vidu-q3-drama",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "9:16" },
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 8, max: 12, allowAuto: true, default: "auto" },
                quality: { type: "enum", values: ["standard", "high"], default: "high" },
            },
        },
    };

    assert.deepEqual(buildShortDramaGenerationSettings(profile, { aspectRatio: "16:9", resolution: "720p", durationSeconds: "auto", quality: "standard" }), {
        aspectRatio: "16:9",
        resolution: "1080p",
        durationSeconds: "auto",
        quality: "standard",
    });
    assert.deepEqual(buildShortDramaGenerationSettings(profile, { durationSeconds: 20 }), {
        aspectRatio: "9:16",
        resolution: "1080p",
        durationSeconds: 12,
        quality: "high",
    });
});

test("keeps first-party task identity compatible with old Canvas nodes", () => {
    assert.equal(generationTaskId({ generationTaskId: "platform-new", upstreamTaskId: "legacy-old" }), "platform-new");
    assert.equal(generationTaskId({ upstreamTaskId: "legacy-old" }), "legacy-old");
    assert.equal(generationTaskId({}), "");
    assert.equal(generationStatusLabel("queued"), "Queued");
    assert.equal(generationStatusLabel("running"), "Generating");
});

test("reports queued and running before returning a structured terminal task", async () => {
    const tasks = [{ status: "queued" }, { status: "running" }, { status: "failed", error: { code: "INVALID_SETTING", message: "设置无效", retryable: false, fieldPath: "intent.settings.durationSeconds", resourceId: "node-1" } }];
    const statuses = [];
    const terminal = await pollGenerationTask(
        async () => tasks.shift(),
        async () => {},
        (task) => statuses.push(task.status),
        3,
    );
    assert.deepEqual(statuses, ["queued", "running", "failed"]);
    assert.deepEqual(terminal.error, { code: "INVALID_SETTING", message: "设置无效", retryable: false, fieldPath: "intent.settings.durationSeconds", resourceId: "node-1" });
});

test("keeps polling through the 30-minute default window", async () => {
    let polls = 0;
    const terminal = await pollGenerationTask(
        async () => {
            polls += 1;
            return polls === 360 ? { status: "succeeded" } : { status: "running" };
        },
        async () => {},
    );

    assert.equal(polls, 360);
    assert.equal(terminal.status, "succeeded");
});

test("resets retryable query errors after a valid running response", async () => {
    const retryableError = new Error("temporary connection failure");
    const responses = [...Array(19).fill(retryableError), { status: "running" }, ...Array(19).fill(retryableError), { status: "succeeded" }];
    const terminal = await pollGenerationTask(
        async () => {
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        async () => {},
        undefined,
        2,
        () => true,
        20,
    );

    assert.equal(terminal.status, "succeeded");
});

test("pauses local observation after twenty consecutive retryable query errors", async () => {
    const queryError = new Error("temporary connection failure");
    let loads = 0;

    await assert.rejects(
        pollGenerationTask(
            async () => {
                loads += 1;
                throw queryError;
            },
            async () => {},
            undefined,
            1,
            () => true,
            20,
        ),
        (error) => {
            assert.ok(error instanceof GenerationPollingPausedError);
            assert.equal(error.queryError, queryError);
            return true;
        },
    );
    assert.equal(loads, 20);
});

test("retries only temporary generation query errors", () => {
    assert.equal(retryableGenerationQueryError(new Error("network")), true);
    assert.equal(retryableGenerationQueryError(new DOMException("Aborted", "AbortError")), false);
    for (const status of [200, 408, 409, 425, 429, 500, 503]) {
        assert.equal(retryableGenerationQueryError(new ApiError("temporary", status, null)), true);
    }
    for (const status of [401, 403, 404]) {
        assert.equal(retryableGenerationQueryError(new ApiError("permanent", status, null)), false);
    }
});

test("recovers first-party polling after a temporary 409 query response", async () => {
    const responses = [new ApiError("Conflict", 409, null), { status: "succeeded" }];
    const terminal = await pollGenerationTask(
        async () => {
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        async () => {},
        undefined,
        1,
        retryableGenerationQueryError,
    );

    assert.equal(terminal.status, "succeeded");
});

test("shows the stable video failure reason instead of a coarse backend message", async () => {
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        assert.equal(generationErrorMessage({ code: "GENERATION_TIMEOUT", message: "上游拒绝生成", retryable: false }), "视频生成超时");
        assert.equal(generationErrorMessage({ code: "TASK_SYNC_TIMEOUT", message: "后端服务失败", retryable: false }), "视频任务状态同步超时");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_RATE_LIMITED", message: "操作失败", retryable: true }), "上游服务限流");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_UNAVAILABLE", message: "后端服务未启用", retryable: true }), "上游服务暂时不可用");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_TIMEOUT", message: "上游拒绝生成", retryable: false }), "视频生成超时");
        assert.equal(generationErrorMessage({ code: "CONTENT_REJECTED", message: "上游拒绝生成", retryable: false }), "生成内容未通过安全审核");
        assert.equal(generationErrorMessage({ code: "INVALID_REQUEST", message: "操作失败", retryable: false }), "生成参数或输入无效");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_AUTH_FAILED", message: "操作失败", retryable: false }), "上游服务认证失败");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_PERMISSION_DENIED", message: "操作失败", retryable: false }), "上游服务无访问权限");
        assert.equal(generationErrorMessage({ code: "MODEL_CONFIGURATION_INVALID", message: "后端服务未启用", retryable: false }), "生成模型配置不可用");
        assert.equal(generationErrorMessage({ code: "MEDIA_REFERENCE_UNAVAILABLE", message: "操作失败", retryable: false }), "参考素材暂时不可用");
        assert.equal(generationErrorMessage({ code: "UPSTREAM_NOT_FOUND", message: "操作失败", retryable: false }), "上游任务或生成接口不存在");
        assert.equal(generationErrorMessage({ code: "RESULT_PERSIST_FAILED", message: "操作失败", retryable: true }), "生成结果暂时无法保存");
        assert.equal(generationErrorMessage({ code: "RESULT_FILE_MISSING", message: "操作失败", retryable: false }), "生成结果文件保存失败");
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("keeps a stable generation error code when retryable is omitted", () => {
    const error = new ApiError("操作失败", 200, { code: "MODEL_CONFIGURATION_INVALID" });
    assert.deepEqual(readGenerationError(error), {
        code: "MODEL_CONFIGURATION_INVALID",
        message: "操作失败",
        retryable: false,
    });
});

test("shows the concrete query failure when first-party polling is paused", async () => {
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        assert.equal(generationQueryErrorMessage(new ApiError("后端服务失败", 504, null)), "视频任务查询超时");
        assert.equal(generationQueryErrorMessage(new ApiError("操作失败", 429, null)), "上游服务限流");
        assert.equal(generationQueryErrorMessage(new ApiError("操作失败", 500, null)), "视频生成服务异常");
        assert.equal(generationQueryErrorMessage(new ApiError("操作失败", 401, null)), "上游服务认证失败");
        assert.equal(generationQueryErrorMessage(new ApiError("操作失败", 403, null)), "上游服务无访问权限");
        assert.equal(generationQueryErrorMessage(new ApiError("操作失败", 404, null)), "上游任务或生成接口不存在");
        assert.equal(generationQueryErrorMessage(new Error("temporary connection failure")), "视频任务查询暂时失败，已暂停自动查询");
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("replaces unstructured first-party coarse failures before writing the video node", async () => {
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        assert.equal(generationRequestErrorMessage(new ApiError("操作失败", 500, null), "视频任务创建失败"), "视频生成服务异常");
        assert.equal(generationRequestErrorMessage(new ApiError("后端服务未启用", 200, null), "视频任务创建失败"), "视频生成服务未配置或未启用");
        assert.equal(generationRequestErrorMessage(new ApiError("操作失败", 401, null), "视频任务创建失败"), "上游服务认证失败");
        assert.equal(generationRequestErrorMessage(new ApiError("操作失败", 403, null), "视频任务创建失败"), "上游服务无访问权限");
        assert.equal(generationRequestErrorMessage(new ApiError("操作失败", 404, null), "视频任务创建失败"), "上游任务或生成接口不存在");
        assert.equal(generationRequestErrorMessage(new Error("操作失败"), "视频任务创建失败"), "视频任务创建失败");
        assert.equal(generationRequestErrorMessage(new Error("参考素材已失效"), "视频任务创建失败"), "参考素材已失效");
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("selects the Canvas video submission boundary without remote fallback", () => {
    assert.equal(resolveCanvasVideoSubmission("remote", { id: "seedance-1-5-pro" }), "first-party");
    assert.throws(() => resolveCanvasVideoSubmission("remote", undefined), /does not support first-party Canvas video generation/);
    assert.equal(resolveCanvasVideoSubmission("local", undefined), "local-compatibility");
});

test("reads only normalized platform video results", () => {
    assert.deepEqual(readGeneratedVideoFile({ kind: "video", file: { fileId: "file-1", mimeType: "video/mp4", bytes: 42 } }), {
        fileId: "file-1",
        mimeType: "video/mp4",
        bytes: 42,
    });
    assert.deepEqual(readGeneratedVideoFile({ kind: "short-drama", file: { fileId: "file-2", mimeType: "video/mp4" }, shots: [{ index: 1, status: "success" }] }), {
        fileId: "file-2",
        mimeType: "video/mp4",
    });
    assert.equal(readGeneratedVideoFile({ kind: "video", file: { fileId: "", mimeType: "video/mp4" } }), null);
    assert.equal(readGeneratedVideoFile({ kind: "video", file: { fileId: "   ", mimeType: "video/mp4" } }), null);
    assert.equal(readGeneratedVideoFile({ videoUrl: "https://provider.example/signed.mp4" }), null);
    assert.equal(readGeneratedVideoFile({ content: { video_url: "https://provider.example/raw.mp4" } }), null);
});

test("builds a first-party video command with platform media references", () => {
    const references = {
        images: [{ fileId: "image-1", sourceNodeId: "node-image", name: "参考图" }],
        videos: [{ fileId: "video-1", sourceNodeId: "node-video", name: "参考视频" }],
        audios: [{ fileId: "audio-1", sourceNodeId: "node-audio", name: "参考音频" }],
    };

    const command = buildGenerationCommand({
        clientRequestId: "request-media",
        modelProfileId: "seedance-1-5-pro",
        source: "canvas",
        prompt: "组合这些素材",
        references,
    });

    assert.deepEqual(command.intent.references, references);
    assert.equal(JSON.stringify(command).includes("storageKey"), false);
    assert.equal(JSON.stringify(command).includes("dataUrl"), false);
    assert.equal(JSON.stringify(command).includes("image_url"), false);
});

test("video mode is projected only from a Profile that explicitly supports it", () => {
    const profile = {
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
                resolution: { type: "enum", values: ["720p"], default: "720p" },
                durationSeconds: { type: "duration", min: 2, max: 60, default: 5 },
                videoMode: { type: "enum", values: ["reference", "frames"], default: "reference" },
            },
        },
    };
    assert.deepEqual(buildVideoGenerationSettings(profile, { videoMode: "frames", durationSeconds: 55 }), {
        aspectRatio: "16:9",
        resolution: "720p",
        durationSeconds: 55,
        videoMode: "frames",
    });
    assert.equal(buildVideoGenerationSettings(profile, {}).videoMode, "reference");
    delete profile.capabilities.settings.videoMode;
    assert.equal(Object.hasOwn(buildVideoGenerationSettings(profile, { videoMode: "frames" }), "videoMode"), false);
});

test("exhausting the observation window pauses polling without declaring generation timeout", async () => {
    let polls = 0;
    await assert.rejects(
        pollGenerationTask(async () => { polls += 1; return { status: "running" }; }, async () => {}, undefined, 2),
        (error) => error instanceof GenerationPollingPausedError,
    );
    assert.equal(polls, 2);
});
