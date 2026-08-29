export type ScriptAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export type ScriptAgentErrorCode =
    | "PROJECT_CONFIG_INVALID"
    | "PROJECT_CONFIG_REQUIRED"
    | "CHAPTER_RANGE_INVALID"
    | "STORY_SKELETON_REQUIRED"
    | "STORY_SKELETON_APPROVAL_REQUIRED"
    | "ADAPTATION_STRATEGY_REQUIRED"
    | "ADAPTATION_APPROVAL_REQUIRED"
    | "SCRIPT_BATCH_TOO_LARGE"
    | "SCRIPT_EPISODE_OUT_OF_ORDER"
    | "INVALID_STAGE_TRANSITION"
    | "STRUCTURED_OUTPUT_INVALID"
    | "MARKDOWN_SECTION_MISSING";

export class ScriptAgentError extends Error {
    readonly code: ScriptAgentErrorCode;
    readonly path: string;

    constructor(code: ScriptAgentErrorCode, message: string, path = "") {
        super(message);
        this.name = "ScriptAgentError";
        this.code = code;
        this.path = path;
    }
}

export type ScriptProjectConfigInput = {
    totalEpisodes: number;
    episodeMinutes: number;
    startChapter: number;
    endChapter: number;
    chapterIndexes: number[];
    platform: string;
    aspectRatio: ScriptAspectRatio;
    style: string;
    paywall: string;
};

export type ScriptProjectConfig = ScriptProjectConfigInput & {
    wordsPerEpisode: number;
};

export type ScriptArtifactStatus = "empty" | "ready" | "generating" | "generated" | "reviewing" | "awaiting_user_decision" | "approved" | "revision_requested" | "redo_requested" | "failed";

export type ScriptAgentStage =
    | "collecting_config"
    | "ready_for_story_skeleton"
    | "generating_story_skeleton"
    | "reviewing_story_skeleton"
    | "awaiting_story_skeleton_decision"
    | "ready_for_adaptation_strategy"
    | "generating_adaptation_strategy"
    | "reviewing_adaptation_strategy"
    | "awaiting_adaptation_decision"
    | "ready_for_script"
    | "selecting_script_batch"
    | "generating_script_batch"
    | "script_batch_completed"
    | "completed"
    | "failed";

export type ScriptReviewGrade = "A" | "B" | "C" | "D";
export type ScriptReviewSeverity = "severe" | "medium" | "minor";

export type ScriptReviewIssue = {
    severity: ScriptReviewSeverity;
    check: string;
    problem: string;
    suggestion: string;
};

export type ScriptArtifactReview = {
    artifactType: "story_skeleton" | "adaptation_strategy";
    artifactVersion: number;
    grade: ScriptReviewGrade;
    summary: string;
    issues: ScriptReviewIssue[];
    decisions: string[];
    markdown: string;
};

export type ScriptItem = {
    episodeNumber: number;
    name: string;
    content: string;
    sourceChapterIndexes: number[];
    version?: number;
};

export type ScriptAgentWorkspace = {
    id: string;
    projectId: string;
    currentStage: ScriptAgentStage;
    projectConfig: ScriptProjectConfig | null;
    storySkeleton: string;
    storySkeletonStatus: ScriptArtifactStatus;
    storySkeletonReview?: ScriptArtifactReview;
    adaptationStrategy: string;
    adaptationStatus: ScriptArtifactStatus;
    adaptationReview?: ScriptArtifactReview;
    scripts: ScriptItem[];
    version: number;
    updatedAt: string;
};

const SCRIPT_ASPECT_RATIOS: readonly ScriptAspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export function validateScriptProjectConfig(input: ScriptProjectConfigInput, availableChapterIndexes?: readonly number[]): ScriptProjectConfig {
    if (!positiveInteger(input.totalEpisodes) || !positiveInteger(input.episodeMinutes)) {
        throw new ScriptAgentError("PROJECT_CONFIG_INVALID", "总集数和单集时长必须是正整数");
    }
    if (!positiveInteger(input.startChapter) || !positiveInteger(input.endChapter) || input.startChapter > input.endChapter) {
        throw new ScriptAgentError("CHAPTER_RANGE_INVALID", "章节范围无效");
    }
    if (!Array.isArray(input.chapterIndexes) || !input.chapterIndexes.length || input.chapterIndexes.some((chapter) => !positiveInteger(chapter) || chapter < input.startChapter || chapter > input.endChapter)) {
        throw new ScriptAgentError("CHAPTER_RANGE_INVALID", "章节编号必须是范围内的正整数");
    }
    if (![input.platform, input.style, input.paywall].every((value) => typeof value === "string" && value.trim()) || !SCRIPT_ASPECT_RATIOS.includes(input.aspectRatio)) {
        throw new ScriptAgentError("PROJECT_CONFIG_INVALID", "平台、画幅、风格和付费策略不能为空");
    }
    const chapterIndexes = [...new Set(input.chapterIndexes)].sort((a, b) => a - b);
    if (availableChapterIndexes && chapterIndexes.some((chapter) => !availableChapterIndexes.includes(chapter))) {
        throw new ScriptAgentError("CHAPTER_RANGE_INVALID", "章节编号包含当前项目中不存在的章节");
    }
    return { ...input, platform: input.platform.trim(), style: input.style.trim(), paywall: input.paywall.trim(), chapterIndexes, wordsPerEpisode: input.episodeMinutes * 150 };
}

function positiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) > 0;
}


export function validateScriptBatch(episodes: readonly number[], totalEpisodes: number, nextEpisodeNumber: number): number[] {
    if (episodes.length > 5) throw new ScriptAgentError("SCRIPT_BATCH_TOO_LARGE", "单批最多生成 5 集");
    if (!episodes.length || !positiveInteger(totalEpisodes) || !positiveInteger(nextEpisodeNumber) || episodes.some((episode, index) => !positiveInteger(episode) || episode !== nextEpisodeNumber + index || episode > totalEpisodes)) {
        throw new ScriptAgentError("SCRIPT_EPISODE_OUT_OF_ORDER", "剧本集号必须从下一集开始连续递增");
    }
    return [...episodes];
}

export function assertCanGenerateScriptBatch(workspace: ScriptAgentWorkspace, episodes: readonly number[]): number[] {
    if (!workspace.projectConfig) throw new ScriptAgentError("PROJECT_CONFIG_REQUIRED", "请先确认项目配置");
    if (!workspace.adaptationStrategy.trim()) throw new ScriptAgentError("ADAPTATION_STRATEGY_REQUIRED", "请先生成改编策略");
    if (workspace.adaptationStatus !== "approved" || workspace.adaptationReview?.artifactType !== "adaptation_strategy") {
        throw new ScriptAgentError("ADAPTATION_APPROVAL_REQUIRED", "改编策略必须审核并由用户批准");
    }
    if (workspace.currentStage !== "ready_for_script" && workspace.currentStage !== "selecting_script_batch") {
        throw new ScriptAgentError("INVALID_STAGE_TRANSITION", `当前阶段 ${workspace.currentStage} 不能生成剧本`);
    }
    const existing = new Set(workspace.scripts.map((script) => script.episodeNumber));
    let nextEpisodeNumber = 1;
    while (existing.has(nextEpisodeNumber)) nextEpisodeNumber += 1;
    return validateScriptBatch(episodes, workspace.projectConfig.totalEpisodes, nextEpisodeNumber);
}

export function assertCanGenerateAdaptationStrategy(workspace: ScriptAgentWorkspace): void {
    if (!workspace.storySkeleton.trim()) throw new ScriptAgentError("STORY_SKELETON_REQUIRED", "请先生成故事骨架");
    if (workspace.storySkeletonStatus !== "approved" || workspace.storySkeletonReview?.artifactType !== "story_skeleton") {
        throw new ScriptAgentError("STORY_SKELETON_APPROVAL_REQUIRED", "故事骨架必须审核并由用户批准");
    }
    if (workspace.currentStage !== "ready_for_adaptation_strategy") {
        throw new ScriptAgentError("INVALID_STAGE_TRANSITION", `当前阶段 ${workspace.currentStage} 不能生成改编策略`);
    }
}

export type ScriptAgentTransition =
    | "confirm_project_config"
    | "start_story_skeleton"
    | "finish_story_skeleton"
    | "finish_story_skeleton_review"
    | "approve_story_skeleton"
    | "request_story_skeleton_revision"
    | "request_story_skeleton_redo"
    | "start_adaptation_strategy"
    | "finish_adaptation_strategy"
    | "finish_adaptation_review"
    | "approve_adaptation_strategy"
    | "request_adaptation_revision"
    | "request_adaptation_redo"
    | "open_script_batch_selection"
    | "select_script_batch"
    | "finish_script_batch"
    | "continue_scripts"
    | "finish_all_scripts"
    | "fail";

const SCRIPT_STAGE_TRANSITIONS: Partial<Record<ScriptAgentStage, Partial<Record<ScriptAgentTransition, ScriptAgentStage>>>> = {
    collecting_config: { confirm_project_config: "ready_for_story_skeleton" },
    ready_for_story_skeleton: { start_story_skeleton: "generating_story_skeleton" },
    generating_story_skeleton: { finish_story_skeleton: "reviewing_story_skeleton", fail: "failed" },
    reviewing_story_skeleton: { finish_story_skeleton_review: "awaiting_story_skeleton_decision", fail: "failed" },
    awaiting_story_skeleton_decision: {
        approve_story_skeleton: "ready_for_adaptation_strategy",
        request_story_skeleton_revision: "ready_for_story_skeleton",
        request_story_skeleton_redo: "ready_for_story_skeleton",
    },
    ready_for_adaptation_strategy: { start_adaptation_strategy: "generating_adaptation_strategy" },
    generating_adaptation_strategy: { finish_adaptation_strategy: "reviewing_adaptation_strategy", fail: "failed" },
    reviewing_adaptation_strategy: { finish_adaptation_review: "awaiting_adaptation_decision", fail: "failed" },
    awaiting_adaptation_decision: {
        approve_adaptation_strategy: "ready_for_script",
        request_adaptation_revision: "ready_for_adaptation_strategy",
        request_adaptation_redo: "ready_for_adaptation_strategy",
    },
    ready_for_script: { open_script_batch_selection: "selecting_script_batch" },
    selecting_script_batch: { select_script_batch: "generating_script_batch" },
    generating_script_batch: { finish_script_batch: "script_batch_completed", fail: "failed" },
    script_batch_completed: { continue_scripts: "ready_for_script", finish_all_scripts: "completed" },
};

export function transitionScriptAgentStage(stage: ScriptAgentStage, transition: ScriptAgentTransition): ScriptAgentStage {
    const next = SCRIPT_STAGE_TRANSITIONS[stage]?.[transition];
    if (next) return next;
    if (transition === "start_adaptation_strategy" && stage === "awaiting_story_skeleton_decision") {
        throw new ScriptAgentError("STORY_SKELETON_APPROVAL_REQUIRED", "需要用户明确批准故事骨架");
    }
    if (transition === "open_script_batch_selection" && stage === "awaiting_adaptation_decision") {
        throw new ScriptAgentError("ADAPTATION_APPROVAL_REQUIRED", "需要用户明确批准改编策略");
    }
    throw new ScriptAgentError("INVALID_STAGE_TRANSITION", `不能从 ${stage} 执行 ${transition}`);
}
