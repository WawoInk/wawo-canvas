"use client";

import { CheckCircleOutlined, DeleteOutlined, FormatPainterOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { json } from "@codemirror/lang-json";
import { App, Button, Card, Checkbox, Col, Drawer, Flex, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { TFunction } from "i18next";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorView } from "@uiw/react-codemirror";

import { formatNumber } from "@/i18n/formatters";
import { fetchAdminSettings, fetchChannelModels, saveAdminSettings, testChannelModel, type AdminGenerationProfileBinding, type AdminImageRequestFormat, type AdminModelChannel, type AdminModelCost, type AdminSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";
import { modelCostFor, normalizeModelCosts, upsertModelCost, videoBillingRule, type VideoBillingMode } from "./billing-rules";
import { normalizeAdminImageRequestFormats, normalizeAdminImageRequestResolutionSelection } from "./image-request-formats";
import { nonNegativeDecimal } from "@/lib/decimal";

const CodeMirror = lazy(() => import("@uiw/react-codemirror"));
const jsonEditorTheme = EditorView.theme({
    "&": { backgroundColor: "var(--ant-color-bg-container)", color: "var(--ant-color-text)" },
    ".cm-content": { caretColor: "var(--ant-color-text)", padding: "12px 0" },
    ".cm-line": { padding: "0 18px" },
    ".cm-gutters": { backgroundColor: "var(--ant-color-fill-quaternary)", borderRight: "1px solid var(--ant-color-border)", color: "var(--ant-color-text-tertiary)" },
    ".cm-activeLine": { backgroundColor: "var(--ant-color-fill-quaternary)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--ant-color-fill-quaternary)", color: "var(--ant-color-text)" },
    ".cm-cursor": { borderLeftColor: "var(--ant-color-text)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--ant-control-item-bg-active)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--ant-color-fill-quaternary)", border: "1px solid var(--ant-color-border)", color: "var(--ant-color-text-tertiary)" },
    "&.cm-focused": { outline: "none" },
});

const emptySettings: AdminSettings = {
    public: {
        modelChannel: {
            availableModels: [],
            modelCosts: [],
            imageRequestFormats: [],
            defaultModel: "",
            defaultImageModel: "",
            defaultVideoModel: "",
            defaultTextModel: "",
            defaultAudioModel: "",
            imageModels: [],
            videoModels: [],
            textModels: [],
            textModelProtocols: {},
            audioModels: [],
            systemPrompt: "",
            allowCustomChannel: true,
        },
        auth: { allowRegister: true, linuxDo: { enabled: false } },
        navigation: {
            enabled: true,
            canvas: true,
            canvasLocalAgent: false,
            storyboard: true,
            image: true,
            video: true,
            assets: true,
            volcengineAssets: true,
            prompts: true,
            storyboardItems: { brainstormAgent: true, storyboard: true, scriptAgent: true },
        },
    },
    private: {
        channels: [],
        generationProfiles: null,
        promptSync: { enabled: true, cron: "*/5 * * * *" },
        auth: { linuxDo: { clientId: "", clientSecret: "" } },
        fileSizeLimits: { image: 30 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 15 * 1024 * 1024, prompt: 5 * 1024 * 1024 },
    },
};
const emptyChannel: AdminModelChannel = { protocol: "openai", name: "", baseUrl: "", apiKey: "", models: [], weight: 1, enabled: true, remark: "" };
const generationProfileOptions = [
    { labelKey: "admin.settings.generationProfiles.types.standardVideo", value: "seedance-1-5-pro", durationRange: { min: 4, max: 15 }, resolutionValues: ["480p", "720p", "1080p"] },
    { labelKey: "admin.settings.generationProfiles.types.soraVideo", value: "sora-2", durationRange: { min: 4, max: 20 }, resolutionValues: ["480p", "720p", "1080p"] },
    { labelKey: "admin.settings.generationProfiles.types.shortDrama", value: "vidu-q3-drama", durationRange: { min: 8, max: 12 }, resolutionValues: ["1080p"] },
];
const billingModeOptions: Array<{ labelKey: string; value: VideoBillingMode }> = [
    { labelKey: "admin.settings.billing.modes.perCredit", value: "per_credit" },
    { labelKey: "admin.settings.billing.modes.perSecond", value: "per_second" },
    { labelKey: "admin.settings.billing.modes.perCall", value: "per_call" },
];
const billingModeLabelKeys = Object.fromEntries(billingModeOptions.map((item) => [item.value, item.labelKey])) as Record<VideoBillingMode, string>;
const imageRequestFormatOptions: Array<{ labelKey: string; value: AdminImageRequestFormat["format"] }> = [
    { labelKey: "admin.settings.public.imageRequestFormats.options.json", value: "application/json" },
    { labelKey: "admin.settings.public.imageRequestFormats.options.multipart", value: "multipart/form-data" },
    { labelKey: "admin.settings.public.imageRequestFormats.options.default", value: "default" },
];
const imageRequestResolutionOptions: Array<{ labelKey: string; value: AdminImageRequestFormat["resolutions"][number] }> = [
    { labelKey: "admin.settings.public.imageRequestFormats.resolutionOptions.default", value: "default" },
    { labelKey: "admin.settings.public.imageRequestFormats.resolutionOptions.1k", value: "1k" },
    { labelKey: "admin.settings.public.imageRequestFormats.resolutionOptions.2k", value: "2k" },
    { labelKey: "admin.settings.public.imageRequestFormats.resolutionOptions.4k", value: "4k" },
];

type SettingsTabKey = "public" | "private";
type EditorMode = "visual" | "json";
type ModelSelectTabKey = "new" | "current";

export default function AdminSettingsPage() {
    const { t } = useTranslation();
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const [form] = Form.useForm<AdminSettings>();
    const [activeTab, setActiveTab] = useState<SettingsTabKey>("public");
    const [editorMode, setEditorMode] = useState<Record<SettingsTabKey, EditorMode>>({ public: "visual", private: "visual" });
    const [jsonText, setJsonText] = useState<Record<SettingsTabKey, string>>({ public: "", private: "" });
    const [channels, setChannels] = useState<AdminModelChannel[]>([]);
    const [channelForm] = Form.useForm<AdminModelChannel>();
    const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null);
    const [isChannelDrawerOpen, setIsChannelDrawerOpen] = useState(false);
    const [testChannelIndex, setTestChannelIndex] = useState<number | null>(null);
    const [testKeyword, setTestKeyword] = useState("");
    const [selectedTestModels, setSelectedTestModels] = useState<string[]>([]);
    const [testingModels, setTestingModels] = useState<string[]>([]);
    const [testResults, setTestResults] = useState<Record<string, { status: "success" | "error"; durationSeconds?: number; message: string }>>({});
    const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
    const [modelSelectSource, setModelSelectSource] = useState<string[]>([]);
    const [modelSelectExisting, setModelSelectExisting] = useState<string[]>([]);
    const [modelSelectSelected, setModelSelectSelected] = useState<string[]>([]);
    const [modelSelectKeyword, setModelSelectKeyword] = useState("");
    const [modelSelectNewModel, setModelSelectNewModel] = useState("");
    const [modelSelectTab, setModelSelectTab] = useState<ModelSelectTabKey>("new");
    const [isFetchingChannelModels, setIsFetchingChannelModels] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [modelCosts, setModelCosts] = useState<AdminModelCost[]>([]);
    const [knownModels, setKnownModels] = useState<string[]>([]);
    const publicModels = Form.useWatch(["public", "modelChannel", "availableModels"], form) || [];
    const imageModels = Form.useWatch(["public", "modelChannel", "imageModels"], form) || [];
    const imageRequestFormats = (Form.useWatch(["public", "modelChannel", "imageRequestFormats"], form) || []) as AdminImageRequestFormat[];
    const configuredImageRequestModels = new Set(imageRequestFormats.map((item) => item?.model).filter(Boolean));
    const nextImageRequestModel = imageModels.find((model) => !configuredImageRequestModels.has(model));
    const effectiveChannels = useMemo(() => (editorMode.private === "json" ? parseTabJson("private", jsonText.private)?.channels || channels : channels), [channels, editorMode.private, jsonText.private]);
    const channelModels = useMemo(() => collectChannelModels(effectiveChannels), [effectiveChannels]);
    const generationProfileBindings = (Form.useWatch(["private", "generationProfiles"], { form, preserve: true }) || []) as AdminGenerationProfileBinding[];
    const videoBindingsByID = useMemo(() => new Map(generationProfileBindings.filter((binding) => binding.id).map((binding) => [binding.id, binding])), [generationProfileBindings]);
    const boundUpstreamModels = useMemo(() => new Set(generationProfileBindings.map((binding) => binding.upstreamModel).filter(Boolean)), [generationProfileBindings]);
    const pricedModels = useMemo(
        () =>
            uniqueModels([
                ...channelModels.filter((model) => !boundUpstreamModels.has(model)),
                ...generationProfileBindings.map((binding) => binding.id),
                ...publicModels.filter((model) => !boundUpstreamModels.has(model)),
                ...modelCosts.map((item) => item.model).filter((model) => !boundUpstreamModels.has(model)),
            ]),
        [boundUpstreamModels, channelModels, generationProfileBindings, modelCosts, publicModels],
    );
    const channelOptions = useMemo(() => channels.filter((channel) => channel.enabled && channel.name && channel.models.length).map((channel) => ({ label: channel.name, value: channel.name })), [channels]);
    const channelModelsByName = useMemo(() => Object.fromEntries(channels.map((channel) => [channel.name, channel.models || []])), [channels]);
    const channelTableData = useMemo(() => channels.map((channel, index) => ({ ...channel, _index: index, _rowKey: `${index}-${channel.name}-${channel.baseUrl}` })), [channels]);
    const activeMode = editorMode[activeTab];
    const activeJsonText = jsonText[activeTab];
    const jsonError = activeMode === "json" ? getJsonError(activeJsonText, t) : "";
    const modelSelectGroups = useMemo(() => buildModelSelectGroups(modelSelectSource, modelSelectExisting), [modelSelectSource, modelSelectExisting]);
    const activeModelSelectModels = useMemo(() => {
        const keyword = modelSelectKeyword.trim().toLowerCase();
        return modelSelectGroups[modelSelectTab].filter((model) => model.toLowerCase().includes(keyword));
    }, [modelSelectGroups, modelSelectKeyword, modelSelectTab]);
    const activeSelectedCount = activeModelSelectModels.filter((model) => modelSelectSelected.includes(model)).length;
    const generationProfileSelectOptions = generationProfileOptions.map((option) => ({ ...option, label: t(option.labelKey) }));
    const billingModeSelectOptions = billingModeOptions.map((option) => ({ label: t(option.labelKey), value: option.value }));
    const imageRequestFormatSelectOptions = imageRequestFormatOptions.map((option) => ({ label: t(option.labelKey), value: option.value }));
    const imageRequestResolutionSelectOptions = imageRequestResolutionOptions.map((option) => ({ label: t(option.labelKey), value: option.value }));

    const loadSettings = async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const data = normalizeSettings(await fetchAdminSettings(token));
            form.setFieldsValue(data);
            setChannels(data.private.channels);
            setModelCosts(data.public.modelChannel.modelCosts);
            setKnownModels(collectKnownModels(data));
            setJsonText({
                public: JSON.stringify(data.public, null, 2),
                private: JSON.stringify(data.private, null, 2),
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin.settings.messages.loadFailed"));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadSettings();
    }, [token]);

    const changeTab = (nextTab: SettingsTabKey) => {
        setActiveTab(nextTab);
    };

    const saveSettings = async () => {
        if (!token) return;
        const values = await collectSettings(form, editorMode, jsonText, message, t);
        if (!values) {
            return;
        }
        setIsSaving(true);
        try {
            const saved = normalizeSettings(await saveAdminSettings(token, values));
            const merged = mergeChannelApiKeys(values.private.channels, saved);
            form.setFieldsValue(merged);
            setChannels(merged.private.channels);
            setModelCosts(merged.public.modelChannel.modelCosts);
            rememberKnownModels(merged);
            setJsonText({
                public: JSON.stringify(merged.public, null, 2),
                private: JSON.stringify(merged.private, null, 2),
            });
            message.success(t("admin.settings.messages.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin.common.messages.saveFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    const toggleMode = (tab: SettingsTabKey, nextMode: EditorMode) => {
        if (nextMode === "json") {
            setJsonText((current) => ({
                ...current,
                [tab]: JSON.stringify(tab === "public" ? normalizePublicSetting(form.getFieldValue(["public"]) as Partial<AdminSettings["public"]>) : normalizePrivateSetting(form.getFieldValue(["private"]) as Partial<AdminSettings["private"]>), null, 2),
            }));
            setEditorMode((current) => ({ ...current, [tab]: nextMode }));
            return;
        }
        const parsed = parseTabJson(tab, jsonText[tab]);
        if (!parsed) {
            message.error(t("admin.settings.messages.invalidJson"));
            return;
        }
        form.setFieldsValue({ [tab]: parsed } as Partial<AdminSettings>);
        if (tab === "private") setChannels((parsed as AdminSettings["private"]).channels);
        if (tab === "public") setModelCosts((parsed as AdminSettings["public"]).modelChannel.modelCosts);
        rememberKnownModels({ ...normalizeSettings(form.getFieldsValue(true) as AdminSettings), [tab]: parsed });
        setEditorMode((current) => ({ ...current, [tab]: nextMode }));
    };

    const formatJson = (tab: SettingsTabKey) => {
        const parsed = parseTabJson(tab, jsonText[tab]);
        if (!parsed) {
            message.error(t("admin.settings.messages.invalidJson"));
            return;
        }
        if (tab === "public") setModelCosts((parsed as AdminSettings["public"]).modelChannel.modelCosts);
        setJsonText((current) => ({
            ...current,
            [tab]: JSON.stringify(parsed, null, 2),
        }));
    };

    const openChannelDrawer = (index: number | null) => {
        setEditingChannelIndex(index);
        setIsChannelDrawerOpen(true);
        const channel = index === null ? emptyChannel : normalizeChannel(channels[index]);
        channelForm.setFieldsValue(channel);
        rememberModels(channel.models);
    };

    const closeChannelDrawer = () => {
        setIsChannelDrawerOpen(false);
        setEditingChannelIndex(null);
        channelForm.resetFields();
    };

    const saveChannel = async () => {
        const channel = normalizeChannel(await channelForm.validateFields());
        rememberModels(channel.models);
        const nextChannels = [...channels];
        if (editingChannelIndex === null) nextChannels.push(channel);
        else nextChannels[editingChannelIndex] = channel;
        await persistChannels(nextChannels);
        closeChannelDrawer();
    };

    const fetchChannelModelList = async () => {
        if (!token) return;
        const channel = channelForm.getFieldsValue();
        if (!channel?.baseUrl) {
            message.warning(t("admin.settings.channels.messages.baseUrlRequired"));
            return;
        }
        if (editingChannelIndex === null && !channel?.apiKey) {
            message.warning(t("admin.settings.channels.messages.apiKeyRequired"));
            return;
        }
        setIsFetchingChannelModels(true);
        try {
            const channelModels = await fetchChannelModels(token, { index: editingChannelIndex ?? undefined, channel: normalizeChannel(channel) });
            const current = isModelSelectorOpen ? uniqueModels(modelSelectSelected) : uniqueModels(channelForm.getFieldValue("models") || []);
            rememberModels(channelModels);
            if (!channelModels.length) {
                message.warning(t("admin.settings.channels.messages.noModelsReturned"));
                return;
            }
            setModelSelectExisting(current);
            setModelSelectSource(uniqueModels(channelModels));
            setModelSelectSelected(uniqueModels([...current, ...channelModels]));
            setModelSelectKeyword("");
            setModelSelectNewModel("");
            setModelSelectTab("new");
            setIsModelSelectorOpen(true);
            message.success(t("admin.settings.channels.messages.modelsFetched", { count: channelModels.length, value: formatNumber(channelModels.length) }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin.settings.channels.messages.modelsLoadFailed"));
        } finally {
            setIsFetchingChannelModels(false);
        }
    };

    const openChannelModelSelector = (sourceModels?: string[]) => {
        const current = uniqueModels(channelForm.getFieldValue("models") || []);
        const source = uniqueModels(sourceModels !== undefined ? sourceModels : [...knownModels, ...current]);
        setModelSelectExisting(current);
        setModelSelectSource(source);
        setModelSelectSelected(sourceModels ? uniqueModels([...current, ...source]) : current);
        setModelSelectKeyword("");
        setModelSelectNewModel("");
        setModelSelectTab(sourceModels ? "new" : "current");
        setIsModelSelectorOpen(true);
    };

    const closeChannelModelSelector = () => {
        setIsModelSelectorOpen(false);
        setModelSelectKeyword("");
        setModelSelectNewModel("");
    };

    const confirmChannelModelSelector = () => {
        const models = uniqueModels(modelSelectSelected);
        channelForm.setFieldValue("models", models);
        rememberModels(models);
        closeChannelModelSelector();
    };

    const toggleSelectedModel = (model: string, checked: boolean) => {
        setModelSelectSelected((current) => (checked ? uniqueModels([...current, model]) : current.filter((item) => item !== model)));
    };

    const selectActiveModels = () => {
        setModelSelectSelected((current) => uniqueModels([...current, ...activeModelSelectModels]));
    };

    const clearActiveModels = () => {
        const active = new Set(activeModelSelectModels);
        setModelSelectSelected((current) => current.filter((model) => !active.has(model)));
    };

    const addModelInSelector = () => {
        const model = modelSelectNewModel.trim();
        if (!model) return;
        setModelSelectExisting((current) => uniqueModels([...current, model]));
        setModelSelectSelected((current) => uniqueModels([...current, model]));
        setModelSelectNewModel("");
        setModelSelectTab("current");
    };

    function rememberModels(models: string[]) {
        setKnownModels((current) => uniqueModels([...current, ...models]));
    }

    function rememberKnownModels(settings: AdminSettings) {
        rememberModels(collectKnownModels(settings));
    }

    function updateGenerationProfiles(profiles: AdminGenerationProfileBinding[]) {
        form.setFieldValue(["private", "generationProfiles"], profiles);
    }

    function addGenerationProfile() {
        const profiles = currentGenerationProfiles(form);
        const profileId = generationProfileOptions[0].value;
        updateGenerationProfiles([...profiles, { id: "", profileId, upstreamModel: "", channelName: "", billingMode: "per_call", enabled: true, limitOverrides: {}, metadata: {} }]);
    }

    function updateGenerationProfile(index: number, patch: Partial<AdminGenerationProfileBinding>) {
        const profiles = currentGenerationProfiles(form);
        if (!profiles[index]) return;
        profiles[index] = { ...profiles[index], ...patch };
        updateGenerationProfiles(profiles);
    }

    function updateGenerationProfileMetadata(profileIndex: number, metadataIndex: number, patch: Partial<{ key: string; value: string | number | boolean }>) {
        const entries = Object.entries(currentGenerationProfiles(form)[profileIndex]?.metadata || {});
        const current = entries[metadataIndex];
        if (!current) return;
        entries[metadataIndex] = [patch.key ?? current[0], patch.value ?? current[1]];
        updateGenerationProfile(profileIndex, { metadata: Object.fromEntries(entries) });
    }

    function addGenerationProfileMetadata(profileIndex: number) {
        const entries = Object.entries(currentGenerationProfiles(form)[profileIndex]?.metadata || {});
        if (entries.some(([key]) => !key)) return;
        updateGenerationProfile(profileIndex, { metadata: Object.fromEntries([...entries, ["", ""]]) });
    }

    function removeGenerationProfileMetadata(profileIndex: number, metadataIndex: number) {
        const entries = Object.entries(currentGenerationProfiles(form)[profileIndex]?.metadata || {});
        entries.splice(metadataIndex, 1);
        updateGenerationProfile(profileIndex, { metadata: Object.fromEntries(entries) });
    }

    function removeGenerationProfile(index: number) {
        const profiles = currentGenerationProfiles(form);
        profiles.splice(index, 1);
        updateGenerationProfiles(profiles);
    }

    function setModelPricing(model: string, patch: Partial<Omit<AdminModelCost, "model">>) {
        const current = normalizeModelCosts((form.getFieldValue(["public", "modelChannel", "modelCosts"]) || []) as AdminModelCost[]);
        const next = upsertModelCost(current, model, patch);
        form.setFieldValue(["public", "modelChannel", "modelCosts"], next);
        setModelCosts(next);
    }

    const openTestDialog = (index: number) => {
        const channel = normalizeChannel(channels[index]);
        if (!channel.baseUrl || channel.models.length === 0) {
            message.warning(t("admin.settings.channels.messages.testRequirements"));
            return;
        }
        setTestChannelIndex(index);
        setTestKeyword("");
        setSelectedTestModels([]);
        setTestingModels([]);
        setTestResults({});
    };

    const closeTestDialog = () => {
        setTestChannelIndex(null);
        setTestKeyword("");
        setSelectedTestModels([]);
        setTestingModels([]);
        setTestResults({});
    };

    const testModelOnline = async (model: string) => {
        if (testChannelIndex === null) return;
        if (!token) return;
        const channel = normalizeChannel(channels[testChannelIndex]);
        setTestingModels((current) => [...current, model]);
        try {
            const startedAt = performance.now();
            const result = await testChannelModel(token, { index: testChannelIndex, channel, model });
            setTestResults((current) => ({ ...current, [model]: { status: "success", durationSeconds: (performance.now() - startedAt) / 1000, message: result } }));
        } catch (error) {
            setTestResults((current) => ({ ...current, [model]: { status: "error", message: error instanceof Error ? error.message : t("admin.settings.channels.messages.testFailed") } }));
        } finally {
            setTestingModels((current) => current.filter((item) => item !== model));
        }
    };

    const batchTestModels = async () => {
        for (const model of selectedTestModels) {
            await testModelOnline(model);
        }
    };

    const testChannel = testChannelIndex === null ? null : normalizeChannel(channels[testChannelIndex]);
    const testModels = (testChannel?.models || []).filter((model) => model.toLowerCase().includes(testKeyword.trim().toLowerCase()));

    async function persistChannels(nextChannels: AdminModelChannel[]) {
        if (!token) return;
        const values = await collectSettings(form, editorMode, jsonText, message, t);
        if (!values) return;
        const nextChannelModels = collectChannelModels(nextChannels);
        const nextSettings = normalizeSettings({
            ...values,
            public: { ...values.public, modelChannel: { ...values.public.modelChannel, availableModels: nextChannelModels } },
            private: { ...values.private, channels: nextChannels },
        });
        const saved = normalizeSettings(await saveAdminSettings(token, nextSettings));
        const merged = mergeChannelApiKeys(nextChannels, saved);
        setChannels(merged.private.channels);
        setModelCosts(merged.public.modelChannel.modelCosts);
        rememberKnownModels(merged);
        form.setFieldsValue(merged);
        message.success(t("admin.settings.messages.saved"));
    }

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Flex justify="space-between" align="center" gap={16} wrap>
                        <Tabs
                            activeKey={activeTab}
                            onChange={(key) => changeTab(key as SettingsTabKey)}
                            items={[
                                { key: "public", label: t("admin.settings.tabs.public") },
                                { key: "private", label: t("admin.settings.tabs.private") },
                            ]}
                        />
                        <Space>
                            <Button icon={<ReloadOutlined />} loading={isLoading} onClick={() => void loadSettings()}>
                                {t("admin.common.actions.refresh")}
                            </Button>
                            <Button type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={() => void saveSettings()}>
                                {t("admin.settings.actions.saveSettings")}
                            </Button>
                        </Space>
                    </Flex>
                </Card>

                <Card variant="borderless">
                    <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
                        <Segmented
                            value={activeMode}
                            onChange={(value) => toggleMode(activeTab, value as EditorMode)}
                            options={[
                                { label: t("admin.settings.editor.visual"), value: "visual" },
                                { label: t("admin.settings.editor.json"), value: "json" },
                            ]}
                        />
                        {activeMode === "json" ? (
                            <Space>
                                {jsonError ? (
                                    <Tag color="error">{jsonError}</Tag>
                                ) : (
                                    <Tag color="success" icon={<CheckCircleOutlined />}>
                                        {t("admin.settings.editor.validJson")}
                                    </Tag>
                                )}
                                <Button icon={<FormatPainterOutlined />} onClick={() => formatJson(activeTab)}>
                                    {t("admin.settings.actions.format")}
                                </Button>
                            </Space>
                        ) : (
                            <Typography.Text type="secondary">{t(activeTab === "public" ? "admin.settings.editor.publicHint" : "admin.settings.editor.privateHint")}</Typography.Text>
                        )}
                    </Flex>

                    {activeTab === "public" ? (
                        activeMode === "visual" ? (
                            <Form form={form} layout="vertical" initialValues={emptySettings} requiredMark={false}>
                                <Row gutter={16}>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "availableModels"]} label={t("admin.settings.public.availableModels.label")} extra={t("admin.settings.public.availableModels.hint")}>
                                            <Select mode="multiple" placeholder={t("admin.settings.public.availableModels.placeholder")} options={channelModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12} lg={4}>
                                        <Form.Item name={["public", "modelChannel", "defaultModel"]} label={t("admin.settings.public.defaultModels.default")}>
                                            <Select showSearch allowClear options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12} lg={4}>
                                        <Form.Item name={["public", "modelChannel", "defaultImageModel"]} label={t("admin.settings.public.defaultModels.image")}>
                                            <Select showSearch allowClear options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12} lg={4}>
                                        <Form.Item name={["public", "modelChannel", "defaultVideoModel"]} label={t("admin.settings.public.defaultModels.video")}>
                                            <Select showSearch allowClear options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12} lg={4}>
                                        <Form.Item name={["public", "modelChannel", "defaultTextModel"]} label={t("admin.settings.public.defaultModels.text")}>
                                            <Select showSearch allowClear options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12} lg={4}>
                                        <Form.Item name={["public", "modelChannel", "defaultAudioModel"]} label={t("admin.settings.public.defaultModels.audio")}>
                                            <Select showSearch allowClear options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>{t("admin.settings.public.capabilityModels.title")}</Typography.Title>
                                        <Typography.Text type="secondary">{t("admin.settings.public.capabilityModels.description")}</Typography.Text>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item name={["public", "modelChannel", "imageModels"]} label={t("admin.settings.public.capabilityModels.imageLabel")} extra={t("admin.settings.public.capabilityModels.imageHint")}>
                                            <Select mode="multiple" showSearch allowClear placeholder={t("admin.settings.public.capabilityModels.imagePlaceholder")} options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item name={["public", "modelChannel", "videoModels"]} label={t("admin.settings.public.capabilityModels.videoLabel")} extra={t("admin.settings.public.capabilityModels.videoHint")}>
                                            <Select mode="multiple" showSearch allowClear placeholder={t("admin.settings.public.capabilityModels.videoPlaceholder")} options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item name={["public", "modelChannel", "textModels"]} label={t("admin.settings.public.capabilityModels.textLabel")} extra={t("admin.settings.public.capabilityModels.textHint")}>
                                            <Select mode="multiple" showSearch allowClear placeholder={t("admin.settings.public.capabilityModels.textPlaceholder")} options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item name={["public", "modelChannel", "audioModels"]} label={t("admin.settings.public.capabilityModels.audioLabel")} extra={t("admin.settings.public.capabilityModels.audioHint")}>
                                            <Select mode="multiple" showSearch allowClear placeholder={t("admin.settings.public.capabilityModels.audioPlaceholder")} options={publicModels.map((item) => ({ label: item, value: item }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>{t("admin.settings.public.imageRequestFormats.title")}</Typography.Title>
                                        <Typography.Paragraph type="secondary">{t("admin.settings.public.imageRequestFormats.description")}</Typography.Paragraph>
                                        <Form.List name={["public", "modelChannel", "imageRequestFormats"]}>
                                            {(fields, { add, remove }) => (
                                                <Flex vertical gap={8}>
                                                    {fields.map(({ key, name, ...restField }) => {
                                                        const currentModel = imageRequestFormats[name]?.model;
                                                        return (
                                                            <Row key={key} gutter={[8, 8]} align="bottom">
                                                                <Col xs={24} md={8}>
                                                                    <Form.Item
                                                                        {...restField}
                                                                        name={[name, "model"]}
                                                                        label={t("admin.settings.public.imageRequestFormats.modelLabel")}
                                                                        rules={[{ required: true, message: t("admin.settings.public.imageRequestFormats.modelRequired") }]}
                                                                        style={{ marginBottom: 0 }}
                                                                    >
                                                                        <Select
                                                                            showSearch
                                                                            placeholder={t("admin.settings.public.capabilityModels.imagePlaceholder")}
                                                                            options={imageModels.map((model) => ({ label: model, value: model, disabled: configuredImageRequestModels.has(model) && model !== currentModel }))}
                                                                        />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={5}>
                                                                    <Form.Item
                                                                        {...restField}
                                                                        name={[name, "format"]}
                                                                        label={t("admin.settings.public.imageRequestFormats.formatLabel")}
                                                                        rules={[{ required: true, message: t("admin.settings.public.imageRequestFormats.formatRequired") }]}
                                                                        style={{ marginBottom: 0 }}
                                                                    >
                                                                        <Select placeholder={t("admin.settings.public.imageRequestFormats.formatPlaceholder")} options={imageRequestFormatSelectOptions} />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={5}>
                                                                    <Form.Item
                                                                        {...restField}
                                                                        name={[name, "canvasRequestMode"]}
                                                                        label={t("admin.settings.public.imageRequestFormats.canvasModeLabel")}
                                                                        rules={[{ required: true, message: t("admin.settings.public.imageRequestFormats.canvasModeRequired") }]}
                                                                        style={{ marginBottom: 0 }}
                                                                    >
                                                                        <Select
                                                                            placeholder={t("admin.settings.public.imageRequestFormats.canvasModePlaceholder")}
                                                                            options={[
                                                                                { label: t("admin.settings.public.imageRequestFormats.canvasModes.split"), value: "split" },
                                                                                { label: t("admin.settings.public.imageRequestFormats.canvasModes.generations"), value: "generations" },
                                                                            ]}
                                                                        />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={24} md={4}>
                                                                    <Form.Item
                                                                        {...restField}
                                                                        name={[name, "resolutions"]}
                                                                        label={t("admin.settings.public.imageRequestFormats.resolutionLabel")}
                                                                        normalize={normalizeAdminImageRequestResolutionSelection}
                                                                        rules={[{ required: true, message: t("admin.settings.public.imageRequestFormats.resolutionRequired") }]}
                                                                        style={{ marginBottom: 0 }}
                                                                    >
                                                                        <Select
                                                                            mode="multiple"
                                                                            allowClear
                                                                            maxTagCount="responsive"
                                                                            aria-label={t("admin.settings.public.imageRequestFormats.resolutionLabel")}
                                                                            placeholder={t("admin.settings.public.imageRequestFormats.resolutionPlaceholder")}
                                                                            options={imageRequestResolutionSelectOptions}
                                                                        />
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col xs={4} md={2}>
                                                                    <Button
                                                                        type="text"
                                                                        danger
                                                                        icon={<DeleteOutlined />}
                                                                        aria-label={t("admin.settings.public.imageRequestFormats.deleteLabel", { model: currentModel || formatNumber(name + 1) })}
                                                                        onClick={() => remove(name)}
                                                                    />
                                                                </Col>
                                                            </Row>
                                                        );
                                                    })}
                                                    <Button
                                                        type="dashed"
                                                        icon={<PlusOutlined />}
                                                        disabled={!nextImageRequestModel}
                                                        onClick={() => nextImageRequestModel && add({ model: nextImageRequestModel, format: "default", canvasRequestMode: "split", resolutions: ["default"] })}
                                                    >
                                                        {t("admin.settings.actions.addModel")}
                                                    </Button>
                                                </Flex>
                                            )}
                                        </Form.List>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "systemPrompt"]} label={t("admin.settings.public.systemPrompt")}>
                                            <Input.TextArea rows={4} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "modelChannel", "allowCustomChannel"]} label={t("admin.settings.public.customChannel.label")} extra={t("admin.settings.public.customChannel.hint")} valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item name={["public", "auth", "allowRegister"]} label={t("admin.settings.public.registration.label")} extra={t("admin.settings.public.registration.hint")} valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Typography.Title level={5}>{t("admin.settings.billing.title")}</Typography.Title>
                                        <Typography.Paragraph type="secondary">{t("admin.settings.billing.description")}</Typography.Paragraph>
                                        <Table
                                            rowKey="model"
                                            pagination={false}
                                            size="small"
                                            scroll={{ x: 1120 }}
                                            dataSource={pricedModels.map((model) => {
                                                const binding = videoBindingsByID.get(model);
                                                const profileOption = generationProfileOptions.find((option) => option.value === binding?.profileId) || generationProfileOptions[0];
                                                return {
                                                    model,
                                                    binding,
                                                    rule: binding ? videoBillingRule(binding, profileOption.resolutionValues) : { mode: "per_call" as const, resolutions: [] },
                                                    cost: modelCostFor(modelCosts, model, binding?.upstreamModel),
                                                };
                                            })}
                                            columns={[
                                                {
                                                    title: t("admin.settings.billing.table.model"),
                                                    dataIndex: "model",
                                                    render: (_, item) => (
                                                        <Flex vertical>
                                                            <Typography.Text>{item.model}</Typography.Text>
                                                            {item.binding ? <Typography.Text type="secondary">{item.binding.upstreamModel}</Typography.Text> : null}
                                                        </Flex>
                                                    ),
                                                },
                                                {
                                                    title: t("admin.settings.billing.table.displayName"),
                                                    width: 220,
                                                    render: (_, item) => (
                                                        <Input
                                                            value={item.cost.displayName || ""}
                                                            placeholder={item.model}
                                                            onChange={(event) => setModelPricing(item.model, { displayName: event.target.value, credits: item.cost.credits, resolutionCredits: item.cost.resolutionCredits })}
                                                        />
                                                    ),
                                                },
                                                {
                                                    title: t("admin.settings.billing.table.rule"),
                                                    width: 140,
                                                    render: (_, item) => <Tag>{t(billingModeLabelKeys[item.rule.mode])}</Tag>,
                                                },
                                                {
                                                    title: t("admin.settings.billing.table.price"),
                                                    width: 620,
                                                    render: (_, item) =>
                                                        item.rule.mode === "per_second" ? (
                                                            <Flex gap={8} wrap>
                                                                {item.rule.resolutions.map((resolution) => (
                                                                    <InputNumber
                                                                        key={resolution}
                                                                        min="0"
                                                                        step="0.01"
                                                                        stringMode
                                                                        addonBefore={resolution}
                                                                        addonAfter={t("admin.settings.billing.units.pointsPerSecond")}
                                                                        style={{ width: 190 }}
                                                                        value={item.cost.resolutionCredits?.[resolution] || "0"}
                                                                        onChange={(value) =>
                                                                            setModelPricing(item.model, {
                                                                                resolutionCredits: { ...(item.cost.resolutionCredits || {}), [resolution]: nonNegativeDecimal(value) },
                                                                            })
                                                                        }
                                                                    />
                                                                ))}
                                                            </Flex>
                                                        ) : (
                                                            <InputNumber
                                                                min="0"
                                                                step="0.01"
                                                                stringMode
                                                                addonBefore={t(item.rule.mode === "per_credit" ? "admin.settings.billing.units.perCredit" : "admin.settings.billing.units.perCall")}
                                                                addonAfter={t("admin.settings.billing.units.points")}
                                                                style={{ width: 240 }}
                                                                value={item.cost.credits}
                                                                onChange={(value) => setModelPricing(item.model, { credits: nonNegativeDecimal(value) })}
                                                            />
                                                        ),
                                                },
                                            ]}
                                        />
                                    </Col>
                                </Row>
                            </Form>
                        ) : (
                            <Suspense fallback={<Spin />}>
                                <div style={{ overflow: "hidden", border: "1px solid var(--ant-color-border)", borderRadius: 6 }}>
                                    <CodeMirror
                                        value={activeJsonText}
                                        height="520px"
                                        extensions={[json(), jsonEditorTheme]}
                                        basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
                                        theme="none"
                                        onChange={(value) => setJsonText((current) => ({ ...current, public: value }))}
                                        style={{ fontSize: 13 }}
                                    />
                                </div>
                            </Suspense>
                        )
                    ) : activeMode === "visual" ? (
                        <Form form={form} layout="vertical" initialValues={emptySettings} requiredMark={false}>
                            <Flex vertical gap={12}>
                                <Card
                                    size="small"
                                    title={
                                        <Space>
                                            <img src="/icons/linuxdo.svg" alt="" width={18} height={18} />
                                            {t("admin.settings.private.linuxDo.title")}
                                        </Space>
                                    }
                                >
                                    <Flex vertical gap={14}>
                                        <Typography.Text type="secondary">
                                            {t("admin.settings.private.linuxDo.callbackHint")}
                                            <Typography.Link href="https://connect.linux.do" target="_blank" rel="noreferrer">
                                                {t("admin.settings.private.linuxDo.manageApp")}
                                            </Typography.Link>
                                        </Typography.Text>
                                        <Row gutter={16}>
                                            <Col xs={24} md={6}>
                                                <Form.Item name={["public", "auth", "linuxDo", "enabled"]} label={t("admin.settings.private.linuxDo.enabled")} valuePropName="checked">
                                                    <Switch />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={9}>
                                                <Form.Item name={["private", "auth", "linuxDo", "clientId"]} label={t("admin.settings.private.linuxDo.clientId")}>
                                                    <Input placeholder={t("admin.settings.private.linuxDo.clientIdPlaceholder")} />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={9}>
                                                <Form.Item name={["private", "auth", "linuxDo", "clientSecret"]} label={t("admin.settings.private.linuxDo.clientSecret")}>
                                                    <Input.Password placeholder={t("admin.settings.private.linuxDo.secretPlaceholder")} />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </Flex>
                                </Card>
                                <Card size="small" title={t("admin.settings.private.promptSync.title")}>
                                    <Row gutter={16} align="middle">
                                        <Col xs={24} md={8}>
                                            <Form.Item name={["private", "promptSync", "enabled"]} label={t("admin.settings.private.promptSync.enabled")} valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={16}>
                                            <Form.Item name={["private", "promptSync", "cron"]} label={t("admin.settings.private.promptSync.cron")} extra={t("admin.settings.private.promptSync.hint")}>
                                                <Input placeholder="*/5 * * * *" />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </Card>
                                <Card size="small" title={t("admin.settings.private.fileLimits.title")}>
                                    <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                                        {t("admin.settings.private.fileLimits.description")}
                                    </Typography.Text>
                                    <Row gutter={16}>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "fileSizeLimits", "image"]} label={t("admin.settings.private.fileLimits.image")} getValueFromEvent={mbValue} getValueProps={mbProps}>
                                                <InputNumber min={1} step={1} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "fileSizeLimits", "video"]} label={t("admin.settings.private.fileLimits.video")} getValueFromEvent={mbValue} getValueProps={mbProps}>
                                                <InputNumber min={1} step={1} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "fileSizeLimits", "audio"]} label={t("admin.settings.private.fileLimits.audio")} getValueFromEvent={mbValue} getValueProps={mbProps}>
                                                <InputNumber min={1} step={1} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={6}>
                                            <Form.Item name={["private", "fileSizeLimits", "prompt"]} label={t("admin.settings.private.fileLimits.prompt")} getValueFromEvent={mbValue} getValueProps={mbProps}>
                                                <InputNumber min={1} step={1} className="!w-full" />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </Card>
                                <Button type="primary" icon={<PlusOutlined />} onClick={() => openChannelDrawer(null)}>
                                    {t("admin.settings.channels.actions.add")}
                                </Button>
                                <Table
                                    rowKey="_rowKey"
                                    pagination={false}
                                    dataSource={channelTableData}
                                    columns={[
                                        { title: t("admin.settings.channels.table.name"), dataIndex: "name", render: (value) => value || t("admin.settings.channels.values.unnamed") },
                                        { title: t("admin.settings.channels.table.protocol"), dataIndex: "protocol", width: 96, render: (value) => <Tag>{value || "openai"}</Tag> },
                                        {
                                            title: t("admin.settings.channels.table.status"),
                                            dataIndex: "enabled",
                                            width: 96,
                                            render: (value) => <Tag color={value ? "success" : "default"}>{t(value ? "admin.common.statuses.enabled" : "admin.common.statuses.disabled")}</Tag>,
                                        },
                                        {
                                            title: t("admin.settings.channels.table.models"),
                                            dataIndex: "models",
                                            render: (value: string[]) => (
                                                <Typography.Text ellipsis style={{ maxWidth: 360 }}>
                                                    {modelSummary(value || [], t)}
                                                </Typography.Text>
                                            ),
                                        },
                                        { title: t("admin.settings.channels.table.weight"), dataIndex: "weight", width: 88 },
                                        {
                                            title: t("admin.common.table.actions"),
                                            key: "actions",
                                            width: 220,
                                            align: "right",
                                            render: (_, item) => (
                                                <Space size={4}>
                                                    <Button size="small" onClick={() => openTestDialog(item._index)}>
                                                        {t("admin.common.actions.test")}
                                                    </Button>
                                                    <Button size="small" onClick={() => openChannelDrawer(item._index)}>
                                                        {t("admin.common.actions.edit")}
                                                    </Button>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        icon={<DeleteOutlined />}
                                                        aria-label={t("admin.settings.channels.actions.deleteLabel", { name: item.name || t("admin.settings.channels.values.unnamed") })}
                                                        onClick={() => {
                                                            const nextChannels = [...channels];
                                                            nextChannels.splice(item._index, 1);
                                                            void persistChannels(nextChannels);
                                                        }}
                                                    />
                                                </Space>
                                            ),
                                        },
                                    ]}
                                />
                                <Card
                                    size="small"
                                    title={t("admin.settings.generationProfiles.title")}
                                    extra={
                                        <Button size="small" icon={<PlusOutlined />} disabled={!channelOptions.length} onClick={addGenerationProfile}>
                                            {t("admin.settings.generationProfiles.actions.add")}
                                        </Button>
                                    }
                                >
                                    <Typography.Text type="secondary" style={{ display: "block", marginBottom: generationProfileBindings.length ? 16 : 0 }}>
                                        {t("admin.settings.generationProfiles.description")}
                                    </Typography.Text>
                                    {!channelOptions.length ? (
                                        <Typography.Text type="secondary">{t("admin.settings.generationProfiles.channelRequired")}</Typography.Text>
                                    ) : generationProfileBindings.length ? (
                                        <Flex vertical gap={12}>
                                            {generationProfileBindings.map((binding: AdminGenerationProfileBinding, index: number) => {
                                                const modelOptions = (channelModelsByName[binding.channelName] || []).map((model) => ({ label: model, value: model }));
                                                const profileOption = generationProfileOptions.find((option) => option.value === binding.profileId) || generationProfileOptions[0];
                                                const billingRule = videoBillingRule(binding, profileOption.resolutionValues);
                                                const updateResolutions = (values: string[]) => {
                                                    if (!values.length) return false;
                                                    const resolutions = [...new Set(values.map((value) => value.trim().toLowerCase()))];
                                                    if (resolutions.some((value) => !/^[1-9]\d*[pk]$/.test(value))) {
                                                        message.error(t("admin.settings.generationProfiles.form.invalidResolution"));
                                                        return false;
                                                    }
                                                    const resolutionOverride = resolutions.length === profileOption.resolutionValues.length && profileOption.resolutionValues.every((value) => resolutions.includes(value)) ? undefined : resolutions;
                                                    updateGenerationProfile(index, { limitOverrides: { ...binding.limitOverrides, resolutionValues: resolutionOverride } });
                                                    return true;
                                                };
                                                return (
                                                    <section key={`${binding.profileId}-${index}`} style={{ border: "1px solid var(--ant-color-border)", borderRadius: 6, padding: "12px 12px 4px" }}>
                                                        <Flex justify="space-between" align="center" gap={12} style={{ marginBottom: 4 }}>
                                                            <Typography.Text strong>{binding.id || t("admin.settings.generationProfiles.defaultName", { number: formatNumber(index + 1) })}</Typography.Text>
                                                            <Space size={8}>
                                                                <Typography.Text type="secondary">{t("admin.common.statuses.enable")}</Typography.Text>
                                                                <Switch checked={binding.enabled !== false} onChange={(enabled) => updateGenerationProfile(index, { enabled })} />
                                                                <Button
                                                                    danger
                                                                    type="text"
                                                                    icon={<DeleteOutlined />}
                                                                    aria-label={t("admin.settings.generationProfiles.actions.deleteLabel", {
                                                                        capability: t(generationProfileOptions.find((option) => option.value === binding.profileId)?.labelKey || "admin.settings.generationProfiles.values.capability"),
                                                                    })}
                                                                    onClick={() => removeGenerationProfile(index)}
                                                                />
                                                            </Space>
                                                        </Flex>
                                                        <Tabs
                                                            size="small"
                                                            items={[
                                                                {
                                                                    key: "binding",
                                                                    label: t("admin.settings.generationProfiles.tabs.binding"),
                                                                    children: (
                                                                        <Row gutter={12} align="middle">
                                                                            <Col xs={24} md={8} xl={4}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.bindingId")}>
                                                                                    <Input value={binding.id} placeholder="stable-profile-id" onChange={(event) => updateGenerationProfile(index, { id: event.target.value })} />
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col xs={24} md={8} xl={5}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.capability")}>
                                                                                    <Select value={binding.profileId} options={generationProfileSelectOptions} onChange={(profileId) => updateGenerationProfile(index, { profileId, limitOverrides: {} })} />
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col xs={24} md={8} xl={4}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.channel")}>
                                                                                    <Select
                                                                                        showSearch
                                                                                        value={binding.channelName || undefined}
                                                                                        placeholder={t("admin.settings.generationProfiles.form.channelPlaceholder")}
                                                                                        options={channelOptions}
                                                                                        onChange={(channelName) => updateGenerationProfile(index, { channelName, upstreamModel: "", upstreamModels: undefined })}
                                                                                    />
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col xs={24} md={8} xl={6}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.upstreamModel")}>
                                                                                    <Select
                                                                                        showSearch
                                                                                        value={binding.upstreamModel || undefined}
                                                                                        placeholder={t(binding.channelName ? "admin.settings.generationProfiles.form.modelPlaceholder" : "admin.settings.generationProfiles.form.selectChannelFirst")}
                                                                                        disabled={!binding.channelName}
                                                                                        options={modelOptions}
                                                                                        onChange={(upstreamModel) => updateGenerationProfile(index, { upstreamModel, upstreamModels: undefined, ...(!binding.id ? { id: upstreamModel } : {}) })}
                                                                                    />
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col xs={12} md={8} xl={3}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.maxDuration")}>
                                                                                    <InputNumber
                                                                                        min={profileOption.durationRange.min}
                                                                                        step={1}
                                                                                        precision={0}
                                                                                        className="!w-full"
                                                                                        value={binding.limitOverrides?.durationSecondsMax}
                                                                                        placeholder={t("admin.settings.generationProfiles.form.durationPlaceholder", { value: formatNumber(profileOption.durationRange.max) })}
                                                                                        addonAfter={t("admin.settings.units.seconds")}
                                                                                        onChange={(durationSecondsMax) =>
                                                                                            updateGenerationProfile(index, {
                                                                                                limitOverrides: { ...binding.limitOverrides, durationSecondsMax: durationSecondsMax ?? undefined },
                                                                                            })
                                                                                        }
                                                                                    />
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col xs={24} md={12} xl={5}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.resolutions")}>
                                                                                    <Flex vertical gap={8}>
                                                                                        <Select
                                                                                            mode="multiple"
                                                                                            value={billingRule.resolutions}
                                                                                            options={[...new Set([...profileOption.resolutionValues, ...billingRule.resolutions])].map((value) => ({ label: value, value }))}
                                                                                            onChange={updateResolutions}
                                                                                        />
                                                                                        <CustomResolutionInput onAdd={(value) => updateResolutions([...billingRule.resolutions, value])} />
                                                                                    </Flex>
                                                                                </Form.Item>
                                                                            </Col>
                                                                            <Col span={24}>
                                                                                <Form.Item label={t("admin.settings.generationProfiles.form.metadata")}>
                                                                                    <Flex vertical gap={8}>
                                                                                        {Object.entries(binding.metadata || {}).map(([key, value], metadataIndex) => (
                                                                                            <Space.Compact key={metadataIndex} block>
                                                                                                <Input
                                                                                                    value={key}
                                                                                                    aria-label={t("admin.settings.generationProfiles.form.metadataKey")}
                                                                                                    placeholder={t("admin.settings.generationProfiles.form.metadataKey")}
                                                                                                    onChange={(event) => updateGenerationProfileMetadata(index, metadataIndex, { key: event.target.value })}
                                                                                                />
                                                                                                <Select
                                                                                                    aria-label={t("admin.settings.generationProfiles.form.metadataType")}
                                                                                                    style={{ width: 110 }}
                                                                                                    value={typeof value === "number" ? "int" : typeof value === "boolean" ? "boolean" : "string"}
                                                                                                    options={["string", "int", "boolean"].map((type) => ({ label: type, value: type }))}
                                                                                                    onChange={(type) =>
                                                                                                        updateGenerationProfileMetadata(index, metadataIndex, {
                                                                                                            value:
                                                                                                                type === "int"
                                                                                                                    ? Number.isSafeInteger(Number(value))
                                                                                                                        ? Number(value)
                                                                                                                        : 0
                                                                                                                    : type === "boolean"
                                                                                                                      ? value === true || value === "true"
                                                                                                                      : String(value),
                                                                                                        })
                                                                                                    }
                                                                                                />
                                                                                                {typeof value === "number" ? (
                                                                                                    <InputNumber
                                                                                                        value={value}
                                                                                                        precision={0}
                                                                                                        aria-label={t("admin.settings.generationProfiles.form.metadataValue")}
                                                                                                        placeholder={t("admin.settings.generationProfiles.form.metadataValue")}
                                                                                                        onChange={(next) => updateGenerationProfileMetadata(index, metadataIndex, { value: next ?? 0 })}
                                                                                                    />
                                                                                                ) : typeof value === "boolean" ? (
                                                                                                    <Select
                                                                                                        value={String(value)}
                                                                                                        aria-label={t("admin.settings.generationProfiles.form.metadataValue")}
                                                                                                        options={[
                                                                                                            { label: "true", value: "true" },
                                                                                                            { label: "false", value: "false" },
                                                                                                        ]}
                                                                                                        onChange={(next) => updateGenerationProfileMetadata(index, metadataIndex, { value: next === "true" })}
                                                                                                    />
                                                                                                ) : (
                                                                                                    <Input
                                                                                                        value={value}
                                                                                                        aria-label={t("admin.settings.generationProfiles.form.metadataValue")}
                                                                                                        placeholder={t("admin.settings.generationProfiles.form.metadataValue")}
                                                                                                        onChange={(event) => updateGenerationProfileMetadata(index, metadataIndex, { value: event.target.value })}
                                                                                                    />
                                                                                                )}
                                                                                                <Button
                                                                                                    danger
                                                                                                    type="text"
                                                                                                    icon={<DeleteOutlined />}
                                                                                                    aria-label={t("admin.settings.generationProfiles.actions.deleteMetadataLabel", { key: key || metadataIndex + 1 })}
                                                                                                    onClick={() => removeGenerationProfileMetadata(index, metadataIndex)}
                                                                                                />
                                                                                            </Space.Compact>
                                                                                        ))}
                                                                                        <Button type="dashed" icon={<PlusOutlined />} onClick={() => addGenerationProfileMetadata(index)}>
                                                                                            {t("admin.settings.generationProfiles.actions.addMetadata")}
                                                                                        </Button>
                                                                                    </Flex>
                                                                                </Form.Item>
                                                                            </Col>
                                                                        </Row>
                                                                    ),
                                                                },
                                                                {
                                                                    key: "billing",
                                                                    label: t("admin.settings.generationProfiles.tabs.billing"),
                                                                    children: (
                                                                        <Form.Item label={t("admin.settings.generationProfiles.form.billingMode")} className="mb-3">
                                                                            <Segmented
                                                                                block
                                                                                value={billingRule.mode}
                                                                                options={billingModeSelectOptions}
                                                                                onChange={(billingMode) => updateGenerationProfile(index, { billingMode: billingMode as VideoBillingMode })}
                                                                            />
                                                                        </Form.Item>
                                                                    ),
                                                                },
                                                            ]}
                                                        />
                                                    </section>
                                                );
                                            })}
                                        </Flex>
                                    ) : (
                                        <Typography.Text type="secondary">{t("admin.settings.generationProfiles.empty")}</Typography.Text>
                                    )}
                                </Card>
                            </Flex>
                        </Form>
                    ) : (
                        <Suspense fallback={<Spin />}>
                            <div style={{ overflow: "hidden", border: "1px solid var(--ant-color-border)", borderRadius: 6 }}>
                                <CodeMirror
                                    value={activeJsonText}
                                    height="520px"
                                    extensions={[json(), jsonEditorTheme]}
                                    basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true }}
                                    theme="none"
                                    onChange={(value) => setJsonText((current) => ({ ...current, private: value }))}
                                    style={{ fontSize: 13 }}
                                />
                            </div>
                        </Suspense>
                    )}
                </Card>
                <Drawer
                    title={t(editingChannelIndex === null ? "admin.settings.channels.drawer.createTitle" : "admin.settings.channels.drawer.editTitle")}
                    open={isChannelDrawerOpen}
                    size={560}
                    onClose={closeChannelDrawer}
                    extra={
                        <Space>
                            <Button onClick={closeChannelDrawer}>{t("admin.common.actions.cancel")}</Button>
                            <Button type="primary" onClick={() => void saveChannel()}>
                                {t("admin.common.actions.save")}
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                >
                    <Form form={channelForm} layout="vertical" requiredMark={false} initialValues={emptyChannel}>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="name" label={t("admin.settings.channels.form.name")} rules={[{ required: true, message: t("admin.settings.channels.validation.nameRequired") }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="protocol" label={t("admin.settings.channels.form.protocol")}>
                                    <Select
                                        options={[
                                            { label: t("admin.settings.channels.protocols.openai"), value: "openai" },
                                            { label: t("admin.settings.channels.protocols.xvanai"), value: "xvanai" },
                                        ]}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="weight" label={t("admin.settings.channels.form.weight")}>
                                    <InputNumber min={1} step={1} className="!w-full" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="enabled" label={t("admin.common.statuses.enable")} valuePropName="checked">
                                    <Switch />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="baseUrl" label={t("admin.settings.channels.form.baseUrl")} rules={[{ required: true, message: t("admin.settings.channels.validation.baseUrlRequired") }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="apiKey" label={t("admin.settings.channels.form.apiKey")} rules={editingChannelIndex === null ? [{ required: true, message: t("admin.settings.channels.validation.apiKeyRequired") }] : []}>
                                    <Input.Password placeholder={editingChannelIndex === null ? "" : t("admin.settings.channels.form.apiKeyPlaceholder")} />
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item label={t("admin.settings.channels.form.models")}>
                                    <Space.Compact style={{ width: "100%" }}>
                                        <Form.Item name="models" noStyle>
                                            <Select mode="tags" maxTagCount="responsive" tokenSeparators={[",", "\n"]} options={knownModels.map((model) => ({ label: model, value: model }))} />
                                        </Form.Item>
                                        <Button onClick={() => openChannelModelSelector()}>{t("admin.settings.actions.selectModels")}</Button>
                                    </Space.Compact>
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item name="remark" label={t("admin.settings.channels.form.remark")}>
                                    <Input.TextArea rows={3} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Drawer>
                <Modal
                    title={
                        <Space size={12}>
                            {t("admin.settings.modelSelector.title")}
                            <Typography.Text type="secondary">
                                {t("admin.settings.modelSelector.selectedSummary", {
                                    selected: formatNumber(modelSelectSelected.length),
                                    total: formatNumber(uniqueModels([...modelSelectSource, ...modelSelectExisting]).length),
                                })}
                            </Typography.Text>
                        </Space>
                    }
                    open={isModelSelectorOpen}
                    width={960}
                    onCancel={closeChannelModelSelector}
                    footer={
                        <Space>
                            <Button onClick={closeChannelModelSelector}>{t("admin.common.actions.cancel")}</Button>
                            <Button type="primary" onClick={confirmChannelModelSelector}>
                                {t("admin.common.actions.confirm")}
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                >
                    <Flex vertical gap={14}>
                        <Flex gap={12} wrap>
                            <Input.Search placeholder={t("admin.settings.modelSelector.searchPlaceholder")} allowClear value={modelSelectKeyword} onChange={(event) => setModelSelectKeyword(event.target.value)} style={{ flex: "1 1 260px" }} />
                            <Space.Compact style={{ flex: "1 1 320px" }}>
                                <Input value={modelSelectNewModel} placeholder={t("admin.settings.modelSelector.modelPlaceholder")} onChange={(event) => setModelSelectNewModel(event.target.value)} onPressEnter={addModelInSelector} />
                                <Button onClick={addModelInSelector}>{t("admin.settings.actions.addModel")}</Button>
                                <Button icon={<ReloadOutlined />} loading={isFetchingChannelModels} onClick={() => void fetchChannelModelList()}>
                                    {t("admin.settings.modelSelector.fetchModels")}
                                </Button>
                            </Space.Compact>
                        </Flex>
                        <Typography.Text type="secondary">{t("admin.settings.modelSelector.manualHint")}</Typography.Text>
                        <Tabs
                            activeKey={modelSelectTab}
                            onChange={(key) => setModelSelectTab(key as ModelSelectTabKey)}
                            items={[
                                { key: "new", label: t("admin.settings.modelSelector.tabs.new", { count: modelSelectGroups.new.length, value: formatNumber(modelSelectGroups.new.length) }) },
                                { key: "current", label: t("admin.settings.modelSelector.tabs.current", { count: modelSelectGroups.current.length, value: formatNumber(modelSelectGroups.current.length) }) },
                            ]}
                        />
                        <Flex justify="space-between" align="center" gap={12} wrap>
                            <Typography.Text type="secondary">{t("admin.settings.modelSelector.currentSummary", { selected: formatNumber(activeSelectedCount), total: formatNumber(activeModelSelectModels.length) })}</Typography.Text>
                            <Space size={8}>
                                <Button size="small" disabled={!activeModelSelectModels.length || activeSelectedCount === activeModelSelectModels.length} onClick={selectActiveModels}>
                                    {t("admin.settings.modelSelector.selectAll")}
                                </Button>
                                <Button size="small" disabled={!activeSelectedCount} onClick={clearActiveModels}>
                                    {t("admin.settings.modelSelector.clearCurrent")}
                                </Button>
                            </Space>
                        </Flex>
                        <div style={{ maxHeight: 420, overflowY: "auto", borderTop: "1px solid var(--ant-color-border-secondary)", paddingTop: 12 }}>
                            {activeModelSelectModels.length ? (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 24, rowGap: 12 }}>
                                    {activeModelSelectModels.map((model) => (
                                        <Checkbox key={model} checked={modelSelectSelected.includes(model)} onChange={(event) => toggleSelectedModel(model, event.target.checked)}>
                                            <Typography.Text style={{ wordBreak: "break-all" }}>{model}</Typography.Text>
                                        </Checkbox>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ padding: "48px 0", textAlign: "center" }}>
                                    <Typography.Text type="secondary">{t("admin.settings.modelSelector.empty")}</Typography.Text>
                                </div>
                            )}
                        </div>
                    </Flex>
                </Modal>
                <Modal
                    title={
                        <Space>
                            {t("admin.settings.channelTest.title", { name: testChannel?.name || t("admin.settings.channels.values.channel") })}
                            <Typography.Text type="secondary">{t("admin.settings.channelTest.modelCount", { count: testChannel?.models.length || 0, value: formatNumber(testChannel?.models.length || 0) })}</Typography.Text>
                        </Space>
                    }
                    open={testChannelIndex !== null}
                    width={920}
                    onCancel={closeTestDialog}
                    footer={
                        <Space>
                            <Button onClick={closeTestDialog}>{t("admin.common.actions.cancel")}</Button>
                            <Button type="primary" disabled={!selectedTestModels.length || testingModels.length > 0} onClick={() => void batchTestModels()}>
                                {t("admin.settings.channelTest.batchTest", { count: selectedTestModels.length, value: formatNumber(selectedTestModels.length) })}
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                >
                    <Flex vertical gap={12}>
                        <Typography.Text type="secondary">{t("admin.settings.channelTest.description")}</Typography.Text>
                        <Input.Search placeholder={t("admin.settings.channelTest.searchPlaceholder")} allowClear value={testKeyword} onChange={(event) => setTestKeyword(event.target.value)} />
                        <Table
                            rowKey="model"
                            pagination={false}
                            scroll={{ y: 420 }}
                            dataSource={testModels.map((model) => ({ model }))}
                            rowSelection={{
                                selectedRowKeys: selectedTestModels,
                                onChange: (keys) => setSelectedTestModels(keys.map(String)),
                            }}
                            columns={[
                                { title: t("admin.settings.channelTest.table.model"), dataIndex: "model", render: (value) => <Typography.Text strong>{value}</Typography.Text> },
                                {
                                    title: t("admin.settings.channelTest.table.status"),
                                    dataIndex: "model",
                                    width: 260,
                                    render: (value) => {
                                        if (testingModels.includes(value)) return <Tag icon={<LoadingOutlined className="animate-spin" />}>{t("admin.settings.channelTest.statuses.testing")}</Tag>;
                                        const result = testResults[value];
                                        if (!result) return <Tag>{t("admin.settings.channelTest.statuses.notStarted")}</Tag>;
                                        return result.status === "success" ? (
                                            <Space size={6} wrap>
                                                <Tag color="success">{t("admin.settings.channelTest.statuses.success")}</Tag>
                                                <Typography.Text type="secondary">
                                                    {t("admin.settings.channelTest.duration", {
                                                        value: formatNumber(result.durationSeconds || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                                                    })}
                                                </Typography.Text>
                                            </Space>
                                        ) : (
                                            <Typography.Text type="danger">{result.message}</Typography.Text>
                                        );
                                    },
                                },
                                {
                                    title: t("admin.common.table.actions"),
                                    key: "actions",
                                    width: 120,
                                    align: "right",
                                    render: (_, item) => (
                                        <Button size="small" loading={testingModels.includes(item.model)} onClick={() => void testModelOnline(item.model)}>
                                            {t("admin.common.actions.test")}
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    </Flex>
                </Modal>
            </Flex>
        </main>
    );
}

function CustomResolutionInput({ onAdd }: { onAdd: (value: string) => boolean }) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const add = () => {
        if (onAdd(value)) setValue("");
    };
    return (
        <Space.Compact block>
            <Input
                aria-label={t("admin.settings.generationProfiles.form.customResolution")}
                placeholder={t("admin.settings.generationProfiles.form.resolutionPlaceholder")}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onPressEnter={add}
            />
            <Button onClick={add}>{t("admin.settings.generationProfiles.form.addResolution")}</Button>
        </Space.Compact>
    );
}

function normalizeSettings(settings: Partial<AdminSettings> = {}): AdminSettings {
    const privateSetting = normalizePrivateSetting(settings.private);
    return {
        public: {
            ...normalizePublicSetting(settings.public),
        },
        private: privateSetting,
    };
}

function normalizePublicSetting(setting: Partial<AdminSettings["public"]> = {}): AdminSettings["public"] {
    return {
        ...emptySettings.public,
        modelChannel: {
            ...emptySettings.public.modelChannel,
            ...(setting.modelChannel || {}),
            availableModels: setting.modelChannel?.availableModels || [],
            modelCosts: normalizeModelCosts(setting.modelChannel?.modelCosts || []),
            imageRequestFormats: normalizeAdminImageRequestFormats(setting.modelChannel?.imageRequestFormats || []),
        },
        auth: {
            allowRegister: setting.auth?.allowRegister !== false,
            linuxDo: {
                enabled: setting.auth?.linuxDo?.enabled === true,
            },
        },
        navigation: {
            ...emptySettings.public.navigation,
            ...(setting.navigation || {}),
            storyboardItems: {
                ...emptySettings.public.navigation.storyboardItems,
                ...(setting.navigation?.storyboardItems || {}),
            },
        },
    };
}

function currentGenerationProfiles(form: any) {
    return [...((form.getFieldValue(["private", "generationProfiles"]) || []) as AdminGenerationProfileBinding[])];
}

function normalizePrivateSetting(setting: Partial<AdminSettings["private"]> = {}): AdminSettings["private"] {
    return {
        channels: (setting.channels || []).map(normalizeChannel),
        generationProfiles:
            setting.generationProfiles?.map((binding) => ({
                id: binding.id || binding.upstreamModel || (binding.upstreamModels?.length === 1 ? binding.upstreamModels[0] : ""),
                profileId: binding.profileId || "",
                upstreamModel: binding.upstreamModel || (binding.upstreamModels?.length === 1 ? binding.upstreamModels[0] : ""),
                channelName: binding.channelName || "",
                billingMode: binding.billingMode || "per_call",
                ...(binding.credits == null ? {} : { credits: nonNegativeDecimal(binding.credits) }),
                enabled: binding.enabled !== false,
                limitOverrides: binding.limitOverrides || {},
                metadata: Object.fromEntries(
                    Object.entries(binding.metadata || {})
                        .map(([key, value]) => [String(key).trim(), typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : ""])
                        .filter(([key]) => key),
                ),
            })) ?? null,
        promptSync: {
            enabled: setting.promptSync?.enabled !== false,
            cron: setting.promptSync?.cron || "*/5 * * * *",
        },
        auth: {
            linuxDo: {
                clientId: setting.auth?.linuxDo?.clientId || "",
                clientSecret: setting.auth?.linuxDo?.clientSecret || "",
            },
        },
        fileSizeLimits: {
            image: Math.max(0, Number(setting.fileSizeLimits?.image) || 30 * 1024 * 1024),
            video: Math.max(0, Number(setting.fileSizeLimits?.video) || 50 * 1024 * 1024),
            audio: Math.max(0, Number(setting.fileSizeLimits?.audio) || 15 * 1024 * 1024),
            prompt: Math.max(0, Number(setting.fileSizeLimits?.prompt) || 5 * 1024 * 1024),
        },
    };
}

function normalizeChannel(item: Partial<AdminModelChannel> = {}): AdminModelChannel {
    return {
        protocol: item.protocol || "openai",
        name: item.name || "",
        baseUrl: item.baseUrl || "",
        apiKey: item.apiKey || "",
        models: item.models || [],
        weight: Math.max(1, Number(item.weight) || 1),
        enabled: item.enabled !== false,
        remark: item.remark || "",
    };
}

function mergeChannelApiKeys(currentChannels: AdminModelChannel[], saved: AdminSettings): AdminSettings {
    const channels = saved.private.channels.map((item, index) => ({
        ...item,
        apiKey: currentChannels[index]?.apiKey || item.apiKey,
    }));
    return {
        public: saved.public,
        private: { ...saved.private, channels },
    };
}

function collectChannelModels(channels: AdminModelChannel[]) {
    return uniqueModels(channels.filter((channel) => channel.enabled).flatMap((channel) => channel.models || []));
}

// ponytail: simple byte↔MB converters for file size limit inputs

function mbValue(value: number | null) {
    return value != null ? value * 1024 * 1024 : 0;
}

function mbProps(value: number | null) {
    return { value: value != null ? value / (1024 * 1024) : 0 };
}

function collectKnownModels(settings: AdminSettings) {
    return uniqueModels([...(settings.public.modelChannel.availableModels || []), ...(settings.public.modelChannel.modelCosts || []).map((item) => item.model), ...settings.private.channels.flatMap((channel) => channel.models || [])]);
}

function buildModelSelectGroups(sourceModels: string[], existingModels: string[]): Record<ModelSelectTabKey, string[]> {
    const source = uniqueModels(sourceModels);
    const existing = uniqueModels(existingModels);
    const existingSet = new Set(existing);
    return {
        new: source.filter((model) => !existingSet.has(model)),
        current: existing,
    };
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.filter(Boolean)));
}

function modelSummary(models: string[], t: TFunction) {
    if (!models.length) return t("admin.settings.channels.values.noModels");
    const preview = models.slice(0, 3).join(", ");
    return models.length > 3 ? t("admin.settings.channels.values.modelSummary", { count: models.length, value: formatNumber(models.length), models: preview }) : preview;
}

function parseTabJson(tab: "public", value: string): AdminSettings["public"] | null;
function parseTabJson(tab: "private", value: string): AdminSettings["private"] | null;
function parseTabJson(tab: SettingsTabKey, value: string): AdminSettings[SettingsTabKey] | null;
function parseTabJson(tab: SettingsTabKey, value: string): AdminSettings[SettingsTabKey] | null {
    try {
        return tab === "public" ? normalizePublicSetting(JSON.parse(value) as Partial<AdminSettings["public"]>) : normalizePrivateSetting(JSON.parse(value) as Partial<AdminSettings["private"]>);
    } catch {
        return null;
    }
}

async function collectSettings(form: any, editorMode: Record<SettingsTabKey, EditorMode>, jsonText: Record<SettingsTabKey, string>, message: { error: (value: string) => void }, t: TFunction) {
    const values = normalizeSettings(form.getFieldsValue(true) as AdminSettings);
    if (editorMode.public === "json") {
        const publicSetting = parseTabJson("public", jsonText.public);
        if (!publicSetting) {
            message.error(t("admin.settings.messages.invalidPublicJson"));
            return null;
        }
        values.public = publicSetting;
    }
    if (editorMode.private === "json") {
        const privateSetting = parseTabJson("private", jsonText.private);
        if (!privateSetting) {
            message.error(t("admin.settings.messages.invalidPrivateJson"));
            return null;
        }
        values.private = privateSetting;
    }
    values.public.modelChannel.availableModels = collectChannelModels(values.private.channels);
    return normalizeSettings(values);
}

function getJsonError(value: string, t: TFunction) {
    try {
        JSON.parse(value);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : t("admin.settings.messages.invalidJson");
    }
}
