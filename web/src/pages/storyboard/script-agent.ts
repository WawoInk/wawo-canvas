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
