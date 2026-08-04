"use client";

import { App, Button, Form, Input, Modal, Progress, Segmented, Select, Tabs } from "antd";
import { CircleAlert, Cloud, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { ModelPicker } from "@/components/model-picker";
import { fetchChannelModels } from "@/services/api/image";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent, type AppSyncStage } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { formatBytes } from "@/lib/image-utils";
import { formatDateTime, formatNumber } from "@/i18n/formatters";
import {
    createModelChannel,
    defaultBaseUrlForApiFormat,
    filterModelsByCapability,
    modelOptionLabel,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabelKey: string;
    optionsLabelKey: string;
};

type WebdavDomainProgress = {
    stage: AppSyncStage;
    detail?: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabelKey: "config.models.default.image", optionsLabelKey: "config.models.options.image" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabelKey: "config.models.default.video", optionsLabelKey: "config.models.options.video" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabelKey: "config.models.default.text", optionsLabelKey: "config.models.options.text" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabelKey: "config.models.default.audio", optionsLabelKey: "config.models.options.audio" },
];

const apiFormatOptions: Array<{ labelKey: string; value: ApiCallFormat }> = [
    { labelKey: "config.channels.apiFormats.openai", value: "openai" },
    { labelKey: "config.channels.apiFormats.gemini", value: "gemini" },
    { labelKey: "config.channels.apiFormats.xvanai", value: "xvanai" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "waiting" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState("channels");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState<AppSyncProgressEvent | null>(null);
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));
    const webdavReady = Boolean(webdav.url.trim());
    const isRemote = config.channelMode === "remote";
    const forcedRemote = isRemote && publicSettings?.modelChannel.allowCustomChannel === false;

    // 当弹窗打开且当前 Tab 不可见时（如远程模式无渠道 Tab），自动切到模型 Tab
    useEffect(() => {
        if (isConfigOpen && forcedRemote && activeTab === "channels") {
            setActiveTab("models");
        }
    }, [isConfigOpen, forcedRemote, activeTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? t("config.messages.savedContinue") : t("config.messages.saved"));
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        updateChannels([...config.channels, createModelChannel({ name: t("config.channels.generatedName", { index: formatNumber(config.channels.length + 1, { useGrouping: false }) }) })]);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.messages.keepOneChannel"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(t("config.messages.channelCredentialsRequired"));
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await fetchChannelModels(channel);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)));
            message.success(t("config.messages.channelModelsUpdated", { name: channel.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.image.readModelsFailed"));
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshAllModels = async () => {
        const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
        if (!runnable.length) {
            message.error(t("config.messages.anyChannelCredentialsRequired"));
            return;
        }
        setLoadingChannelId("all");
        try {
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await fetchChannelModels(channel)] as const));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
            message.success(t("config.messages.modelsUpdated"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.image.readModelsFailed"));
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.urlRequired"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.connectionAvailable"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.webdav.connectionTestFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                detail: event.detail,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.urlRequired"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus({ stage: "preparing" });
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(
                t("config.webdav.syncSummary", {
                    projects: formatNumber(result.projects),
                    assets: formatNumber(result.assets),
                    records: formatNumber(result.imageLogs + result.videoLogs),
                    files: formatNumber(result.uploadedFiles),
                    bytes: formatBytes(result.uploadedBytes),
                }),
            );
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("errors.webdav.syncFailed");
            setWebdavSyncStatus({ stage: "failed", detail, status: "exception" });
            message.error(detail);
        } finally {
            setSyncingWebdav(false);
        }
    };

    const tabItems = useMemo(() => {
        const items: Parameters<typeof Tabs>[0]["items"] = [];
        if (!forcedRemote && !isRemote) {
            items.push({
                key: "channels",
                label: t("config.tabs.channels"),
                children: (
                    <Form layout="vertical" requiredMark={false}>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="min-w-0 flex-1">
                                <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                    <CircleAlert className="size-3.5 shrink-0" />
                                    <span className="font-semibold">{t("config.channels.important")}</span>
                                    <span>{t("config.channels.selectableHint")}</span>
                                    <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold text-amber-900 dark:text-amber-100" onClick={() => setActiveTab("models")}>
                                        {t("config.channels.goToModels")}
                                    </Button>
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                    {t("config.channels.fetchAll")}
                                </Button>
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                    {t("config.channels.add")}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-3">
                            {config.channels.map((channel) => (
                                <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.untitled")}</div>
                                            <div className="mt-1 text-xs text-stone-500">{t("config.channels.savedModels", { format: apiFormatLabel(channel.apiFormat), count: channel.models.length, value: formatNumber(channel.models.length) })}</div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                {t("config.channels.fetchModels")}
                                            </Button>
                                            <Button aria-label={t("config.channels.delete", { name: channel.name || t("config.channels.untitled") })} size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                        </div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("config.channels.name")} className="mb-0">
                                            <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                        </Form.Item>
                                        <Form.Item label={t("config.channels.apiFormat")} className="mb-0">
                                            <Select value={channel.apiFormat} options={apiFormatOptions.map((option) => ({ label: t(option.labelKey), value: option.value }))} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.channels.baseUrl")} className="mb-0">
                                            <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                        </Form.Item>
                                        <Form.Item label={t("config.channels.apiKey")} className="mb-0">
                                            <Input.Password value={channel.apiKey} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                        </Form.Item>
                                        <Form.Item label={t("config.channels.modelList")} className="mb-0 md:col-span-2">
                                            <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder={t("config.channels.modelListPlaceholder")} value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                        </Form.Item>
                                    </div>
                                </section>
                            ))}
                        </div>
                    </Form>
                ),
            });
        }
        items.push(
            {
                key: "models",
                label: t("config.tabs.models"),
                children: (
                    <Form layout="vertical" requiredMark={false}>
                        <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="text-sm font-semibold">{t("config.models.heading")}</div>
                            <div className="mt-1 text-xs leading-5 text-stone-500">{forcedRemote ? t("config.models.forcedHint") : t("config.models.hint")}</div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            {modelGroups.map((group) => (
                                <Form.Item key={group.modelsKey} label={t(group.optionsLabelKey)} className="mb-0">
                                    <Select
                                        mode={forcedRemote ? "multiple" : "tags"}
                                        disabled={forcedRemote}
                                        showSearch
                                        allowClear={!forcedRemote}
                                        maxTagCount="responsive"
                                        placeholder={config.models.length ? t("config.models.optionsPlaceholder", { label: t(group.optionsLabelKey) }) : t("config.models.channelsFirst")}
                                        value={config[group.modelsKey]}
                                        options={modelOptions}
                                        onChange={(models) => updateCapabilityModels(group, models)}
                                    />
                                </Form.Item>
                            ))}
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {modelGroups.map((group) => (
                                <Form.Item key={group.modelKey} label={t(group.defaultLabelKey)} className="mb-0">
                                    <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth disabled={forcedRemote} />
                                </Form.Item>
                            ))}
                        </div>
                    </Form>
                ),
            },
            {
                key: "preferences",
                label: t("config.tabs.preferences"),
                children: (
                    <Form layout="vertical" requiredMark={false}>
                        <div className="grid gap-4 md:grid-cols-4">
                            <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountHint")} className="mb-4">
                                <Input
                                    type="number"
                                    min={1}
                                    max={15}
                                    value={config.canvasImageCount}
                                    onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                    onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                />
                            </Form.Item>
                            <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                                <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                            </Form.Item>
                            <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                                <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                            </Form.Item>
                            <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                                <Input
                                    type="number"
                                    min={0.25}
                                    max={4}
                                    step={0.05}
                                    value={config.audioSpeed}
                                    onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                    onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                />
                            </Form.Item>
                        </div>
                        <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                            <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("audioSettings.instructions.placeholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                            <Input.TextArea
                                rows={4}
                                value={config.systemPrompt}
                                disabled={forcedRemote}
                                placeholder={forcedRemote ? t("config.preferences.managedByAdmin") : t("config.preferences.systemPromptPlaceholder")}
                                onChange={(event) => updateConfig("systemPrompt", event.target.value)}
                            />
                        </Form.Item>
                    </Form>
                ),
            },
            {
                key: "webdav",
                label: t("config.tabs.webdav"),
                children: (
                    <Form layout="vertical" requiredMark={false}>
                        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <Cloud className="size-4" />
                                        {t("config.webdav.title")}
                                    </div>
                                    <div className="mt-1 text-xs text-stone-500">{t("config.webdav.description")}</div>
                                </div>
                                <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatDateTime(webdav.lastSyncedAt) }) : t("config.webdav.neverSynced")}</div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Form.Item label={t("config.webdav.connectionMode")} className="mb-4 md:col-span-2">
                                    <Segmented
                                        block
                                        value={webdav.proxyMode}
                                        onChange={(value) => updateWebdavConfig("proxyMode", value as typeof webdav.proxyMode)}
                                        options={[
                                            { label: t("config.webdav.direct"), value: "direct" },
                                            { label: t("config.webdav.nextProxy"), value: "nextjs" },
                                        ]}
                                    />
                                </Form.Item>
                                <Form.Item label={t("config.webdav.url")} className="mb-4">
                                    <Input value={webdav.url} placeholder={t("config.webdav.urlPlaceholder")} onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryHint", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                    <Input value={webdav.directory} placeholder={t("config.webdav.directoryPlaceholder")} onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.webdav.username")} className="mb-0">
                                    <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("config.webdav.password")} className="mb-0">
                                    <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                </Form.Item>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                    {t("config.webdav.testConnection")}
                                </Button>
                                <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                    {syncingWebdav ? t("config.webdav.syncing") : t("config.webdav.syncNow")}
                                </Button>
                                {webdavSyncStatus ? <span className="text-xs text-stone-500">{syncStageText(webdavSyncStatus, t)}</span> : null}
                            </div>
                            {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                        </section>
                    </Form>
                ),
            },
        );
        return items;
    }, [forcedRemote, isRemote, config, modelOptions, loadingChannelId, webdavReady, webdav, testingWebdav, syncingWebdav, webdavSyncStatus, webdavDomainProgress, t]);

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.subtitle")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    {t("common.actions.done")}
                </Button>
            }
        >
            {forcedRemote ? (
                <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-700/60 dark:bg-blue-950/30 dark:text-blue-100">{t("config.remote.forced")}</div>
            ) : isRemote ? (
                <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-700/60 dark:bg-blue-950/30 dark:text-blue-100">{t("config.remote.active")}</div>
            ) : null}
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "xvanai") return "XvanAI";
    return "OpenAI";
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    const { t } = useTranslation();
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${formatNumber(item.current || 0)} / ${formatNumber(item.total)}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`config.webdav.domains.${key}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {syncStageText(item, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "waiting") return 0;
    if (item.stage === "readingRemoteManifest") return 12;
    if (item.stage === "readingLocalData") return 24;
    if (item.stage === "downloadingMissingMedia") return 36;
    if (item.stage === "applyingMergedData") return 58;
    if (item.stage === "uploadingNewMedia") return 66;
    if (item.stage === "mediaComplete" || item.stage === "mediaUploadNotNeeded") return 74;
    if (item.stage === "uploadingManifest") return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function syncStageText(event: Pick<AppSyncProgressEvent, "stage" | "detail">, t: TFunction) {
    const stage = t(`config.webdav.stages.${event.stage}`);
    return event.detail ? `${stage} ${event.detail}` : stage;
}
