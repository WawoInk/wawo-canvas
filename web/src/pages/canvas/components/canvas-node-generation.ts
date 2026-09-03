import type { GenerationCommand, GenerationError, GenerationProfile, ShortDramaGenerationSettings, VideoGenerationSettings } from "@/services/api/generations";
import { buildGenerationCommand, buildShortDramaGenerationSettings, buildVideoGenerationSettings } from "@/services/api/generations";
import type { AiTextMessage } from "@/services/api/image";
import { normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { boolConfig } from "@/lib/seedance-video";
import i18n from "@/i18n";
import { formatNumber } from "@/i18n/formatters";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { getGenerationResourceNodes } from "../utils/canvas-resource-references";

export type PlatformMediaReference = {
    fileId?: string;
    assetId?: string;
    sourceNodeId: string;
    name: string;
};

function platformMediaReference(node: CanvasNodeData, errorKey: string): PlatformMediaReference {
    const name = node.title || node.id;
    if (node.metadata?.materialSource === "volcengine") {
        if (node.metadata.volcengineAssetId) return { assetId: node.metadata.volcengineAssetId, sourceNodeId: node.id, name };
    } else if (node.metadata?.fileId) {
        return { fileId: node.metadata.fileId, sourceNodeId: node.id, name };
    }
    throw new Error(i18n.t(errorKey, { name }));
}

export type VideoGenerationIntent = {
    kind: "video.generate";
    prompt: string;
    negativePrompt?: string;
    references: {
        images: PlatformMediaReference[];
        videos: PlatformMediaReference[];
        audios: PlatformMediaReference[];
    };
    settings: VideoGenerationSettings;
};

export function buildVideoGenerationIntent(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, settings: VideoGenerationSettings, negativePrompt = ""): VideoGenerationIntent {
    const references = { images: [] as PlatformMediaReference[], videos: [] as PlatformMediaReference[], audios: [] as PlatformMediaReference[] };
    for (const node of getGenerationResourceNodes(nodeId, nodes, connections)) {
        if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) continue;
        const reference = platformMediaReference(node, "canvas.generation.errors.resourceNotUploaded");
        if (node.type === CanvasNodeType.Image) references.images.push(reference);
        if (node.type === CanvasNodeType.Video) references.videos.push(reference);
        if (node.type === CanvasNodeType.Audio) references.audios.push(reference);
    }
    const trimmedNegativePrompt = negativePrompt.trim();
    return { kind: "video.generate", prompt, ...(trimmedNegativePrompt ? { negativePrompt: trimmedNegativePrompt } : {}), references, settings };
}
export type FirstPartyCanvasVideoRun = {
    command: GenerationCommand;
    metadata: {
        generationClientRequestId: string;
        generationProfileId: string;
        generationCancellation: boolean;
    };
};

export function prepareFirstPartyCanvasVideoRun(input: { nodeId: string; nodes: CanvasNodeData[]; connections: CanvasConnection[]; prompt: string; config: AiConfig; profile: GenerationProfile; clientRequestId: string }): FirstPartyCanvasVideoRun {
    const { profile, config } = input;
    const isShortDrama = profile.intents.includes("video.short-drama");
    const intent = isShortDrama
        ? buildShortDramaGenerationIntent(
              input.nodeId,
              input.nodes,
              input.connections,
              input.prompt,
              buildShortDramaGenerationSettings(profile, {
                  aspectRatio: normalizeSeedanceRatio(config.size) as ShortDramaGenerationSettings["aspectRatio"],
                  resolution: normalizeSeedanceResolution(config.vquality) as ShortDramaGenerationSettings["resolution"],
                  durationSeconds: String(config.videoSeconds) === "-1" ? "auto" : normalizeSeedanceDuration(config.videoSeconds),
                  quality: config.quality as ShortDramaGenerationSettings["quality"],
              }),
          )
        : buildVideoGenerationIntent(
              input.nodeId,
              input.nodes,
              input.connections,
              input.prompt,
              buildVideoGenerationSettings(profile, {
                  aspectRatio: normalizeSeedanceRatio(config.size) as VideoGenerationSettings["aspectRatio"],
                  resolution: normalizeSeedanceResolution(config.vquality) as VideoGenerationSettings["resolution"],
                  durationSeconds: normalizeSeedanceDuration(config.videoSeconds),
                  generateAudio: boolConfig(config.videoGenerateAudio, true),
                  watermark: boolConfig(config.videoWatermark, false),
              }),
              config.videoNegativePrompt,
          );
    return {
        command: buildGenerationCommand({ clientRequestId: input.clientRequestId, modelProfileId: profile.id, source: "canvas", intent }),
        metadata: { generationClientRequestId: input.clientRequestId, generationProfileId: profile.id, generationCancellation: profile.capabilities.cancellation },
    };
}

export type ShortDramaAssetRole = "character" | "scene" | "tool";

export type ShortDramaGenerationIntent = {
    kind: "video.short-drama";
    title: string;
    script: string;
    assets: Array<{
        sourceNodeId: string;
        role: ShortDramaAssetRole;
        name: string;
        description?: string;
        reference: PlatformMediaReference;
    }>;
    settings: ShortDramaGenerationSettings;
};

export function buildShortDramaGenerationIntent(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], script: string, settings: ShortDramaGenerationSettings): ShortDramaGenerationIntent {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target?.title.trim()) throw new Error(i18n.t("canvas.generation.errors.shortDramaTitleRequired"));
    if (!script.trim()) throw new Error(i18n.t("canvas.generation.errors.shortDramaScriptRequired"));
    const imageNodes = getGenerationResourceNodes(nodeId, nodes, connections).filter((node) => node.type === CanvasNodeType.Image);
    if (!imageNodes.length) throw new Error(i18n.t("canvas.generation.errors.shortDramaAssetRequired"));
    const assets = imageNodes.map((node) => {
        const role = target.metadata?.dramaAssetRoles?.[node.id];
        if (!role) throw new Error(i18n.t("canvas.generation.errors.shortDramaRoleRequired", { name: node.title || node.id }));
        const name = node.title || node.id;
        return {
            sourceNodeId: node.id,
            role,
            name,
            ...(target.metadata?.dramaAssetDescriptions?.[node.id] ? { description: target.metadata.dramaAssetDescriptions[node.id] } : {}),
            reference: platformMediaReference(node, "canvas.generation.errors.imageNotUploaded"),
        };
    });
    return { kind: "video.short-drama", title: target.title.trim(), script: script.trim(), assets, settings };
}

export function cleanShortDramaAssetMappings(metadata: CanvasNodeData["metadata"], connectedImageIDs: string[]) {
    const connected = new Set(connectedImageIDs);
    const dramaAssetRoles = Object.fromEntries(Object.entries(metadata?.dramaAssetRoles || {}).filter(([nodeID]) => connected.has(nodeID)));
    const dramaAssetDescriptions = Object.fromEntries(Object.entries(metadata?.dramaAssetDescriptions || {}).filter(([nodeID]) => connected.has(nodeID)));
    return { ...metadata, dramaAssetRoles, dramaAssetDescriptions };
}

export function locateGenerationError(error: GenerationError) {
    return {
        ...(error.fieldPath ? { fieldPath: error.fieldPath } : {}),
        ...(error.resourceId ? { resourceId: error.resourceId } : {}),
    };
}

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/blob-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => (image.assetId ? image : { ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    return i18n.t(`canvas.resources.labels.${type}`, { index: formatNumber(index + 1, { useGrouping: false }) });
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    const assetId = node.metadata?.materialSource === "volcengine" ? node.metadata.volcengineAssetId : undefined;
    if (node.type !== CanvasNodeType.Image || (!node.metadata?.content && !assetId)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata?.mimeType || "image/png",
        dataUrl: node.metadata?.content || "",
        ...(assetId ? { url: `asset://${assetId}`, assetId } : {}),
        storageKey: node.metadata?.storageKey,
        fileId: node.metadata?.fileId,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    const assetId = node.metadata?.materialSource === "volcengine" ? node.metadata.volcengineAssetId : undefined;
    if (node.type !== CanvasNodeType.Video || (!node.metadata?.content && !assetId)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata?.mimeType || "video/mp4",
        url: assetId ? `asset://${assetId}` : node.metadata?.content || "",
        ...(assetId ? { assetId } : {}),
        storageKey: node.metadata?.storageKey,
        bytes: node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
        durationMs: node.metadata?.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    const assetId = node.metadata?.materialSource === "volcengine" ? node.metadata.volcengineAssetId : undefined;
    if (node.type !== CanvasNodeType.Audio || (!node.metadata?.content && !assetId)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata?.mimeType || "audio/mpeg",
        url: assetId ? `asset://${assetId}` : node.metadata?.content || "",
        ...(assetId ? { assetId } : {}),
        storageKey: node.metadata?.storageKey,
        durationMs: node.metadata?.durationMs,
    };
}
