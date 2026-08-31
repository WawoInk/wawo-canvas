export type StoryboardAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export type StoryboardOptions = {
    aspectRatio: StoryboardAspectRatio;
    targetDurationSec: number;
    style: string;
    maxSegmentDurationSec: number;
    maxShotDurationSec: number;
    dialogueMustBeExact: boolean;
    allowMusic: boolean;
};

export type DirectorPlanScene = {
    sceneNo: number;
    sourceRefs: string[];
    location: string;
    time: string;
    characters: string[];
    emotion: string;
    summary: string;
    estimatedDurationSec: number;
};

export type DirectorPlan = {
    schemaVersion: "1.0";
    title: string;
    sourceType: "script";
    scenes: DirectorPlanScene[];
};

export type StoryboardShot = {
    id: string;
    shotNo: number;
    visual: string;
    durationSec: number;
    framing: string;
    camera: string;
    dialogue: string;
    sound: string;
    sourceRefs: string[];
};

export type StoryboardSegment = {
    id: string;
    segmentNo: number;
    durationSec: number;
    assetIds: number[];
    shots: StoryboardShot[];
};

export type StoryboardScene = {
    id: string;
    sceneNo: number;
    sourceRefs: string[];
    location: string;
    time: string;
    characters: string[];
    emotion: string;
    segments: StoryboardSegment[];
};

export type StoryboardDocument = {
    schemaVersion: "1.0";
    title: string;
    sourceType: "script";
    aspectRatio: StoryboardAspectRatio;
    targetDurationSec: number;
    scenes: StoryboardScene[];
};

export type StoryboardValidationIssue = {
    code: string;
    message: string;
    path: string;
};

export type StoryboardValidation = {
    status: "passed" | "warning" | "failed";
    errors: StoryboardValidationIssue[];
    warnings: StoryboardValidationIssue[];
};

export type StoryboardPipelineInput = {
    title: string;
    source: string;
    options: StoryboardOptions;
};

export type StoryboardStage = "planning" | "generating" | "validating";
export type StoryboardStatus = "draft" | "ready";

export type StructuredCompletion = {
    content: string;
    toolCalls: Array<{ function: { name: string; arguments: string } }>;
};

export type StoryboardCompletionRequest = {
    toolName: "submit_director_plan" | "submit_storyboard_document";
    toolDescription: string;
    schema: Record<string, unknown>;
    prompt: string;
};

export type StoryboardPipelineResult = {
    sourceHash: string;
    directorPlan: DirectorPlan;
    document: StoryboardDocument;
    validation: StoryboardValidation;
};

export type StoryboardRecord = StoryboardPipelineInput & {
    id: string;
    model: string;
    sourceHash: string;
    directorPlan: DirectorPlan | null;
    document: StoryboardDocument | null;
    validation: StoryboardValidation | null;
    status: StoryboardStatus;
    revision: number;
    createdAt: number;
    updatedAt: number;
};

export const defaultStoryboardOptions: StoryboardOptions = {
    aspectRatio: "9:16",
    targetDurationSec: 60,
    style: "电影叙事",
    maxSegmentDurationSec: 15,
    maxShotDurationSec: 8,
    dialogueMustBeExact: true,
    allowMusic: false,
};

const directorPlanSchema = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "title", "sourceType", "scenes"],
    properties: {
        schemaVersion: { type: "string", const: "1.0" },
        title: { type: "string" },
        sourceType: { type: "string", const: "script" },
        scenes: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["sceneNo", "sourceRefs", "location", "time", "characters", "emotion", "summary", "estimatedDurationSec"],
                properties: {
                    sceneNo: { type: "integer", minimum: 1 },
                    sourceRefs: { type: "array", items: { type: "string" } },
                    location: { type: "string" },
                    time: { type: "string" },
                    characters: { type: "array", items: { type: "string" } },
                    emotion: { type: "string" },
                    summary: { type: "string" },
                    estimatedDurationSec: { type: "integer", minimum: 1 },
                },
            },
        },
    },
};

const storyboardDocumentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "title", "sourceType", "aspectRatio", "targetDurationSec", "scenes"],
    properties: {
        schemaVersion: { type: "string", const: "1.0" },
        title: { type: "string" },
        sourceType: { type: "string", const: "script" },
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3", "3:4"] },
        targetDurationSec: { type: "integer", minimum: 1 },
        scenes: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["sceneNo", "sourceRefs", "location", "time", "characters", "emotion", "segments"],
                properties: {
                    sceneNo: { type: "integer", minimum: 1 },
                    sourceRefs: { type: "array", items: { type: "string" } },
                    location: { type: "string" },
                    time: { type: "string" },
                    characters: { type: "array", items: { type: "string" } },
                    emotion: { type: "string" },
                    segments: {
                        type: "array",
                        minItems: 1,
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["segmentNo", "durationSec", "assetIds", "shots"],
                            properties: {
                                segmentNo: { type: "integer", minimum: 1 },
                                durationSec: { type: "integer", minimum: 1 },
                                assetIds: { type: "array", items: { type: "integer" } },
                                shots: {
                                    type: "array",
                                    minItems: 1,
                                    items: {
                                        type: "object",
                                        additionalProperties: false,
                                        required: ["shotNo", "visual", "durationSec", "framing", "camera", "dialogue", "sound", "sourceRefs"],
                                        properties: {
                                            shotNo: { type: "integer", minimum: 1 },
                                            visual: { type: "string" },
                                            durationSec: { type: "integer", minimum: 1 },
                                            framing: { type: "string" },
                                            camera: { type: "string" },
                                            dialogue: { type: "string" },
                                            sound: { type: "string" },
                                            sourceRefs: { type: "array", items: { type: "string" } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};

export async function runStoryboardPipeline(
    input: StoryboardPipelineInput,
    complete: (request: StoryboardCompletionRequest) => Promise<StructuredCompletion>,
    onStage?: (stage: StoryboardStage) => void,
): Promise<StoryboardPipelineResult> {
    const title = input.title.trim() || "未命名分镜";
    const source = input.source.trim();
    if (!source) throw new Error("请输入剧本文本");

    onStage?.("planning");
    const directorResult = await complete({
        toolName: "submit_director_plan",
        toolDescription: "提交场次级导演规划",
        schema: directorPlanSchema,
        prompt: directorPrompt({ ...input, title, source }),
    });
    const directorPlan = readDirectorPlan(parseStructuredCompletion(directorResult, "submit_director_plan"));

    onStage?.("generating");
    const documentResult = await complete({
        toolName: "submit_storyboard_document",
        toolDescription: "提交结构化分镜文档",
        schema: storyboardDocumentSchema,
        prompt: storyboardPrompt({ ...input, title, source }, directorPlan),
    });
    const document = readStoryboardDocument(parseStructuredCompletion(documentResult, "submit_storyboard_document"));

    onStage?.("validating");
    return {
        sourceHash: await sha256Text(source),
        directorPlan,
        document,
        validation: validateStoryboardDocument(document, source, input.options),
    };
}

export function parseStructuredCompletion(result: StructuredCompletion, toolName: StoryboardCompletionRequest["toolName"]) {
    const raw = result.toolCalls.find((call) => call.function.name === toolName)?.function.arguments || result.content;
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    if (!text) throw new Error("模型未返回结构化结果");
    try {
        return JSON.parse(text) as unknown;
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("模型返回的 JSON 无法解析");
        try {
            return JSON.parse(text.slice(start, end + 1)) as unknown;
        } catch {
            throw new Error("模型返回的 JSON 无法解析");
        }
    }
}

export function validateStoryboardDocument(document: StoryboardDocument, source: string, options: StoryboardOptions): StoryboardValidation {
    const errors: StoryboardValidationIssue[] = [];
    const warnings: StoryboardValidationIssue[] = [];
    const normalizedSource = compactText(source);
    let totalDuration = 0;

    if (document.aspectRatio !== options.aspectRatio) errors.push(issue("ASPECT_RATIO_MISMATCH", `分镜画幅必须为 ${options.aspectRatio}`, "aspectRatio"));
    if (document.targetDurationSec !== options.targetDurationSec) errors.push(issue("TARGET_DURATION_MISMATCH", `分镜目标时长必须为 ${options.targetDurationSec} 秒`, "targetDurationSec"));

    document.scenes.forEach((scene, sceneIndex) => {
        const scenePath = `scenes[${sceneIndex}]`;
        if (scene.sceneNo !== sceneIndex + 1) errors.push(issue("SCENE_NUMBER_INVALID", "场次编号必须连续", `${scenePath}.sceneNo`));
        if (!scene.sourceRefs.length) warnings.push(issue("SOURCE_REF_MISSING", "场次缺少原文定位", `${scenePath}.sourceRefs`));
        scene.segments.forEach((segment, segmentIndex) => {
            const segmentPath = `${scenePath}.segments[${segmentIndex}]`;
            const shotDuration = segment.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
            totalDuration += segment.durationSec;
            if (segment.segmentNo !== segmentIndex + 1) errors.push(issue("SEGMENT_NUMBER_INVALID", "片段编号必须连续", `${segmentPath}.segmentNo`));
            if (segment.durationSec !== shotDuration) errors.push(issue("SEGMENT_DURATION_MISMATCH", "片段时长必须等于镜头时长之和", `${segmentPath}.durationSec`));
            if (segment.durationSec > options.maxSegmentDurationSec) errors.push(issue("SEGMENT_DURATION_EXCEEDED", `片段时长不能超过 ${options.maxSegmentDurationSec} 秒`, `${segmentPath}.durationSec`));
            segment.shots.forEach((shot, shotIndex) => {
                const shotPath = `${segmentPath}.shots[${shotIndex}]`;
                if (shot.shotNo !== shotIndex + 1) errors.push(issue("SHOT_NUMBER_INVALID", "镜头编号必须连续", `${shotPath}.shotNo`));
                if (shot.durationSec <= 0) errors.push(issue("SHOT_DURATION_INVALID", "镜头时长必须大于 0", `${shotPath}.durationSec`));
                if (shot.durationSec > options.maxShotDurationSec) errors.push(issue("SHOT_DURATION_EXCEEDED", `镜头时长不能超过 ${options.maxShotDurationSec} 秒`, `${shotPath}.durationSec`));
                if (!shot.visual.trim()) errors.push(issue("SHOT_VISUAL_REQUIRED", "镜头画面不能为空", `${shotPath}.visual`));
                if (!shot.sourceRefs.length) warnings.push(issue("SOURCE_REF_MISSING", "镜头缺少原文定位", `${shotPath}.sourceRefs`));
                if (options.dialogueMustBeExact && shot.dialogue.trim()) {
                    const full = compactText(shot.dialogue);
                    const spoken = compactText(shot.dialogue.replace(/^[^：:\n]{1,24}[：:]\s*/, ""));
                    if (!normalizedSource.includes(full) && !normalizedSource.includes(spoken)) errors.push(issue("DIALOGUE_NOT_IN_SOURCE", "台词不在原剧本中，可能被改写或新增", `${shotPath}.dialogue`));
                }
                if (!options.allowMusic && /(配乐|背景音乐|bgm|music)/i.test(shot.sound)) errors.push(issue("MUSIC_NOT_ALLOWED", "当前配置不允许音乐或配乐", `${shotPath}.sound`));
            });
        });
    });

    const tolerance = Math.max(3, Math.ceil(options.targetDurationSec * 0.2));
    if (Math.abs(totalDuration - options.targetDurationSec) > tolerance) warnings.push(issue("TARGET_DURATION_DEVIATION", `总时长 ${totalDuration} 秒与目标时长 ${options.targetDurationSec} 秒偏差较大`, "targetDurationSec"));
    return { status: errors.length ? "failed" : warnings.length ? "warning" : "passed", errors, warnings };
}

export function storyboardToMarkdown(document: StoryboardDocument) {
    const lines = [`# ${document.title}`, "", `- 画幅：${document.aspectRatio}`, `- 目标时长：${document.targetDurationSec} 秒`, ""];
    document.scenes.forEach((scene) => {
        lines.push(`## 场次 ${scene.sceneNo} · ${scene.location} · ${scene.time}`, "", `角色：${scene.characters.join("、") || "无"}`, `情绪：${scene.emotion || "-"}`, "");
        scene.segments.forEach((segment) => {
            lines.push(`### 片段 ${segment.segmentNo}（${segment.durationSec} 秒）`, "", "| 镜头 | 画面 | 时长 | 景别 | 运镜 | 台词/旁白 | 音效 |", "| --- | --- | ---: | --- | --- | --- | --- |");
            segment.shots.forEach((shot) => lines.push(`| ${shot.shotNo} | ${md(shot.visual)} | ${shot.durationSec}s | ${md(shot.framing)} | ${md(shot.camera)} | ${md(shot.dialogue)} | ${md(shot.sound)} |`));
            lines.push("");
        });
    });
    return lines.join("\n").trimEnd() + "\n";
}

export function normalizeStoryboardDocument(document: StoryboardDocument, current?: StoryboardDocument | null): StoryboardDocument {
    const usedIds = new Set<string>();
    const entityId = (currentId?: string) => {
        const id = currentId && !usedIds.has(currentId) ? currentId : crypto.randomUUID();
        usedIds.add(id);
        return id;
    };
    const reservedIds = <T extends { id: string }>(incoming: T[], currentById: Map<string, T>) =>
        new Set(incoming.flatMap((entity) => (currentById.has(entity.id) ? [entity.id] : [])));
    const previousEntity = <T extends { id: string }>(
        incomingId: string,
        number: number,
        currentById: Map<string, T>,
        currentByNumber: Map<number, T>,
        reserved: Set<string>,
    ) => {
        const byId = currentById.get(incomingId);
        if (byId && !usedIds.has(byId.id)) return byId;
        const byNumber = currentByNumber.get(number);
        return byNumber && !reserved.has(byNumber.id) && !usedIds.has(byNumber.id) ? byNumber : undefined;
    };

    const currentSceneList = current?.scenes || [];
    const currentScenesById = new Map(currentSceneList.map((scene) => [scene.id, scene]));
    const currentScenesByNumber = new Map(currentSceneList.map((scene) => [scene.sceneNo, scene]));
    const reservedScenes = reservedIds(document.scenes, currentScenesById);
    return {
        ...document,
        scenes: document.scenes.map((scene) => {
            const currentScene = previousEntity(scene.id, scene.sceneNo, currentScenesById, currentScenesByNumber, reservedScenes);
            const currentSegmentList = currentScene?.segments || [];
            const currentSegmentsById = new Map(currentSegmentList.map((segment) => [segment.id, segment]));
            const currentSegmentsByNumber = new Map(currentSegmentList.map((segment) => [segment.segmentNo, segment]));
            const reservedSegments = reservedIds(scene.segments, currentSegmentsById);
            return {
                ...scene,
                id: entityId(currentScene?.id),
                segments: scene.segments.map((segment) => {
                    const currentSegment = previousEntity(segment.id, segment.segmentNo, currentSegmentsById, currentSegmentsByNumber, reservedSegments);
                    const currentShotList = currentSegment?.shots || [];
                    const currentShotsById = new Map(currentShotList.map((shot) => [shot.id, shot]));
                    const currentShotsByNumber = new Map(currentShotList.map((shot) => [shot.shotNo, shot]));
                    const reservedShots = reservedIds(segment.shots, currentShotsById);
                    return {
                        ...segment,
                        id: entityId(currentSegment?.id),
                        shots: segment.shots.map((shot) => ({
                            ...shot,
                            id: entityId(previousEntity(shot.id, shot.shotNo, currentShotsById, currentShotsByNumber, reservedShots)?.id),
                        })),
                    };
                }),
            };
        }),
    };
}

function directorPrompt(input: StoryboardPipelineInput) {
    return `你是影视导演规划助手。请只规划场次，不设计具体镜头，不新增剧情，不改写台词。\n\n作品标题：${input.title}\n画幅：${input.options.aspectRatio}\n目标时长：${input.options.targetDurationSec} 秒\n风格：${input.options.style || "未指定"}\n\n请按地点、时间和戏剧单元拆分场次，保留人物、情绪变化、来源定位和预计时长。sourceRefs 使用 source:行号 或 source:段落号。\n\n【原始剧本】\n${input.source}`;
}

function storyboardPrompt(input: StoryboardPipelineInput, plan: DirectorPlan) {
    return `你是专业分镜师。请严格依据导演规划和原始剧本生成结构化分镜，不新增或遗漏剧情。\n\n硬性要求：\n- 画幅必须为 ${input.options.aspectRatio}\n- 目标总时长约 ${input.options.targetDurationSec} 秒\n- 每个片段不超过 ${input.options.maxSegmentDurationSec} 秒\n- 每个镜头不超过 ${input.options.maxShotDurationSec} 秒\n- 台词${input.options.dialogueMustBeExact ? "必须逐字保留" : "可在不改变含义的前提下精简"}\n- ${input.options.allowMusic ? "允许填写必要音乐" : "sound 只写环境音和动作音，禁止音乐/配乐"}\n- 每个场次和镜头必须保留 sourceRefs\n- assetIds 当前没有可用资产，必须返回空数组\n\n【导演规划】\n${JSON.stringify(plan, null, 2)}\n\n【原始剧本】\n${input.source}`;
}

function readDirectorPlan(value: unknown): DirectorPlan {
    const root = record(value, "directorPlan");
    return {
        schemaVersion: literal(root.schemaVersion, "1.0", "directorPlan.schemaVersion"),
        title: string(root.title, "directorPlan.title"),
        sourceType: literal(root.sourceType, "script", "directorPlan.sourceType"),
        scenes: array(root.scenes, "directorPlan.scenes").map((item, index) => {
            const scene = record(item, `directorPlan.scenes[${index}]`);
            return {
                sceneNo: integer(scene.sceneNo, `directorPlan.scenes[${index}].sceneNo`),
                sourceRefs: strings(scene.sourceRefs, `directorPlan.scenes[${index}].sourceRefs`),
                location: string(scene.location, `directorPlan.scenes[${index}].location`),
                time: string(scene.time, `directorPlan.scenes[${index}].time`),
                characters: strings(scene.characters, `directorPlan.scenes[${index}].characters`),
                emotion: string(scene.emotion, `directorPlan.scenes[${index}].emotion`),
                summary: string(scene.summary, `directorPlan.scenes[${index}].summary`),
                estimatedDurationSec: integer(scene.estimatedDurationSec, `directorPlan.scenes[${index}].estimatedDurationSec`),
            };
        }),
    };
}

function readStoryboardDocument(value: unknown): StoryboardDocument {
    const root = record(value, "document");
    const aspectRatio = string(root.aspectRatio, "document.aspectRatio");
    if (!["16:9", "9:16", "1:1", "4:3", "3:4"].includes(aspectRatio)) throw new Error("document.aspectRatio 格式无效");
    return normalizeStoryboardDocument({
        schemaVersion: literal(root.schemaVersion, "1.0", "document.schemaVersion"),
        title: string(root.title, "document.title"),
        sourceType: literal(root.sourceType, "script", "document.sourceType"),
        aspectRatio: aspectRatio as StoryboardAspectRatio,
        targetDurationSec: integer(root.targetDurationSec, "document.targetDurationSec"),
        scenes: array(root.scenes, "document.scenes").map((item, sceneIndex) => {
            const scenePath = `document.scenes[${sceneIndex}]`;
            const scene = record(item, scenePath);
            return {
                id: "",
                sceneNo: integer(scene.sceneNo, `${scenePath}.sceneNo`),
                sourceRefs: strings(scene.sourceRefs, `${scenePath}.sourceRefs`),
                location: string(scene.location, `${scenePath}.location`),
                time: string(scene.time, `${scenePath}.time`),
                characters: strings(scene.characters, `${scenePath}.characters`),
                emotion: string(scene.emotion, `${scenePath}.emotion`),
                segments: array(scene.segments, `${scenePath}.segments`).map((item, segmentIndex) => {
                    const segmentPath = `${scenePath}.segments[${segmentIndex}]`;
                    const segment = record(item, segmentPath);
                    return {
                        id: "",
                        segmentNo: integer(segment.segmentNo, `${segmentPath}.segmentNo`),
                        durationSec: integer(segment.durationSec, `${segmentPath}.durationSec`),
                        assetIds: list(segment.assetIds, `${segmentPath}.assetIds`).map((id, assetIndex) => integer(id, `${segmentPath}.assetIds[${assetIndex}]`)),
                        shots: array(segment.shots, `${segmentPath}.shots`).map((item, shotIndex) => {
                            const shotPath = `${segmentPath}.shots[${shotIndex}]`;
                            const shot = record(item, shotPath);
                            return {
                                id: "",
                                shotNo: integer(shot.shotNo, `${shotPath}.shotNo`),
                                visual: string(shot.visual, `${shotPath}.visual`),
                                durationSec: integer(shot.durationSec, `${shotPath}.durationSec`),
                                framing: string(shot.framing, `${shotPath}.framing`),
                                camera: string(shot.camera, `${shotPath}.camera`),
                                dialogue: string(shot.dialogue, `${shotPath}.dialogue`),
                                sound: string(shot.sound, `${shotPath}.sound`),
                                sourceRefs: strings(shot.sourceRefs, `${shotPath}.sourceRefs`),
                            };
                        }),
                    };
                }),
            };
        }),
    });
}

async function sha256Text(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function issue(code: string, message: string, path: string): StoryboardValidationIssue {
    return { code, message, path };
}

function compactText(value: string) {
    return value.replace(/\s+/g, "");
}

function md(value: string) {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>") || "-";
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
    return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
    return value;
}

function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value) || !value.length) throw new Error(`${path} 必须是非空数组`);
    return value;
}

function string(value: unknown, path: string) {
    if (typeof value !== "string") throw new Error(`${path} 必须是字符串`);
    return value;
}

function strings(value: unknown, path: string) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} 必须是字符串数组`);
    return value as string[];
}

function integer(value: unknown, path: string) {
    if (!Number.isInteger(value)) throw new Error(`${path} 必须是整数`);
    return value as number;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
    if (value !== expected) throw new Error(`${path} 必须是 ${expected}`);
    return expected;
}
