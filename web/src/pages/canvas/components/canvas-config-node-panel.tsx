"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { Button, Segmented } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker, type ModelPickerOption } from "@/components/model-picker";
import { findGenerationProfile, getGenerationProfiles, type GenerationProfile } from "@/services/api/generations";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatDecimal } from "@/lib/decimal";
import { formatNumber } from "@/i18n/formatters";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { audioConfigPatch, buildNodeConfig, videoConfigPatch } from "./canvas-node-config";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildNodeConfig(globalConfig, defaultConfig, node, mode);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const [profiles, setProfiles] = useState<GenerationProfile[]>([]);
    const profile = findGenerationProfile(profiles, config.model || config.videoModel);
    const unresolvedVideoProfile = mode === "video" && config.channelMode === "remote" && Boolean(config.model) && !profile;
    const profileOptions: ModelPickerOption[] = profiles.map((item) => ({ value: item.id, label: item.displayName }));
    if (unresolvedVideoProfile) profileOptions.unshift({ value: config.model, label: t("canvas.models.legacySelection", { model: config.model }), disabled: true });
    const credits = requestCreditCost({
        channelMode: config.channelMode,
        model: config.model,
        count: mode === "image" ? count : 1,
        modelCosts: publicSettings?.modelChannel.modelCosts,
        ...(mode === "video" ? { resolution: config.vquality, duration: config.videoSeconds } : {}),
        fallbackCredits: mode === "video" ? profile?.credits : undefined,
    });
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = (hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput)) && !unresolvedVideoProfile;

    useEffect(() => {
        if (mode !== "video" || config.channelMode !== "remote") return;
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
    }, [config.channelMode, mode]);

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{t("canvas.configNode.title")}</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode })}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        {t("canvas.configNode.modes.image")}
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        {t("canvas.configNode.modes.text")}
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        {t("canvas.configNode.modes.video")}
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        {t("canvas.configNode.modes.audio")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label={t("canvas.configNode.inputs.prompt")} value={t("canvas.counts.items", { count: inputSummary.textCount, value: formatNumber(inputSummary.textCount) })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.inputs.referenceImage")} value={t("canvas.counts.images", { count: inputSummary.imageCount, value: formatNumber(inputSummary.imageCount) })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.inputs.referenceVideo")} value={t("canvas.counts.videos", { count: inputSummary.videoCount, value: formatNumber(inputSummary.videoCount) })} style={chipStyle} />
                <InputChip label={t("canvas.configNode.inputs.referenceAudio")} value={t("canvas.counts.audios", { count: inputSummary.audioCount, value: formatNumber(inputSummary.audioCount) })} style={chipStyle} />
                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    {t("canvas.composer.title")}
                </button>
            </div>

            <div className={`mb-2 grid min-w-0 cursor-default items-center gap-2 ${mode === "image" || mode === "video" || mode === "audio" ? "grid-cols-[minmax(0,1fr)_148px]" : "grid-cols-1"}`} onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker
                    className="canvas-compact-control h-10"
                    config={config}
                    value={config.model}
                    options={mode === "video" && config.channelMode === "remote" ? profileOptions : undefined}
                    onChange={(model) => onConfigChange(node.id, { model })}
                    capability={mode}
                    onMissingConfig={() => openConfigDialog(true)}
                    fullWidth
                />
                {mode === "video" ? (
                    <CanvasVideoSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                    />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement="topRight"
                        autoAdjustOverflow={false}
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                    />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                    />
                ) : null}
            </div>

            <Button
                type="primary"
                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                danger={isRunning}
                disabled={!isRunning && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <Square className="size-3.5 fill-current" />
                            <span>{t("canvas.actions.stop")}</span>
                        </>
                    ) : (
                        <>
                            <span className="inline-flex items-center gap-1">
                                <CreditSymbol />
                                {formatDecimal(credits)}
                            </span>
                            <Play className="size-4" />
                            <span>{t("canvas.actions.startGeneration")}</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}
