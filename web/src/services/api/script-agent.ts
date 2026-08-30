import { requestToolResponse, type ResponseFunctionTool } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import {
    assertCanGenerateAdaptationStrategy,
    assertCanGenerateScriptBatch,
    parseAdaptationStrategyResult,
    parseScriptEpisodeResult,
    parseStorySkeletonResult,
    transitionScriptAgentStage,
    validateScriptBatch,
    validateScriptProjectConfig,
    ScriptAgentError,
    type ScriptAgentStage,
    type ScriptArtifactReview,
    type ScriptProjectConfig,
    type ScriptProjectConfigInput,
    type ScriptReviewGrade,
    type ScriptReviewIssue,
} from "@/pages/storyboard/script-agent";
import { appendScriptAgentMessage, type ScriptAgentWorkspaceRecord } from "@/pages/storyboard/script-agent-storage";

export type ScriptAgentEvent = { type: "phase"; phase: ScriptAgentStage } | { type: "delta"; text: string };

export type ScriptAgentRequestOptions = {
    signal?: AbortSignal;
    onEvent?: (event: ScriptAgentEvent) => void;
    onCheckpoint?: (workspace: ScriptAgentWorkspaceRecord) => Promise<ScriptAgentWorkspaceRecord>;
};

export type ScriptAgentAction = "confirm" | "approve" | "fix" | "redo" | "continue" | "retry";

type ToolResult = { content: string; toolCalls: Array<{ function?: { name?: string; arguments?: string } }> };
type ConfigDecision = {
    action: "collect" | "confirm";
    reply: string;
    title: string | null;
    source: string | null;
    config: Partial<ScriptProjectConfigInput> | null;
};
type WorkflowDecision = { action: "approve" | "fix" | "redo" | "continue" | "none"; reply: string; instruction: string | null };

const aspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
const configKeys: (keyof ScriptProjectConfigInput)[] = ["totalEpisodes", "episodeMinutes", "startChapter", "endChapter", "chapterIndexes", "platform", "aspectRatio", "style", "paywall"];

function requestConfig(config: AiConfig) {
    const model = config.textModel.trim() || config.model.trim();
    if (!model) throw new Error("请先配置可用的文本模型");
    return { ...config, model, textModel: model };
}

function tool(name: string, description: string, parameters: Record<string, unknown>): ResponseFunctionTool {
    return { type: "function", function: { name, description, parameters, strict: true } };
}

async function complete(config: AiConfig, prompt: string, requestTool: ResponseFunctionTool, options?: ScriptAgentRequestOptions): Promise<ToolResult> {
    const response = await requestToolResponse(requestConfig(config), [{ role: "user", content: prompt }], [requestTool], "required", (text) => options?.onEvent?.({ type: "delta", text }), { signal: options?.signal });
    return response;
}

function structuredJson(result: ToolResult, toolName: string): Record<string, unknown> {
    const call = result.toolCalls.find((item) => item.function?.name === toolName);
    const raw =
        call?.function?.arguments ||
        result.content
            .trim()
            .replace(/^```json\s*/i, "")
            .replace(/\s*```$/, "");
    if (!raw) throw new Error(`缺少结构化结果：${toolName}`);
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
        return value as Record<string, unknown>;
    } catch {
        throw new Error("AI 返回的结构化结果无效，请重试");
    }
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function partialConfig(value: unknown): Partial<ScriptProjectConfigInput> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const result: Partial<ScriptProjectConfigInput> = {};
    for (const key of configKeys) {
        const item = input[key];
        if (key === "chapterIndexes" && Array.isArray(item)) {
            const chapters = item.filter((chapter): chapter is number => Number.isInteger(chapter) && chapter > 0);
            if (chapters.length) result.chapterIndexes = chapters;
        } else if (["totalEpisodes", "episodeMinutes", "startChapter", "endChapter"].includes(key) && Number.isInteger(item) && Number(item) > 0) {
            result[key] = item as never;
        } else if (typeof item === "string" && Boolean(item.trim())) {
            result[key] = item.trim() as never;
        }
    }
    if (typeof result.aspectRatio === "string" && !aspectRatios.includes(result.aspectRatio as (typeof aspectRatios)[number])) delete result.aspectRatio;
    return result;
}

function chapterIndexesForRange(startChapter?: number, endChapter?: number) {
    const start = typeof startChapter === "number" ? startChapter : 0;
    const end = typeof endChapter === "number" ? endChapter : 0;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) return [];
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function completeConfig(title: string, source: string, draft: Partial<ScriptProjectConfigInput>) {
    const config = { ...draft };
    if (!config.chapterIndexes?.length && config.startChapter && config.endChapter) config.chapterIndexes = chapterIndexesForRange(config.startChapter, config.endChapter);
    if (!title || !source) return null;
    if (
        config.totalEpisodes === undefined ||
        config.episodeMinutes === undefined ||
        config.startChapter === undefined ||
        config.endChapter === undefined ||
        !config.chapterIndexes?.length ||
        !config.platform ||
        !config.aspectRatio ||
        !config.style ||
        !config.paywall
    )
        return null;
    return validateScriptProjectConfig(config as ScriptProjectConfigInput);
}

function patch(workspace: ScriptAgentWorkspaceRecord, changes: Partial<ScriptAgentWorkspaceRecord>) {
    return { ...workspace, ...changes, version: workspace.version + 1, updatedAt: new Date().toISOString() };
}

function assistant(workspace: ScriptAgentWorkspaceRecord, content: string) {
    return appendScriptAgentMessage(workspace, "assistant", content);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function emitPhase(options: ScriptAgentRequestOptions | undefined, phase: ScriptAgentStage) {
    options?.onEvent?.({ type: "phase", phase });
}

async function checkpoint(options: ScriptAgentRequestOptions | undefined, workspace: ScriptAgentWorkspaceRecord) {
    return options?.onCheckpoint ? options.onCheckpoint(workspace) : workspace;
}

const configTool = tool("submit_project_config", "提取剧本项目配置，并判断用户是否明确确认了配置。", {
    type: "object",
    additionalProperties: false,
    properties: {
        action: { type: "string", enum: ["collect", "confirm"] },
        reply: { type: "string" },
        title: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        config: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                totalEpisodes: { type: ["integer", "null"] },
                episodeMinutes: { type: ["integer", "null"] },
                startChapter: { type: ["integer", "null"] },
                endChapter: { type: ["integer", "null"] },
                chapterIndexes: { type: ["array", "null"], items: { type: "integer" } },
                platform: { type: ["string", "null"] },
                aspectRatio: { type: ["string", "null"], enum: [...aspectRatios, null] },
                style: { type: ["string", "null"] },
                paywall: { type: ["string", "null"] },
            },
            required: configKeys,
        },
    },
    required: ["action", "reply", "title", "source", "config"],
});

const decisionTool = tool("submit_workflow_decision", "理解用户对当前审核门的自然语言决定。", {
    type: "object",
    additionalProperties: false,
    properties: {
        action: { type: "string", enum: ["approve", "fix", "redo", "continue", "none"] },
        reply: { type: "string" },
        instruction: { type: ["string", "null"] },
    },
    required: ["action", "reply", "instruction"],
});

const storySkeletonTool = tool("submit_story_skeleton", "提交完整的故事骨架 Markdown。", {
    type: "object",
    additionalProperties: false,
    properties: { content: { type: "string" } },
    required: ["content"],
});

const adaptationTool = tool("submit_adaptation_strategy", "提交完整的关键决策记录 Markdown。", {
    type: "object",
    additionalProperties: false,
    properties: { content: { type: "string" } },
    required: ["content"],
});

const scriptEpisodeTool = tool("submit_script_episode", "提交一集且仅一集的剧本。", {
    type: "object",
    additionalProperties: false,
    properties: {
        script: {
            type: "object",
            additionalProperties: false,
            properties: {
                episodeNumber: { type: "integer" },
                name: { type: "string" },
                content: { type: "string" },
                sourceChapterIndexes: { type: "array", items: { type: "integer" } },
            },
            required: ["episodeNumber", "name", "content", "sourceChapterIndexes"],
        },
    },
    required: ["script"],
});

const reviewTool = tool("submit_artifact_review", "提交结构化审核报告，不修改被审核的产物。", {
    type: "object",
    additionalProperties: false,
    properties: {
        grade: { type: "string", enum: ["A", "B", "C", "D"] },
        summary: { type: "string" },
        issues: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    severity: { type: "string", enum: ["severe", "medium", "minor"] },
                    check: { type: "string" },
                    problem: { type: "string" },
                    suggestion: { type: "string" },
                },
                required: ["severity", "check", "problem", "suggestion"],
            },
        },
        decisions: { type: "array", items: { type: "string" } },
        markdown: { type: "string" },
    },
    required: ["grade", "summary", "issues", "decisions", "markdown"],
});

function projectConfigText(config: ScriptProjectConfig) {
    return JSON.stringify(config, null, 2);
}

export function buildScriptAgentConversationContext(workspace: Pick<ScriptAgentWorkspaceRecord, "messages" | "conversations" | "activeConversationId">, omitTrailingUserContent = "") {
    const active = workspace.conversations.find((conversation) => conversation.id === workspace.activeConversationId);
    const messages = active?.messages || workspace.messages;
    const history = omitTrailingUserContent.trim() && messages.at(-1)?.role === "user" && messages.at(-1)?.content.trim() === omitTrailingUserContent.trim() ? messages.slice(0, -1) : messages;
    if (!history.length) return "无历史对话";
    return history
        .slice(-12)
        .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.slice(0, 2000)}`)
        .join("\n")
        .slice(-12000);
}

function configPrompt(workspace: ScriptAgentWorkspaceRecord, message: string) {
    return `你是中文剧本项目配置助手。只处理配置收集，不生成故事骨架。
当前会话历史：
${buildScriptAgentConversationContext(workspace, message)}
用户消息：${message}
已有作品标题：${workspace.title || "未填写"}
已有剧本/故事素材：${workspace.source ? `${workspace.source.slice(0, 5000)}${workspace.source.length > 5000 ? "…" : ""}` : "未填写"}
已有配置草稿：${JSON.stringify(workspace.configDraft || {})}
请从用户消息中提取或更新：作品标题、故事/剧本素材、总集数、单集分钟数、章节起止范围、章节编号（没有单独编号时按范围推断）、平台、画幅、风格、付费策略。
只有用户明确说“确认配置”“开始生成故事骨架”或同义表达，并且全部字段齐全时，action 才能是 confirm；否则必须是 collect，并在 reply 中简洁列出缺少的字段或配置摘要。不要臆造用户没有提供的值，不要在 reply 中复述大段素材。`;
}

function skeletonPrompt(workspace: ScriptAgentWorkspaceRecord, instruction = "") {
    return `请根据以下项目资料生成故事骨架。必须只通过结构化结果提交 Markdown，不要输出 XML，不要输出解释。
当前会话历史：
${buildScriptAgentConversationContext(workspace)}
作品标题：${workspace.title}
项目配置：${projectConfigText(workspace.projectConfig as ScriptProjectConfig)}
故事/剧本素材：
${workspace.source}
${workspace.storySkeleton ? `旧故事骨架（仅用于修复参考）：\n${workspace.storySkeleton}` : ""}
${instruction ? `用户修复要求：${instruction}` : ""}
Markdown 必须包含标题“故事骨架”，并包含：故事核、隐线、人物小传、三幕结构、分集决策、全局删减决策记录、付费卡点设计、股价级反转登记表。`;
}

function adaptationPrompt(workspace: ScriptAgentWorkspaceRecord, instruction = "") {
    return `请根据项目资料和已批准的故事骨架生成改编策略。必须只通过结构化结果提交 Markdown，不要输出 XML，不要输出解释。
当前会话历史：
${buildScriptAgentConversationContext(workspace)}
作品标题：${workspace.title}
项目配置：${projectConfigText(workspace.projectConfig as ScriptProjectConfig)}
故事/剧本素材：\n${workspace.source}
已批准故事骨架：\n${workspace.storySkeleton}
${workspace.adaptationStrategy ? `旧改编策略（仅用于修复参考）：\n${workspace.adaptationStrategy}` : ""}
${instruction ? `用户修复要求：${instruction}` : ""}
Markdown 标题必须包含“关键决策记录”，并包含：核心改编原则、主要删除决策、世界观呈现策略。`;
}

function reviewPrompt(type: "story_skeleton" | "adaptation_strategy", content: string) {
    const label = type === "story_skeleton" ? "故事骨架" : "改编策略";
    return `请审核以下${label}，输出结构化审核报告，不要改写正文。grade 只能是 A/B/C/D；issues 必须是结构化数组；markdown 用简短 Markdown 总结审核结论。\n\n${content}`;
}

function scriptPrompt(workspace: ScriptAgentWorkspaceRecord, episodeNumber: number) {
    return `请只生成第 ${episodeNumber} 集剧本，并通过结构化结果返回一个 script 对象，禁止返回 scripts 数组或多集内容，不要输出 XML。
当前会话历史：
${buildScriptAgentConversationContext(workspace)}
作品标题：${workspace.title}
项目配置：${projectConfigText(workspace.projectConfig as ScriptProjectConfig)}
故事骨架：\n${workspace.storySkeleton}
改编策略：\n${workspace.adaptationStrategy}
素材：\n${workspace.source}
已生成集数：${workspace.scripts.map((script) => script.episodeNumber).join(", ") || "无"}
本集必须使用 episodeNumber=${episodeNumber}，name 中包含 EP${String(episodeNumber).padStart(2, "0")}，content 为符合既有剧本格式的 Markdown。`;
}

function parseReview(result: ToolResult, type: "story_skeleton" | "adaptation_strategy", version: number): ScriptArtifactReview {
    const root = structuredJson(result, "submit_artifact_review");
    const grades: ScriptReviewGrade[] = ["A", "B", "C", "D"];
    if (!grades.includes(root.grade as ScriptReviewGrade)) throw new ScriptAgentError("STRUCTURED_OUTPUT_INVALID", "审核等级必须是 A、B、C 或 D", "review.grade");
    const grade = root.grade as ScriptReviewGrade;
    const issues: ScriptReviewIssue[] = Array.isArray(root.issues)
        ? root.issues.flatMap((issue) => {
              if (!issue || typeof issue !== "object") return [];
              const value = issue as Record<string, unknown>;
              const severity = value.severity === "severe" || value.severity === "medium" || value.severity === "minor" ? value.severity : "minor";
              return [{ severity, check: stringValue(value.check), problem: stringValue(value.problem), suggestion: stringValue(value.suggestion) }];
          })
        : [];
    const summary = stringValue(root.summary) || "审核完成，请确认是否继续。";
    return {
        artifactType: type,
        artifactVersion: version,
        grade,
        summary,
        issues,
        decisions: Array.isArray(root.decisions) ? root.decisions.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [],
        markdown: stringValue(root.markdown) || `# 审核报告\n\n**评级：${grade}**\n\n${summary}`,
    };
}

async function runStorySkeleton(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, instruction: string, options?: ScriptAgentRequestOptions) {
    let current = workspace;
    const artifactVersion = (workspace.storySkeletonReview?.artifactVersion || 0) + 1;
    try {
        current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "start_story_skeleton"), storySkeletonStatus: "generating" });
        emitPhase(options, current.currentStage);
        const result = await complete(config, skeletonPrompt(current, instruction), storySkeletonTool, options);
        const skeleton = parseStorySkeletonResult(result).content;
        current = patch(current, {
            currentStage: transitionScriptAgentStage(current.currentStage, "finish_story_skeleton"),
            storySkeleton: skeleton,
            storySkeletonStatus: "generated",
            storySkeletonReview: undefined,
        });
        current = await checkpoint(options, current);
        current = patch(current, { storySkeletonStatus: "reviewing" });
        emitPhase(options, current.currentStage);
        const review = parseReview(await complete(config, reviewPrompt("story_skeleton", skeleton), reviewTool, options), "story_skeleton", artifactVersion);
        current = patch(current, {
            currentStage: transitionScriptAgentStage(current.currentStage, "finish_story_skeleton_review"),
            storySkeletonReview: review,
            storySkeletonStatus: "awaiting_user_decision",
        });
        emitPhase(options, current.currentStage);
        return assistant(current, `故事骨架已生成并完成审核（${review.grade}）。${review.summary}\n请确认通过，或告诉我需要修复/重做的部分。`);
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        const message = errorMessage(error);
        if (current.currentStage === "generating_story_skeleton" || current.currentStage === "reviewing_story_skeleton") current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "fail"), storySkeletonStatus: "failed" });
        return assistant(current, `故事骨架处理失败：${message}。你可以稍后重试。`);
    }
}

async function runAdaptationStrategy(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, instruction: string, options?: ScriptAgentRequestOptions) {
    let current = workspace;
    const artifactVersion = (workspace.adaptationReview?.artifactVersion || 0) + 1;
    try {
        assertCanGenerateAdaptationStrategy(current);
        current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "start_adaptation_strategy"), adaptationStatus: "generating" });
        emitPhase(options, current.currentStage);
        const result = await complete(config, adaptationPrompt(current, instruction), adaptationTool, options);
        const adaptation = parseAdaptationStrategyResult(result).content;
        current = patch(current, {
            currentStage: transitionScriptAgentStage(current.currentStage, "finish_adaptation_strategy"),
            adaptationStrategy: adaptation,
            adaptationStatus: "generated",
            adaptationReview: undefined,
        });
        current = await checkpoint(options, current);
        current = patch(current, { adaptationStatus: "reviewing" });
        emitPhase(options, current.currentStage);
        const review = parseReview(await complete(config, reviewPrompt("adaptation_strategy", adaptation), reviewTool, options), "adaptation_strategy", artifactVersion);
        current = patch(current, {
            currentStage: transitionScriptAgentStage(current.currentStage, "finish_adaptation_review"),
            adaptationReview: review,
            adaptationStatus: "awaiting_user_decision",
        });
        emitPhase(options, current.currentStage);
        return assistant(current, `改编策略已生成并完成审核（${review.grade}）。${review.summary}\n请确认通过，或告诉我需要修复/重做的部分。`);
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        const message = errorMessage(error);
        if (current.currentStage === "generating_adaptation_strategy" || current.currentStage === "reviewing_adaptation_strategy")
            current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "fail"), adaptationStatus: "failed" });
        return assistant(current, `改编策略处理失败：${message}。你可以稍后重试。`);
    }
}

function nextEpisodes(workspace: ScriptAgentWorkspaceRecord, count = 3) {
    const total = workspace.projectConfig?.totalEpisodes || 0;
    const existing = new Set(workspace.scripts.map((script) => script.episodeNumber));
    let next = 1;
    while (existing.has(next)) next += 1;
    const episodes: number[] = [];
    while (episodes.length < Math.min(count, 5) && next <= total && !existing.has(next)) {
        episodes.push(next);
        next += 1;
    }
    return episodes;
}

async function runScriptBatch(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, options?: ScriptAgentRequestOptions) {
    let current = workspace;
    try {
        const pendingEpisodes = nextEpisodes(current);
        if (!pendingEpisodes.length && current.projectConfig) return assistant(patch(current, { currentStage: "completed" }), "全部剧本已经完成。");
        const episodes = assertCanGenerateScriptBatch(current, pendingEpisodes);
        current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "open_script_batch_selection") });
        current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "select_script_batch") });
        emitPhase(options, current.currentStage);
        for (const episodeNumber of episodes) {
            const result = parseScriptEpisodeResult(await complete(config, scriptPrompt(current, episodeNumber), scriptEpisodeTool, options));
            validateScriptBatch([result.script.episodeNumber], current.projectConfig?.totalEpisodes || 0, episodeNumber);
            current = patch(current, { scripts: [...current.scripts, result.script] });
            current = await checkpoint(options, current);
        }
        current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "finish_script_batch") });
        if (current.projectConfig && current.scripts.length >= current.projectConfig.totalEpisodes) current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "finish_all_scripts") });
        emitPhase(options, current.currentStage);
        return assistant(current, `已按顺序完成第 ${episodes[0]}-${episodes[episodes.length - 1]} 集剧本。${current.currentStage === "completed" ? "全部剧本已完成。" : "可以继续生成接下来的 3 集。"}`);
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        const message = errorMessage(error);
        if (current.currentStage === "generating_script_batch") current = patch(current, { currentStage: transitionScriptAgentStage(current.currentStage, "fail") });
        return assistant(current, `剧本生成失败：${message}。已保留此前完成的剧本。`);
    }
}

async function confirmConfig(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, options?: ScriptAgentRequestOptions) {
    try {
        const projectConfig = completeConfig(workspace.title, workspace.source, workspace.configDraft || {});
        if (!projectConfig) return assistant(workspace, "配置还不完整，请补充作品标题、素材、集数、时长、章节范围、平台、画幅、风格和付费策略后再确认。");
        const next = patch(workspace, { projectConfig, configDraft: undefined, currentStage: transitionScriptAgentStage(workspace.currentStage, "confirm_project_config") });
        return runStorySkeleton(config, next, "", options);
    } catch (error) {
        return assistant(workspace, errorMessage(error));
    }
}

async function applyAction(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, action: ScriptAgentAction, instruction: string, options?: ScriptAgentRequestOptions) {
    if (action === "confirm") return confirmConfig(config, workspace, options);
    if (action === "retry" && workspace.currentStage === "failed") {
        if (workspace.storySkeletonStatus === "failed") return runStorySkeleton(config, patch(workspace, { currentStage: transitionScriptAgentStage(workspace.currentStage, "retry_story_skeleton"), storySkeletonStatus: "ready" }), instruction, options);
        if (workspace.adaptationStatus === "failed")
            return runAdaptationStrategy(config, patch(workspace, { currentStage: transitionScriptAgentStage(workspace.currentStage, "retry_adaptation_strategy"), adaptationStatus: "ready" }), instruction, options);
        if (workspace.projectConfig && workspace.adaptationStatus === "approved") return runScriptBatch(config, patch(workspace, { currentStage: transitionScriptAgentStage(workspace.currentStage, "retry_script_batch") }), options);
    }
    if (workspace.currentStage === "awaiting_story_skeleton_decision") {
        if (action === "approve") return runAdaptationStrategy(config, patch(workspace, { storySkeletonStatus: "approved", currentStage: transitionScriptAgentStage(workspace.currentStage, "approve_story_skeleton") }), "", options);
        if (action === "fix" || action === "redo") {
            const next = patch(workspace, {
                currentStage: transitionScriptAgentStage(workspace.currentStage, action === "fix" ? "request_story_skeleton_revision" : "request_story_skeleton_redo"),
                storySkeletonStatus: action === "fix" ? "revision_requested" : "redo_requested",
                storySkeleton: action === "redo" ? "" : workspace.storySkeleton,
                storySkeletonReview: undefined,
            });
            return runStorySkeleton(config, next, instruction || "请根据审核意见修复故事骨架。", options);
        }
    }
    if (workspace.currentStage === "awaiting_adaptation_decision") {
        if (action === "approve") return runScriptBatch(config, patch(workspace, { adaptationStatus: "approved", currentStage: transitionScriptAgentStage(workspace.currentStage, "approve_adaptation_strategy") }), options);
        if (action === "fix" || action === "redo") {
            const next = patch(workspace, {
                currentStage: transitionScriptAgentStage(workspace.currentStage, action === "fix" ? "request_adaptation_revision" : "request_adaptation_redo"),
                adaptationStatus: action === "fix" ? "revision_requested" : "redo_requested",
                adaptationStrategy: action === "redo" ? "" : workspace.adaptationStrategy,
                adaptationReview: undefined,
            });
            return runAdaptationStrategy(config, next, instruction || "请根据审核意见修复改编策略。", options);
        }
    }
    if (action === "continue" && workspace.currentStage === "script_batch_completed") {
        if (workspace.projectConfig && workspace.scripts.length >= workspace.projectConfig.totalEpisodes) return assistant(patch(workspace, { currentStage: transitionScriptAgentStage(workspace.currentStage, "finish_all_scripts") }), "全部剧本已经完成。");
        return runScriptBatch(config, patch(workspace, { currentStage: transitionScriptAgentStage(workspace.currentStage, "continue_scripts") }), options);
    }
    return assistant(workspace, "当前阶段不支持这个操作，请先完成当前审核或补充配置。");
}

async function decide(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, message: string, options?: ScriptAgentRequestOptions) {
    const result = await complete(
        config,
        `当前阶段需要用户确认。当前会话历史：\n${buildScriptAgentConversationContext(workspace, message)}\n当前审核结果：${JSON.stringify(workspace.storySkeletonReview || workspace.adaptationReview || {})}\n用户消息：${message}\n请识别为批准、修复、重做、继续或 none。只有明确表达意图才使用 approve/fix/redo/continue。`,
        decisionTool,
        options,
    );
    const root = structuredJson(result, "submit_workflow_decision") as Partial<WorkflowDecision>;
    const action = root.action === "approve" || root.action === "fix" || root.action === "redo" || root.action === "continue" ? root.action : "none";
    if (action === "none") return assistant(workspace, stringValue(root.reply) || "请告诉我：批准、修复，或重做。");
    return applyAction(config, workspace, action, stringValue(root.instruction), options);
}

export async function sendScriptAgentTurn(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, message: string, options?: ScriptAgentRequestOptions) {
    const text = message.trim();
    if (!text) return workspace;
    try {
        if (workspace.currentStage === "collecting_config") {
            const root = structuredJson(await complete(config, configPrompt(workspace, text), configTool, options), "submit_project_config") as unknown as ConfigDecision;
            const title = stringValue(root.title) || workspace.title;
            const source = stringValue(root.source) || workspace.source;
            const draft = { ...(workspace.configDraft || {}), ...partialConfig(root.config) };
            if (!draft.chapterIndexes?.length && draft.startChapter && draft.endChapter) draft.chapterIndexes = Array.from({ length: draft.endChapter - draft.startChapter + 1 }, (_, index) => draft.startChapter! + index);
            const projectConfig = root.action === "confirm" ? completeConfig(title, source, draft) : null;
            const next = patch(workspace, { title, source, configDraft: draft });
            if (!projectConfig) return assistant(next, stringValue(root.reply) || "请继续补充项目配置。\n填写完成后说“确认配置”。");
            return runStorySkeleton(config, patch(next, { projectConfig, configDraft: undefined, currentStage: transitionScriptAgentStage(next.currentStage, "confirm_project_config") }), "", options);
        }
        if (workspace.currentStage === "awaiting_story_skeleton_decision" || workspace.currentStage === "awaiting_adaptation_decision" || workspace.currentStage === "script_batch_completed") return decide(config, workspace, text, options);
        if (workspace.currentStage === "ready_for_story_skeleton") return runStorySkeleton(config, workspace, text, options);
        if (workspace.currentStage === "ready_for_adaptation_strategy") return runAdaptationStrategy(config, workspace, text, options);
        if (workspace.currentStage === "ready_for_script") return runScriptBatch(config, workspace, options);
        return assistant(workspace, workspace.currentStage === "completed" ? "全部剧本已完成。" : "正在处理当前阶段，请稍候或点击停止。");
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        return assistant(workspace, `处理失败：${errorMessage(error)}`);
    }
}

export async function submitScriptAgentAction(config: AiConfig, workspace: ScriptAgentWorkspaceRecord, input: { action: ScriptAgentAction; instruction?: string }, options?: ScriptAgentRequestOptions) {
    try {
        return await applyAction(config, workspace, input.action, input.instruction || "", options);
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        return assistant(workspace, `处理失败：${errorMessage(error)}`);
    }
}
