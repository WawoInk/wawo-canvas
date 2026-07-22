"use client";

import { PencilLine, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Empty, Form, Input, Modal, Pagination, Popconfirm, Result, Select, Skeleton, Space, Tag, Typography } from "antd";

import { useCopyText } from "@/hooks/use-copy-text";
import { enterpriseCapabilities } from "@/lib/account-access";
import { fetchEnterpriseAccountSummary } from "@/services/api/auth";
import { createEnterpriseAsset, deleteEnterpriseAsset, fetchEnterpriseAssets, updateEnterpriseAsset, type EnterpriseAsset, type EnterpriseAssetInput } from "@/services/api/enterprise-assets";
import { useUserStore } from "@/stores/use-user-store";
import { defaultEnterpriseAssetQuery, enterpriseAssetQueryKey, updateEnterpriseAssetQuery, type EnterpriseAssetQuery } from "./enterprise-asset-query";

type AssetFormValues = Omit<EnterpriseAssetInput, "type">;

export default function EnterpriseAssetsPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const capabilities = enterpriseCapabilities(user);
    const [query, setQuery] = useState<EnterpriseAssetQuery>(defaultEnterpriseAssetQuery);
    const [keyword, setKeyword] = useState("");
    const [preview, setPreview] = useState<EnterpriseAsset | null>(null);
    const [editing, setEditing] = useState<EnterpriseAsset | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form] = Form.useForm<AssetFormValues>();

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
        mutationFn: ({ id, values }: { id?: string; values: AssetFormValues }) => {
            const input: EnterpriseAssetInput = { ...values, tags: values.tags || [], type: "text" };
            return id ? updateEnterpriseAsset(token, id, input) : createEnterpriseAsset(token, input);
        },
        onSuccess: async (asset, variables) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            setFormOpen(false);
            setEditing(null);
            if (preview?.id === asset.id) setPreview(asset);
            message.success(variables.id ? "企业素材已保存" : "企业素材已新增");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteEnterpriseAsset(token, id),
        onSuccess: async (_, id) => {
            await queryClient.invalidateQueries({ queryKey: ["enterprise-assets", user?.id || "", enterpriseID] });
            if (preview?.id === id) setPreview(null);
            message.success("企业素材已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });

    const openForm = (asset?: EnterpriseAsset) => {
        setEditing(asset || null);
        form.resetFields();
        form.setFieldsValue(asset ? { title: asset.title, tags: asset.tags, description: asset.description, content: asset.content } : { title: "", tags: [], description: "", content: "" });
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
                        <p className="mt-2 text-sm text-muted-foreground">企业文本素材按需从服务端读取，成员可浏览和复制，主账号可维护。</p>
                    </div>
                    {capabilities.canManageAssets ? (
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openForm()}>
                            新增文本素材
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
                            <Card key={asset.id} className="h-full">
                                <div className="flex h-full min-h-48 flex-col">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <Typography.Title level={4} className="!mb-1 line-clamp-1">
                                                {asset.title}
                                            </Typography.Title>
                                            <Typography.Text type="secondary" className="text-xs">
                                                由 {asset.creatorName || "企业成员"} 创建
                                            </Typography.Text>
                                        </div>
                                        <Tag className="m-0 shrink-0">文本</Tag>
                                    </div>
                                    <Typography.Paragraph type="secondary" className="!my-4 line-clamp-4 whitespace-pre-wrap">
                                        {asset.description || asset.content}
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
                                            {capabilities.canManageAssets ? (
                                                <>
                                                    <Button type="text" size="small" icon={<PencilLine className="size-4" />} onClick={() => openForm(asset)} aria-label={`编辑${asset.title}`} />
                                                    <Popconfirm title="删除企业素材" description="删除后企业成员将无法继续访问。" okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(asset.id)}>
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
                        <Empty description="暂无企业文本素材" />
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

                <Modal title={editing ? "编辑企业文本素材" : "新增企业文本素材"} open={formOpen} confirmLoading={saveMutation.isPending} okText="保存" cancelText="取消" destroyOnHidden onCancel={() => setFormOpen(false)} onOk={() => form.submit()}>
                    <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate({ id: editing?.id, values })}>
                        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: "请输入素材标题" }]}>
                            <Input maxLength={100} showCount />
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车添加标签" />
                        </Form.Item>
                        <Form.Item name="description" label="说明">
                            <Input.TextArea rows={2} maxLength={300} showCount />
                        </Form.Item>
                        <Form.Item name="content" label="文本内容" rules={[{ required: true, whitespace: true, message: "请输入文本内容" }]}>
                            <Input.TextArea rows={10} />
                        </Form.Item>
                    </Form>
                </Modal>

                <Modal
                    title={preview?.title || "素材详情"}
                    open={Boolean(preview)}
                    footer={
                        <Button type="primary" onClick={() => preview && copyText(preview.content, "素材内容已复制")}>
                            复制内容
                        </Button>
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
                            <Typography.Paragraph className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-4">{preview.content}</Typography.Paragraph>
                            <Typography.Text type="secondary" className="text-xs">
                                创建者：{preview.creatorName || "企业成员"} · 更新于 {formatTime(preview.updatedAt)}
                            </Typography.Text>
                        </div>
                    ) : null}
                </Modal>
            </div>
        </main>
    );
}

function formatTime(value: string) {
    return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
}
