"use client";

import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { Button } from "antd";

import { ModelPicker, type ModelPickerOption } from "@/components/model-picker";
import { findGenerationProfile, getGenerationProfiles, type GenerationProfile, type ShortDramaAssetRole } from "@/services/api/generations";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { audioConfigPatch, buildNodeConfig, videoConfigPatch } from "./canvas-node-config";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    canResume?: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    onResume?: (nodeId: string) => void;
    onCancel?: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, canResume = false, onPromptChange, onConfigChange, onGenerate, onStop, onResume, onCancel, mentionReferences = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, defaultConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const [profiles, setProfiles] = useState<GenerationProfile[]>([]);
    const profile = findGenerationProfile(profiles, config.model || config.videoModel);
    const unresolvedVideoProfile = mode === "video" && config.channelMode === "remote" && Boolean(config.model) && !profile;
    const profileOptions: ModelPickerOption[] = profiles.map((item) => ({ value: item.id, label: item.displayName }));
    if (unresolvedVideoProfile) profileOptions.unshift({ value: config.model, label: `旧模型：${config.model}（请重新选择）`, disabled: true });
    const credits =
        mode === "video" && config.channelMode === "remote"
            ? profile?.credits || 0
            : requestCreditCost({ channelMode: config.channelMode, model: config.model, count: mode === "image" ? config.count : 1, modelCosts: publicSettings?.modelChannel.modelCosts });

    useEffect(() => {
        if (mode !== "video") return;
        let active = true;
        void getGenerationProfiles()
            .then((items) => {
                if (active) setProfiles(items);
            })
            .catch(() => {
                if (active) setProfiles([]);
            });
        return () => {
            active = false;
        };
    }, [config.model, config.videoModel, mode]);

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, lineHeight: "20px" }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            {mode === "video" && profile?.intents.includes("video.short-drama") ? (
                <div className="mt-2 space-y-1.5 rounded-xl border p-2" style={{ borderColor: theme.node.stroke }}>
                    <div className="text-xs font-medium">短剧资产角色</div>
                    {mentionReferences
                        .filter((reference) => reference.kind === "image")
                        .map((reference) => (
                            <label
                                key={reference.nodeId}
                                className="flex items-center justify-between gap-2 rounded-lg p-1 text-xs"
                                style={node.metadata?.generationErrorResourceId === reference.nodeId ? { outline: "2px solid #ef4444", outlineOffset: 2 } : undefined}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{reference.title}</span>
                                    <span className="block opacity-55">{node.metadata?.dramaAssetRoles?.[reference.nodeId] ? roleLabel(node.metadata.dramaAssetRoles[reference.nodeId]) : "缺少角色"}</span>
                                </span>
                                <select
                                    aria-label={`${reference.title}角色`}
                                    className="h-8 rounded-lg border px-2"
                                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                    value={node.metadata?.dramaAssetRoles?.[reference.nodeId] || ""}
                                    onChange={(event) => onConfigChange(node.id, { dramaAssetRoles: { ...node.metadata?.dramaAssetRoles, [reference.nodeId]: event.target.value as ShortDramaAssetRole } })}
                                >
                                    <option value="">选择角色</option>
                                    {profile.capabilities.assets?.roles.map((role) => (
                                        <option key={role} value={role}>
                                            {roleLabel(role)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ))}
                </div>
            ) : null}

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker
                                config={config}
                                value={config.model}
                                options={config.channelMode === "remote" ? profileOptions : undefined}
                                onChange={(model) => onConfigChange(node.id, { model })}
                                capability="video"
                                onMissingConfig={() => openConfigDialog(true)}
                            />
                            <CanvasVideoSettingsPopover
                                config={config}
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                errorFieldPath={node.metadata?.generationErrorFieldPath}
                                onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                            />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                {canResume ? (
                    <Button className="!h-10 shrink-0 !rounded-full !px-3" onClick={() => onResume?.(node.id)} aria-label="恢复查询">
                        <span className="text-xs font-medium">恢复查询</span>
                    </Button>
                ) : null}
                {isRunning && onCancel ? (
                    <Button danger className="!h-10 shrink-0 !rounded-full !px-3" onClick={() => onCancel(node.id)} aria-label="取消生成任务">
                        <span className="text-xs font-medium">取消任务</span>
                    </Button>
                ) : null}
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={canResume || unresolvedVideoProfile || (!isRunning && !prompt.trim())}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止等待" : "生成"}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止等待</span>
                            </>
                        ) : (
                            <>
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                    <CreditSymbol />
                                    {credits.toLocaleString()}
                                </span>
                                <ArrowUp className="size-4" />
                            </>
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function roleLabel(role: ShortDramaAssetRole) {
    if (role === "character") return "角色";
    if (role === "scene") return "场景";
    return "道具";
}
