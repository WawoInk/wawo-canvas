"use client";

import { Download, FolderPlus, PencilLine, Plus, Search, Trash2, Upload as UploadIcon } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm, Result, Select, Skeleton, Space, Tag, Typography, Upload, type UploadFile } from "antd";

import { useCopyText } from "@/hooks/use-copy-text";
import { enterpriseCapabilities } from "@/lib/account-access";
import { formatBytes } from "@/lib/image-utils";
import { fetchEnterpriseAccountSummary } from "@/services/api/auth";
import {
    createEnterpriseAsset,
    copyEnterpriseAsset,
    deleteEnterpriseAsset,
    deleteEnterpriseFile,
    downloadEnterpriseFile,
    fetchEnterpriseAssets,
    replaceEnterpriseFile,
    updateEnterpriseAsset,
    uploadEnterpriseFile,
    type EnterpriseAsset,
    type EnterpriseAssetType,
} from "@/services/api/enterprise-assets";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { buildEnterpriseAssetInput, type EnterpriseAssetFormDraft, type EnterpriseAssetMedia } from "./enterprise-asset-form";
import { defaultEnterpriseAssetQuery, enterpriseAssetQueryKey, updateEnterpriseAssetQuery, type EnterpriseAssetQuery } from "./enterprise-asset-query";

type AssetFormValues = EnterpriseAssetFormDraft & { file?: UploadFile[] };

const assetTypeLabels: Record<EnterpriseAssetType, string> = { text: "文本", image: "图片", video: "视频" };

export default function EnterpriseAssetsPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const refreshPersonalAssets = useAssetStore((state) => state.refreshFromServer);
    const capabilities = enterpriseCapabilities(user);
    const [query, setQuery] = useState<EnterpriseAssetQuery>(defaultEnterpriseAssetQuery);
    const [keyword, setKeyword] = useState("");
    const [preview, setPreview] = useState<EnterpriseAsset | null>(null);
    const [editing, setEditing] = useState<EnterpriseAsset | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm<AssetFormValues>();
    const formType = Form.useWatch("type", form) || "text";

    useEffect(() => {
        setQuery(defaultEnterpriseAssetQuery);
        setKeyword("");
        setPreview(null);
        setEditing(null);
        setFormOpen(false);
        form.resetFields();
    }, [form, user?.enterpriseId, user?.id]);

    const summaryQuery = useQuery({
        queryKey: ["enterprise-summary", user?.id || "", user?.enterpriseId || ""],
        queryFn: () => fetchEnterpriseAccountSummary(token),
        enabled: Boolean(token && user?.id),
        retry: false,
    });
    const enterpriseID = summaryQuery.data?.id || "";
    const assetsQuery = useQuery({
        queryKey: enterpriseAssetQueryKey(user?.id || "", enterpriseID, query),
        queryFn: () => fetchEnterpriseAssets(token, query),
        enabled: Boolean(token && user?.id && enterpriseID),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: async ({ asset, values }: { asset: EnterpriseAsset | null; values: AssetFormValues }) => {
            const file = values.file?.[0]?.originFileObj as File | undefined;
            let media = asset && asset.type !== "text" ? enterpriseAssetMedia(asset) : undefined;
            let newFileID = "";
            if (values.type !== "text" && file) {
                const size = await readMediaSize(file, values.type);
                const uploaded = asset?.fileId ? await replaceEnterpriseFile(token, asset.fileId, values.type === "image" ? "images" : "videos", file) : await uploadEnterpriseFile(token, values.type === "image" ? "images" : "videos", file);
                media = { ...uploaded, ...size };
                if (!asset?.fileId) newFileID = uploaded.id;
            }
            const input = buildEnterpriseAssetInput(values, media);
            try {
                return asset ? await updateEnterpriseAsset(token, asset.id, input) : await createEnterpriseAsset(token, input);
            } catch (error) {
                if (newFileID) await deleteEnterpriseFile(token, newFileID).catch(() => undefined);
                throw error;
            }
        },
        onSuccess: async (asset, variables) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            setFormOpen(false);
            setEditing(null);
            form.resetFields();
            if (preview?.id === asset.id) setPreview(asset);
            message.success(variables.asset ? "企业素材已保存" : "企业素材已新增");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: (asset: EnterpriseAsset) => deleteEnterpriseAsset(token, asset.id),
        onSuccess: async (_, asset) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            if (preview?.id === asset.id) setPreview(null);
            message.success("企业素材已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });
    const copyMutation = useMutation({
        mutationFn: (asset: EnterpriseAsset) => copyEnterpriseAsset(token, asset.id),
        onSuccess: async (_, asset) => {
            await refreshPersonalAssets();
            message.success(`“${asset.title}”已加入我的素材`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "加入我的素材失败"),
    });
    const downloadMutation = useMutation({
        mutationFn: async (asset: EnterpriseAsset) => {
            if (!asset.fileId) throw new Error("素材没有可下载的文件");
            saveAs(await downloadEnterpriseFile(token, asset.fileId), assetFileName(asset));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "下载失败"),
    });

    const openForm = (asset?: EnterpriseAsset) => {
        setEditing(asset || null);
        form.resetFields();
        form.setFieldsValue(asset ? { type: asset.type, title: asset.title, tags: asset.tags, description: asset.description, content: asset.content, file: [] } : { type: "text", title: "", tags: [], description: "", content: "", file: [] });
        setFormOpen(true);
    };
    const updateQuery = (patch: Partial<EnterpriseAssetQuery>) => setQuery((current) => updateEnterpriseAssetQuery(current, patch));
    const error = summaryQuery.error || assetsQuery.error;

    if (summaryQuery.isLoading) {
        return (
            <main className="h-full overflow-auto bg-background text-foreground">
                <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
                    <Skeleton active paragraph={{ rows: 8 }} />
                </div>
            </main>
        );
    }
    if (summaryQuery.isError || !capabilities.canAccessAssets) {
        return <Result status="403" title="无权限访问企业素材库" subTitle={error instanceof Error ? error.message : "当前账号不属于有效企业"} />;
    }

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="text-xs text-muted-foreground">{summaryQuery.data?.name}</p>
                        <h1 className="mt-2 text-3xl font-semibold">企业素材库</h1>
                        <p className="mt-2 text-sm text-muted-foreground">企业文本、图片和视频按需从服务端读取，成员可浏览和下载，主账号可维护。</p>
                    </div>
                    {capabilities.canManageAssets ? (
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openForm()}>
                            新增企业素材
                        </Button>
                    ) : (
                        <Tag color="blue">只读成员</Tag>
                    )}
                </header>

                <section className="flex flex-wrap items-center gap-3">
                    <Input.Search
                        className="w-full sm:w-72"
                        prefix={<Search className="size-4 text-muted-foreground" />}
                        placeholder="搜索标题、描述或内容"
                        value={keyword}
                        allowClear
                        enterButton="搜索"
                        onChange={(event) => setKeyword(event.target.value)}
                        onSearch={(value) => updateQuery({ keyword: value.trim() })}
                    />
                    <Select
                        className="w-32"
                        value={query.type || "all"}
                        options={[
                            { label: "全部类型", value: "all" },
                            { label: "文本", value: "text" },
                            { label: "图片", value: "image" },
                            { label: "视频", value: "video" },
                        ]}
                        onChange={(type) => updateQuery({ type: type === "all" ? "" : type, tag: [] })}
                    />
                    <Select
                        className="min-w-48 flex-1 sm:max-w-80"
                        mode="multiple"
                        placeholder="按标签筛选"
                        value={query.tag}
                        options={(assetsQuery.data?.tags || []).map((tag) => ({ label: tag, value: tag }))}
                        allowClear
                        onChange={(tag) => updateQuery({ tag })}
                    />
                </section>

                {assetsQuery.isError ? (
                    <Result status="error" title="企业素材加载失败" subTitle={error instanceof Error ? error.message : "请稍后重试"} extra={<Button onClick={() => assetsQuery.refetch()}>重新加载</Button>} />
                ) : assetsQuery.isLoading ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 6 }, (_, index) => (
                            <Card key={index}>
                                <Skeleton active paragraph={{ rows: 4 }} />
                            </Card>
                        ))}
                    </div>
                ) : assetsQuery.data?.items.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {assetsQuery.data.items.map((asset) => (
                            <Card key={asset.id} className="h-full overflow-hidden" styles={{ body: { height: "100%" } }}>
                                <div className="flex h-full min-h-56 flex-col">
                                    {asset.type === "image" && asset.url ? <img src={asset.url} alt={asset.title} className="mb-4 aspect-video w-full rounded-lg bg-muted object-contain" /> : null}
                                    {asset.type === "video" && asset.url ? <video src={asset.url} className="mb-4 aspect-video w-full rounded-lg bg-muted object-contain" controls preload="metadata" /> : null}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <Typography.Title level={4} className="!mb-1 line-clamp-1">
                                                {asset.title}
                                            </Typography.Title>
                                            <Typography.Text type="secondary" className="text-xs">
                                                由 {asset.creatorName || "企业成员"} 创建
                                            </Typography.Text>
                                        </div>
                                        <Tag className="m-0 shrink-0">{assetTypeLabels[asset.type]}</Tag>
                                    </div>
                                    <Typography.Paragraph type="secondary" className="!my-4 line-clamp-4 whitespace-pre-wrap">
                                        {asset.description || (asset.type === "text" ? asset.content : formatBytes(asset.bytes))}
                                    </Typography.Paragraph>
                                    <div className="mt-auto flex flex-wrap gap-1">
                                        {asset.tags?.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                                        <span>{formatTime(asset.updatedAt)}</span>
                                        <Space size={4}>
                                            <Button type="link" size="small" onClick={() => setPreview(asset)}>
                                                查看
                                            </Button>
                                            <Button type="link" size="small" icon={<FolderPlus className="size-4" />} loading={copyMutation.isPending && copyMutation.variables?.id === asset.id} onClick={() => copyMutation.mutate(asset)}>
                                                加入我的素材
                                            </Button>
                                            {asset.type !== "text" ? (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<Download className="size-4" />}
                                                    loading={downloadMutation.isPending && downloadMutation.variables?.id === asset.id}
                                                    onClick={() => downloadMutation.mutate(asset)}
                                                    aria-label={`下载${asset.title}`}
                                                />
                                            ) : null}
                                            {capabilities.canManageAssets ? (
                                                <>
                                                    <Button type="text" size="small" icon={<PencilLine className="size-4" />} onClick={() => openForm(asset)} aria-label={`编辑${asset.title}`} />
                                                    <Popconfirm title="删除企业素材" description="删除后企业成员将无法继续访问。" okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(asset)}>
                                                        <Button type="text" danger size="small" icon={<Trash2 className="size-4" />} aria-label={`删除${asset.title}`} />
                                                    </Popconfirm>
                                                </>
                                            ) : null}
                                        </Space>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="flex min-h-80 items-center justify-center border-y border-border">
                        <Empty description="暂无企业素材" />
                    </div>
                )}

                {(assetsQuery.data?.total || 0) > 0 ? (
                    <div className="flex justify-center">
                        <Pagination
                            current={query.page}
                            pageSize={query.pageSize}
                            total={assetsQuery.data?.total || 0}
                            showSizeChanger
                            pageSizeOptions={[12, 24, 48]}
                            onChange={(page, pageSize) => updateQuery(pageSize === query.pageSize ? { page } : { pageSize })}
                        />
                    </div>
                ) : null}

                <Modal title={editing ? "编辑企业素材" : "新增企业素材"} open={formOpen} confirmLoading={saveMutation.isPending} okText="保存" cancelText="取消" destroyOnHidden onCancel={() => setFormOpen(false)} onOk={() => form.submit()}>
                    <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate({ asset: editing, values })}>
                        <Form.Item name="type" label="类型" rules={[{ required: true, message: "请选择素材类型" }]}>
                            <Select
                                disabled={Boolean(editing)}
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                ]}
                                onChange={() => form.setFieldValue("file", [])}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: "请输入素材标题" }]}>
                            <Input maxLength={100} showCount />
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车添加标签" />
                        </Form.Item>
                        <Form.Item name="description" label="说明">
                            <Input.TextArea rows={2} maxLength={300} showCount />
                        </Form.Item>
                        {formType === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, whitespace: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={10} />
                            </Form.Item>
                        ) : (
                            <Form.Item
                                name="file"
                                label={editing ? "替换文件" : "媒体文件"}
                                valuePropName="fileList"
                                getValueFromEvent={(event) => (Array.isArray(event) ? event : event?.fileList)}
                                rules={editing ? [] : [{ required: true, message: `请选择${assetTypeLabels[formType]}` }]}
                                extra={editing ? "不选择文件时仅更新素材信息。" : undefined}
                            >
                                <Upload accept={formType === "image" ? "image/*" : "video/*"} beforeUpload={() => false} maxCount={1}>
                                    <Button icon={<UploadIcon className="size-4" />}>{editing ? "选择替换文件" : "选择文件"}</Button>
                                </Upload>
                            </Form.Item>
                        )}
                    </Form>
                </Modal>

                <Modal
                    title={preview?.title || "素材详情"}
                    open={Boolean(preview)}
                    footer={
                        <Space>
                            {preview?.type === "text" ? (
                                <Button type="primary" onClick={() => copyText(preview.content, "素材内容已复制")}>
                                    复制内容
                                </Button>
                            ) : (
                                <Button type="primary" icon={<Download className="size-4" />} loading={downloadMutation.isPending && downloadMutation.variables?.id === preview?.id} onClick={() => preview && downloadMutation.mutate(preview)}>
                                    下载文件
                                </Button>
                            )}
                            <Button icon={<FolderPlus className="size-4" />} loading={copyMutation.isPending && copyMutation.variables?.id === preview?.id} onClick={() => preview && copyMutation.mutate(preview)}>
                                加入我的素材
                            </Button>
                        </Space>
                    }
                    destroyOnHidden
                    onCancel={() => setPreview(null)}
                >
                    {preview ? (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-1">
                                {preview.tags?.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                            {preview.description ? <Typography.Paragraph type="secondary">{preview.description}</Typography.Paragraph> : null}
                            {preview.type === "text" ? <Typography.Paragraph className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-4">{preview.content}</Typography.Paragraph> : null}
                            {preview.type === "image" && preview.url ? <img src={preview.url} alt={preview.title} className="max-h-[55vh] w-full rounded-lg bg-muted object-contain" /> : null}
                            {preview.type === "video" && preview.url ? <video src={preview.url} className="max-h-[55vh] w-full rounded-lg bg-muted" controls autoPlay /> : null}
                            {preview.type !== "text" ? (
                                <Typography.Text type="secondary">{[preview.width && preview.height ? `${preview.width} × ${preview.height}` : "", formatBytes(preview.bytes), preview.mimeType].filter(Boolean).join(" · ")}</Typography.Text>
                            ) : null}
                            <Typography.Text type="secondary" className="block text-xs">
                                创建者：{preview.creatorName || "企业成员"} · 更新于 {formatTime(preview.updatedAt)}
                            </Typography.Text>
                        </div>
                    ) : null}
                </Modal>
            </div>
        </main>
    );
}

function enterpriseAssetMedia(asset: EnterpriseAsset): EnterpriseAssetMedia {
    return { id: asset.fileId, width: asset.width, height: asset.height, bytes: asset.bytes, mimeType: asset.mimeType };
}

async function readMediaSize(file: File, type: Exclude<EnterpriseAssetType, "text">) {
    if (type === "image") {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    }
    const url = URL.createObjectURL(file);
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const video = document.createElement("video");
        const done = (error?: Error) => {
            URL.revokeObjectURL(url);
            error ? reject(error) : resolve({ width: video.videoWidth, height: video.videoHeight });
        };
        video.onloadedmetadata = () => done();
        video.onerror = () => done(new Error("无法读取视频信息"));
        video.preload = "metadata";
        video.src = url;
    });
}

function assetFileName(asset: EnterpriseAsset) {
    const extension = asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType.split("/")[1]?.split("+")[0] || (asset.type === "image" ? "png" : "mp4");
    return asset.title.toLowerCase().endsWith(`.${extension}`) ? asset.title : `${asset.title}.${extension}`;
}

function formatTime(value: string) {
    return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
}
