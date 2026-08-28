"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ChevronRight,
    Download,
    FileJson,
    FileText,
    History,
    LoaderCircle,
    Plus,
    Sparkles,
    Trash2,
    Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, App, Button, Collapse, Drawer, Empty, Input, InputNumber, Popconfirm, Progress, Select, Switch, Table, Tabs, Tag } from "antd";
import type { TableProps } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { generateStoryboard } from "@/services/api/storyboard";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { deleteStoryboardRecord, listStoryboardRecords, saveStoryboardRecord } from "./storyboard-storage";
import {
    defaultStoryboardOptions,
    storyboardToMarkdown,
    type StoryboardAspectRatio,
    type StoryboardRecord,
    type StoryboardScene,
    type StoryboardShot,
    type StoryboardStage,
} from "./storyboard";

export type StoryboardStudioProps = {
    activeTab: "image" | "storyboard";
    onTabChange: (tab: "image" | "storyboard") => void;
};

type ShotRow = StoryboardShot & {
    key: string;
    sceneNo: number;
    segmentNo: number;
};

const stageProgress: Record<StoryboardStage, number> = {
    planning: 25,
    generating: 65,
    validating: 90,
};

const aspectRatios: StoryboardAspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export function StoryboardStudio({ activeTab, onTabChange }: StoryboardStudioProps) {
    const { t, i18n } = useTranslation();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const controllerRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [title, setTitle] = useState("");
    const [source, setSource] = useState("");
    const [options, setOptions] = useState({ ...defaultStoryboardOptions });
    const [records, setRecords] = useState<StoryboardRecord[]>([]);
    const [record, setRecord] = useState<StoryboardRecord | null>(null);
    const [stage, setStage] = useState<StoryboardStage | null>(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const [historyOpen, setHistoryOpen] = useState(false);
    const text = (key: string, fallback: string) => t(`storyboardStudio.${key}`, { defaultValue: fallback });
    const model = effectiveConfig.textModel || effectiveConfig.model;
    const canGenerate = Boolean(title.trim() && source.trim() && model);

    useEffect(() => {
        let active = true;
        void listStoryboardRecords()
            .then((items) => {
                if (!active) return;
                setRecords(items);
                if (items[0]) selectRecord(items[0]);
            })
            .catch(() => message.error(text("messages.historyLoadFailed", "历史记录加载失败")));
        return () => {
            active = false;
            controllerRef.current?.abort();
        };
    }, []);

    const sceneRows = record?.document.scenes || [];
    const shotRows = useMemo<ShotRow[]>(
        () =>
            (record?.document.scenes || []).flatMap((scene) =>
                scene.segments.flatMap((segment) =>
                    segment.shots.map((shot) => ({
                        ...shot,
                        key: `${scene.sceneNo}-${segment.segmentNo}-${shot.shotNo}`,
                        sceneNo: scene.sceneNo,
                        segmentNo: segment.segmentNo,
                    })),
                ),
            ),
        [record],
    );

    function selectRecord(next: StoryboardRecord) {
        setRecord(next);
        setTitle(next.title);
        setSource(next.source);
        setOptions(next.options);
        updateConfig("textModel", next.model);
        setError("");
        setHistoryOpen(false);
    }

    function resetStudio() {
        setRecord(null);
        setTitle("");
        setSource("");
        setOptions({ ...defaultStoryboardOptions });
        setError("");
        setStage(null);
        setHistoryOpen(false);
    }

    async function readSourceFile(file?: File) {
        if (!file) return;
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
            message.warning(text("messages.unsupportedFile", "仅支持 TXT 或 Markdown 文件"));
            return;
        }
        try {
            const content = await file.text();
            setSource(content);
            setTitle((value) => value.trim() || file.name.replace(/\.(txt|md|markdown)$/i, ""));
            message.success(text("messages.fileLoaded", "剧本文件已读取"));
        } catch {
            message.error(text("messages.fileReadFailed", "剧本文件读取失败"));
        }
    }

    async function runGeneration() {
        if (!title.trim()) {
            message.warning(text("messages.titleRequired", "请输入作品标题"));
            return;
        }
        if (!source.trim()) {
            message.warning(text("messages.sourceRequired", "请粘贴或上传剧本"));
            return;
        }
        const requestConfig = { ...effectiveConfig, model, textModel: model };
        if (!model || !isAiConfigReady(requestConfig, model)) {
            message.warning(text("messages.configRequired", "请先配置可用的文本模型"));
            openConfigDialog(false);
            return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        setRunning(true);
        setStage("planning");
        setError("");
        try {
            const input = { title: title.trim(), source: source.trim(), options };
            const result = await generateStoryboard(requestConfig, input, {
                signal: controller.signal,
                onStage: setStage,
            });
            const now = Date.now();
            const nextRecord: StoryboardRecord = {
                ...input,
                ...result,
                id: crypto.randomUUID(),
                model,
                createdAt: now,
                updatedAt: now,
            };
            setRecord(nextRecord);
            setRecords((items) => [nextRecord, ...items]);
            try {
                await saveStoryboardRecord(nextRecord);
            } catch {
                message.warning(text("messages.historySaveFailed", "分镜已生成，但保存历史记录失败"));
            }
            message.success(text("messages.generated", "分镜文档生成完成"));
        } catch (generationError) {
            if (controller.signal.aborted) {
                message.info(text("messages.cancelled", "已取消生成"));
            } else {
                const reason = generationError instanceof Error ? generationError.message : text("messages.generateFailed", "分镜生成失败");
                setError(reason);
                message.error(reason);
            }
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            setRunning(false);
            setStage(null);
        }
    }

    function cancelGeneration() {
        controllerRef.current?.abort();
    }

    async function removeRecord(id: string) {
        try {
            await deleteStoryboardRecord(id);
            const remaining = records.filter((item) => item.id !== id);
            setRecords(remaining);
            if (record?.id === id) {
                if (remaining[0]) selectRecord(remaining[0]);
                else resetStudio();
            }
        } catch {
            message.error(text("messages.historyDeleteFailed", "历史记录删除失败"));
        }
    }

    function exportRecord(format: "json" | "markdown") {
        if (!record) return;
        const extension = format === "json" ? "json" : "md";
        const content = format === "json" ? JSON.stringify(record.document, null, 2) : storyboardToMarkdown(record.document);
        const blob = new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${safeFilename(record.title)}-storyboard.${extension}`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    const historyContent = (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <History className="size-4 text-muted-foreground" />
                    <h2 className="font-semibold">{text("history.title", "历史记录")}</h2>
                    <Tag className="m-0">{records.length}</Tag>
                </div>
                <Button type="text" size="small" icon={<Plus className="size-4" />} onClick={resetStudio}>
                    {text("history.new", "新建")}
                </Button>
            </div>
            {records.length ? (
                <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {records.map((item) => (
                        <div
                            key={item.id}
                            className={`group flex w-full items-start gap-1 rounded-lg border p-1 transition-colors ${record?.id === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                        >
                            <button type="button" className="min-w-0 flex-1 p-2 text-left" onClick={() => selectRecord(item)}>
                                <div className="truncate text-sm font-medium">{item.title}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {formatTimestamp(item.updatedAt, i18n.language)} · {item.document.scenes.length} {text("units.scenes", "场")}
                                </div>
                            </button>
                            <Popconfirm
                                title={text("history.deleteTitle", "删除这条分镜记录？")}
                                okText={text("actions.delete", "删除")}
                                cancelText={text("actions.cancel", "取消")}
                                onConfirm={() => void removeRecord(item.id)}
                            >
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={text("actions.delete", "删除")}
                                    className="mt-1 shrink-0 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100"
                                    icon={<Trash2 className="size-3.5" />}
                                />
                            </Popconfirm>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text("history.empty", "还没有分镜记录")} />
            )}
        </div>
    );

    const sceneColumns: TableProps<StoryboardScene>["columns"] = [
        { title: text("table.scene", "场次"), dataIndex: "sceneNo", width: 70, render: (value: number) => `S${value}` },
        {
            title: text("table.locationTime", "场景 / 时间"),
            width: 180,
            render: (_, item) => (
                <div>
                    <div>{item.location}</div>
                    <div className="text-xs text-muted-foreground">{item.time}</div>
                </div>
            ),
        },
        { title: text("table.characters", "角色"), dataIndex: "characters", width: 160, render: (value: string[]) => value.join("、") || "-" },
        { title: text("table.emotion", "情绪"), dataIndex: "emotion", width: 120 },
        {
            title: text("table.segmentsDuration", "片段 / 时长"),
            width: 130,
            render: (_, item) => `${item.segments.length} / ${sumSceneDuration(item)}s`,
        },
        {
            title: text("table.assets", "资产 ID"),
            width: 120,
            render: (_, item) => Array.from(new Set(item.segments.flatMap((segment) => segment.assetIds))).join("、") || "-",
        },
        { title: text("table.sourceRefs", "原文引用"), dataIndex: "sourceRefs", render: (value: string[]) => value.join("、") || "-" },
    ];

    const shotColumns: TableProps<ShotRow>["columns"] = [
        { title: text("table.scene", "场次"), dataIndex: "sceneNo", width: 70, fixed: "left", render: (value: number) => `S${value}` },
        { title: text("table.segment", "片段"), dataIndex: "segmentNo", width: 70, render: (value: number) => `P${value}` },
        { title: text("table.shot", "镜头"), dataIndex: "shotNo", width: 70, render: (value: number) => `#${value}` },
        { title: text("table.visual", "画面描述"), dataIndex: "visual", width: 300 },
        { title: text("table.duration", "时长"), dataIndex: "durationSec", width: 80, render: (value: number) => `${value}s` },
        { title: text("table.framing", "景别"), dataIndex: "framing", width: 100 },
        { title: text("table.camera", "运镜"), dataIndex: "camera", width: 140 },
        { title: text("table.dialogue", "台词 / 旁白"), dataIndex: "dialogue", width: 240, render: (value: string) => value || "-" },
        { title: text("table.sound", "声音"), dataIndex: "sound", width: 180, render: (value: string) => value || "-" },
        { title: text("table.sourceRefs", "原文引用"), dataIndex: "sourceRefs", width: 180, render: (value: string[]) => value.join("、") || "-" },
    ];

    return (
        <>
            <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border bg-card p-4 shadow-sm lg:block">{historyContent}</aside>

            <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                <div className="thin-scrollbar flex flex-col rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto">
                    <Tabs
                        activeKey={activeTab}
                        items={[
                            { key: "image", label: text("tabs.image", "图片生成") },
                            { key: "storyboard", label: text("tabs.storyboard", "分镜创作室") },
                        ]}
                        onChange={(key) => {
                            if (key === "image" || key === "storyboard") onTabChange(key);
                        }}
                    />

                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-semibold">{text("title", "分镜创作室")}</h1>
                            <p className="mt-1 text-sm text-muted-foreground">{text("description", "将剧本转成可校验、可导出的结构化分镜文档")}</p>
                        </div>
                        <Button className="lg:hidden" icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)}>
                            {text("history.title", "历史记录")}
                        </Button>
                    </div>

                    <div className="mt-6 space-y-5">
                        <label className="block">
                            <span className="mb-2 block text-base font-semibold">{text("input.title", "作品标题")}</span>
                            <Input value={title} maxLength={100} placeholder={text("input.titlePlaceholder", "例如：雨夜来客") } onChange={(event) => setTitle(event.target.value)} />
                        </label>

                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-base font-semibold">{text("input.source", "剧本内容")}</span>
                                <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                    {text("input.upload", "上传 TXT / MD")}
                                </Button>
                            </div>
                            <Input.TextArea
                                value={source}
                                rows={10}
                                showCount
                                placeholder={text("input.placeholder", "粘贴完整剧本，保留场头、人物和台词结构…")}
                                onChange={(event) => setSource(event.target.value)}
                            />
                        </div>

                        <div>
                            <h2 className="mb-3 text-base font-semibold">{text("options.title", "生成参数")}</h2>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="col-span-2 block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.model", "文本模型")}</span>
                                    <ModelPicker
                                        config={effectiveConfig}
                                        value={model}
                                        capability="text"
                                        fullWidth
                                        onChange={(value) => updateConfig("textModel", value)}
                                        onMissingConfig={() => openConfigDialog(false)}
                                        disabled={running}
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.aspectRatio", "画幅")}</span>
                                    <Select
                                        className="w-full"
                                        value={options.aspectRatio}
                                        disabled={running}
                                        options={aspectRatios.map((value) => ({ value, label: value }))}
                                        onChange={(aspectRatio) => setOptions((value) => ({ ...value, aspectRatio }))}
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.targetDuration", "目标时长（秒）")}</span>
                                    <InputNumber
                                        className="w-full"
                                        min={1}
                                        max={3600}
                                        value={options.targetDurationSec}
                                        disabled={running}
                                        onChange={(targetDurationSec) => setOptions((value) => ({ ...value, targetDurationSec: targetDurationSec || 1 }))}
                                    />
                                </label>
                                <label className="col-span-2 block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.style", "视觉风格")}</span>
                                    <Input value={options.style} disabled={running} onChange={(event) => setOptions((value) => ({ ...value, style: event.target.value }))} />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.maxSegmentDuration", "片段最长（秒）")}</span>
                                    <InputNumber
                                        className="w-full"
                                        min={1}
                                        max={120}
                                        value={options.maxSegmentDurationSec}
                                        disabled={running}
                                        onChange={(maxSegmentDurationSec) => setOptions((value) => ({ ...value, maxSegmentDurationSec: maxSegmentDurationSec || 1 }))}
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm text-muted-foreground">{text("options.maxShotDuration", "镜头最长（秒）")}</span>
                                    <InputNumber
                                        className="w-full"
                                        min={1}
                                        max={60}
                                        value={options.maxShotDurationSec}
                                        disabled={running}
                                        onChange={(maxShotDurationSec) => setOptions((value) => ({ ...value, maxShotDurationSec: maxShotDurationSec || 1 }))}
                                    />
                                </label>
                                <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-3 rounded-lg border px-3 py-2.5">
                                    <label className="flex items-center gap-2 text-sm">
                                        <Switch
                                            size="small"
                                            checked={options.dialogueMustBeExact}
                                            disabled={running}
                                            onChange={(dialogueMustBeExact) => setOptions((value) => ({ ...value, dialogueMustBeExact }))}
                                        />
                                        {text("options.dialogueExact", "台词必须忠于原文")}
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <Switch size="small" checked={options.allowMusic} disabled={running} onChange={(allowMusic) => setOptions((value) => ({ ...value, allowMusic }))} />
                                        {text("options.allowMusic", "允许添加音乐")}
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {running && stage ? (
                        <div className="mt-5 rounded-lg border bg-muted/30 p-3">
                            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                                <span className="flex items-center gap-2 font-medium">
                                    <LoaderCircle className="size-4 animate-spin" />
                                    {stageLabel(stage, text)}
                                </span>
                                <span className="text-muted-foreground">{stageProgress[stage]}%</span>
                            </div>
                            <Progress percent={stageProgress[stage]} showInfo={false} size="small" />
                        </div>
                    ) : null}

                    <div className="mt-auto pt-6">
                        <Button
                            type={running ? "default" : "primary"}
                            danger={running}
                            size="large"
                            block
                            icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                            disabled={!canGenerate && !running}
                            onClick={() => (running ? cancelGeneration() : void runGeneration())}
                        >
                            {running ? text("actions.cancel", "取消生成") : text("actions.generate", "生成分镜")}
                        </Button>
                    </div>
                </div>

                <div className="thin-scrollbar rounded-lg border bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-semibold">{text("output.title", "分镜文档")}</h2>
                            {record ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {record.document.scenes.length} {text("units.scenes", "场")} · {shotRows.length} {text("units.shots", "镜头")} · {record.document.targetDurationSec}s
                                </p>
                            ) : null}
                        </div>
                        {record ? (
                            <div className="flex gap-2">
                                <Button size="small" icon={<FileJson className="size-3.5" />} onClick={() => exportRecord("json")}>
                                    JSON
                                </Button>
                                <Button size="small" icon={<Download className="size-3.5" />} onClick={() => exportRecord("markdown")}>
                                    Markdown
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    {error ? <Alert className="mb-4" type="error" showIcon message={text("messages.generateFailed", "分镜生成失败")} description={error} closable onClose={() => setError("")} /> : null}

                    {record ? (
                        <div className="space-y-5">
                            <Collapse
                                items={[
                                    {
                                        key: "director-plan",
                                        label: (
                                            <span className="flex items-center gap-2 font-medium">
                                                <FileText className="size-4" />
                                                {text("directorPlan.title", "导演规划")}
                                                <Tag className="m-0">{record.directorPlan.scenes.length}</Tag>
                                            </span>
                                        ),
                                        children: (
                                            <div className="space-y-3">
                                                {record.directorPlan.scenes.map((scene) => (
                                                    <div key={scene.sceneNo} className="rounded-lg border p-3">
                                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                                            <Tag color="blue">S{scene.sceneNo}</Tag>
                                                            <span className="font-medium">{scene.location}</span>
                                                            <span className="text-sm text-muted-foreground">{scene.time}</span>
                                                            <span className="ml-auto text-xs text-muted-foreground">{scene.estimatedDurationSec}s</span>
                                                        </div>
                                                        <p className="text-sm leading-6">{scene.summary}</p>
                                                        <div className="mt-2 text-xs text-muted-foreground">{scene.characters.join("、")} · {scene.emotion}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ),
                                    },
                                ]}
                            />

                            <section>
                                <div className="mb-3 flex items-center gap-2">
                                    <ChevronRight className="size-4 text-muted-foreground" />
                                    <h3 className="font-semibold">{text("scenes.title", "场次表")}</h3>
                                </div>
                                <Table rowKey="sceneNo" size="small" pagination={false} columns={sceneColumns} dataSource={sceneRows} scroll={{ x: 900 }} />
                            </section>

                            <section>
                                <div className="mb-3 flex items-center gap-2">
                                    <ChevronRight className="size-4 text-muted-foreground" />
                                    <h3 className="font-semibold">{text("shots.title", "镜头表")}</h3>
                                </div>
                                <Table rowKey="key" size="small" pagination={false} columns={shotColumns} dataSource={shotRows} scroll={{ x: 1500 }} />
                            </section>

                            <ValidationPanel record={record} text={text} />
                        </div>
                    ) : (
                        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-center lg:min-h-[560px]">
                            <FileText className="mb-4 size-11 text-muted-foreground" />
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text("output.empty", "输入剧本并生成后，导演规划、场次和镜头会显示在这里")} />
                        </div>
                    )}
                </div>
            </section>

            <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="hidden"
                onChange={(event) => {
                    void readSourceFile(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
            <Drawer title={text("history.title", "历史记录")} placement="bottom" size="large" open={historyOpen} onClose={() => setHistoryOpen(false)}>
                {historyContent}
            </Drawer>
        </>
    );
}

function ValidationPanel({ record, text }: { record: StoryboardRecord; text: (key: string, fallback: string) => string }) {
    const { validation } = record;
    const passed = validation.status === "passed";
    const issues = [...validation.errors.map((item) => ({ ...item, severity: "error" as const })), ...validation.warnings.map((item) => ({ ...item, severity: "warning" as const }))];

    return (
        <section className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    {passed ? <CheckCircle2 className="size-5 text-muted-foreground" /> : <AlertCircle className="size-5 text-muted-foreground" />}
                    <h3 className="font-semibold">{text("validation.title", "校验报告")}</h3>
                </div>
                <Tag color={validation.status === "passed" ? "success" : validation.status === "failed" ? "error" : "warning"}>
                    {text(`validation.${validation.status}`, validation.status === "passed" ? "通过" : validation.status === "failed" ? "失败" : "有警告")}
                </Tag>
            </div>
            {issues.length ? (
                <div className="space-y-2">
                    {issues.map((item, index) => (
                        <Alert key={`${item.code}-${item.path}-${index}`} type={item.severity} showIcon message={item.message} description={`${item.code} · ${item.path}`} />
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">{text("validation.empty", "时长、编号、来源引用和台词校验均已通过")}</p>
            )}
        </section>
    );
}

function stageLabel(stage: StoryboardStage, text: (key: string, fallback: string) => string) {
    if (stage === "planning") return text("progress.planning", "正在生成导演规划");
    if (stage === "generating") return text("progress.generating", "正在生成镜头级分镜");
    return text("progress.validating", "正在校验分镜文档");
}

function sumSceneDuration(scene: StoryboardScene) {
    return scene.segments.reduce((total, segment) => total + segment.durationSec, 0);
}

function safeFilename(value: string) {
    return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "storyboard";
}

function formatTimestamp(value: number, locale: string) {
    return new Intl.DateTimeFormat(locale || "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}
