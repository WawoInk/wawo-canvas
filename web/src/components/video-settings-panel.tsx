"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, normalizeResolutionToken, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedancePixelLabel, seedanceRatioLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildShortDramaGenerationSettings, buildVideoGenerationSettings, findGenerationProfile, getGenerationProfiles, type GenerationProfile, type ShortDramaGenerationSettings, type VideoGenerationSettings } from "@/services/api/generations";
import { type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { formatNumber } from "@/i18n/formatters";

const sizeOptions = [
    { value: "1280x720", labelKey: "videoSettings.ratios.landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "videoSettings.ratios.portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "videoSettings.ratios.square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "videoSettings.ratios.wide", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "videoSettings.ratios.tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "videoSettings.ratios.adaptive", width: 0, height: 0 },
] as const;

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoNegativePrompt" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    allowAutoDuration?: boolean;
    showTitle?: boolean;
    className?: string;
    errorFieldPath?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, allowAutoDuration = true, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", errorFieldPath }: VideoSettingsPanelProps) {
    return <ProfileVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} allowAutoDuration={allowAutoDuration} showTitle={showTitle} className={className} errorFieldPath={errorFieldPath} />;
}

function ProfileVideoSettingsPanel({ config, onConfigChange, theme, allowAutoDuration, showTitle, className, errorFieldPath }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const profileID = config.model || config.videoModel;
    const [profile, setProfile] = useState<GenerationProfile | null>(null);

    useEffect(() => {
        let active = true;
        void getGenerationProfiles()
            .then((profiles) => {
                if (active) setProfile(findGenerationProfile(profiles, profileID) || null);
            })
            .catch(() => {
                if (active) setProfile(null);
            });
        return () => {
            active = false;
        };
    }, [profileID]);

    const definitions = profile?.capabilities.settings;
    const durationDefinition = definitions?.durationSeconds;
    const modeDefinition = definitions?.videoMode;
    const videoMode = modeDefinition?.values?.includes(config.videoMode) ? config.videoMode : modeDefinition?.default;
    const provided: Partial<VideoGenerationSettings> = {
        aspectRatio: normalizeSeedanceRatio(config.size) as VideoGenerationSettings["aspectRatio"],
        resolution: normalizeSeedanceResolution(config.vquality) as VideoGenerationSettings["resolution"],
        durationSeconds: normalizeSeedanceDuration(config.videoSeconds, durationDefinition),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };
    const isDrama = profile?.intents.includes("video.short-drama") === true;
    const dramaSettings =
        profile && isDrama
            ? buildShortDramaGenerationSettings(profile, {
                  aspectRatio: normalizeSeedanceRatio(config.size) as ShortDramaGenerationSettings["aspectRatio"],
                  resolution: normalizeSeedanceResolution(config.vquality) as ShortDramaGenerationSettings["resolution"],
                  durationSeconds: String(config.videoSeconds) === "-1" ? "auto" : normalizeSeedanceDuration(config.videoSeconds, durationDefinition),
                  quality: config.quality as ShortDramaGenerationSettings["quality"],
              })
            : null;
    const videoSettings = profile && !isDrama ? buildVideoGenerationSettings(profile, provided) : provided;
    const settings = dramaSettings || videoSettings;
    const supportedResolutions = definitions?.resolution.values ? new Set(definitions.resolution.values) : null;
    const resolutionOptions = [
        ...seedanceResolutionOptions,
        ...(definitions?.resolution.values || []).filter((value) => !seedanceResolutionOptions.some((item) => item.value === value)).map((value) => ({ value, label: value })),
    ];
    const ratioOptions = (definitions?.aspectRatio.values || seedanceRatioOptions.map((item) => item.value)).map((value) => ({ value, label: seedanceRatioLabel(value) }));
    const durationValue = settings.durationSeconds;
    const minDuration = durationDefinition?.min ?? 4;
    const maxDuration = durationDefinition?.max ?? 15;
    const supportsAutoDuration = Boolean(allowAutoDuration) && durationDefinition?.allowAuto !== false;
    const autoDuration = supportsAutoDuration && (durationValue === -1 || durationValue === "auto");
    const sliderDuration = Math.max(minDuration, Math.min(maxDuration, Number(durationValue) || minDuration));
    const settingError = (key: string) => (errorFieldPath === `intent.settings.${key}` ? { outline: "2px solid #ef4444", outlineOffset: 4, borderRadius: 12 } : undefined);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("videoSettings.title")}</div> : null}
                {config.channelMode === "local" ? (
                    <div className="rounded-xl border px-3 py-2 text-xs leading-5 opacity-70" style={{ borderColor: theme.node.stroke }}>
                        {t("videoSettings.localModeHint")}
                    </div>
                ) : null}
                <div style={settingError("resolution")}>
                    <SettingGroup title={t("videoSettings.resolution")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {resolutionOptions.map((item) => (
                                <OptionPill
                                    key={item.value}
                                    selected={settings.resolution === item.value}
                                    disabled={supportedResolutions != null && !supportedResolutions.has(item.value)}
                                    theme={theme}
                                    onClick={() => onConfigChange("vquality", item.value)}
                                >
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                </div>
                <div style={settingError("aspectRatio")}>
                    <SettingGroup title={t("videoSettings.aspectRatio")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {ratioOptions.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                    style={{ borderColor: settings.aspectRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", item.value)}
                                >
                                    <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                    <span>{item.label}</span>
                                    <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? t("videoSettings.autoMatch") : seedancePixelLabel(String(settings.resolution || "720p"), item.value)}</span>
                                </button>
                            ))}
                        </div>
                    </SettingGroup>
                </div>
                {!isDrama && modeDefinition?.values?.length ? (
                    <div style={settingError("videoMode")}>
                        <SettingGroup title={t("videoSettings.mode", { defaultValue: "生成模式" })} color={theme.node.muted}>
                            <div className="grid grid-cols-2 gap-2.5">
                                {modeDefinition.values
                                    .filter((value) => value === "frames" || value === "reference")
                                    .map((value) => (
                                        <OptionPill key={value} selected={videoMode === value} theme={theme} onClick={() => onConfigChange("videoMode", value)}>
                                            {value === "frames" ? t("videoSettings.modes.frames", { defaultValue: "首尾帧" }) : t("videoSettings.modes.reference", { defaultValue: "全能参考" })}
                                        </OptionPill>
                                    ))}
                            </div>
                        </SettingGroup>
                    </div>
                ) : null}
                <div style={settingError("durationSeconds")}>
                    <SettingGroup title={t("videoSettings.duration")} color={theme.node.muted}>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm tabular-nums">{autoDuration ? t("videoSettings.smart") : videoSecondsLabel(String(sliderDuration))}</span>
                            {supportsAutoDuration ? (
                                <OptionPill selected={autoDuration} theme={theme} onClick={() => onConfigChange("videoSeconds", "-1")}>
                                    {t("videoSettings.smart")}
                                </OptionPill>
                            ) : null}
                        </div>
                        <input
                            type="range"
                            aria-label={t("videoSettings.duration")}
                            aria-valuetext={autoDuration ? t("videoSettings.smart") : videoSecondsLabel(String(sliderDuration))}
                            min={minDuration}
                            max={maxDuration}
                            step={1}
                            value={sliderDuration}
                            className="h-6 w-full cursor-pointer"
                            style={{ accentColor: theme.node.text }}
                            onChange={(event) => onConfigChange("videoSeconds", event.target.value)}
                        />
                        <div className="flex justify-between text-xs tabular-nums" style={{ color: theme.node.muted }}>
                            <span>{videoSecondsLabel(String(minDuration))}</span>
                            <span>{videoSecondsLabel(String(maxDuration))}</span>
                        </div>
                    </SettingGroup>
                </div>
                {definitions?.quality ? (
                    <div style={settingError("quality")}>
                        <SettingGroup title={t("videoSettings.quality.label")} color={theme.node.muted}>
                            <div className="grid grid-cols-2 gap-2.5">
                                {definitions.quality.values?.map((value) => (
                                    <OptionPill key={value} selected={dramaSettings?.quality === value} theme={theme} onClick={() => onConfigChange("quality", value)}>
                                        {value === "high" ? t("videoSettings.quality.high") : t("videoSettings.quality.standard")}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>
                    </div>
                ) : null}
                {definitions?.generateAudio || definitions?.watermark ? (
                    <SettingGroup title={t("videoSettings.output")} color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            {definitions?.generateAudio ? (
                                <SwitchRow label={t("videoSettings.generateAudio")} checked={Boolean(videoSettings.generateAudio)} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                            ) : null}
                            {definitions?.watermark ? <SwitchRow label={t("videoSettings.watermark")} checked={Boolean(videoSettings.watermark)} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                        </div>
                    </SettingGroup>
                ) : null}
                {!isDrama ? (
                    <SettingGroup title={t("videoSettings.negativePrompt.label")} color={theme.node.muted}>
                        <textarea
                            value={config.videoNegativePrompt || ""}
                            maxLength={500}
                            placeholder={t("videoSettings.negativePrompt.placeholder")}
                            className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(event) => onConfigChange("videoNegativePrompt", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                        <div className="text-right text-[10px] opacity-55">
                            {formatNumber((config.videoNegativePrompt || "").length, { useGrouping: false })}/{formatNumber(500, { useGrouping: false })}
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return normalizeResolutionToken(value);
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return i18n.t("videoSettings.ratios.adaptive");
    if (ratio === value) return seedanceRatioLabel(ratio);
    const size = normalizeVideoSizeValue(value);
    const option = sizeOptions.find((item) => item.value === size);
    return option ? i18n.t(option.labelKey) : size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("videoSettings.smart");
    const seconds = Number(value || "6");
    return i18n.t("videoSettings.seconds", { value: Number.isFinite(seconds) ? formatNumber(seconds, { useGrouping: false }) : value || "6" });
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
