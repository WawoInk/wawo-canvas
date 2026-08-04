"use client";

import { CopyOutlined, DeleteOutlined, EditOutlined, ExportOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, Flex, Form, Image, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatNumber } from "@/i18n/formatters";
import type { Prompt } from "@/services/api/prompts";
import { useAdminPrompts } from "./use-admin-prompts";

export default function AdminPromptsPage() {
    const { t } = useTranslation();
    const {
        categories,
        prompts,
        tags,
        keyword,
        category,
        tag,
        page,
        pageSize,
        total,
        isLoading,
        isSyncing,
        searchPrompts,
        changeCategory,
        changeTag,
        changePage,
        changePageSize,
        resetFilters,
        refreshPrompts,
        syncCategory,
        savePrompt: saveAdminPrompt,
        deletePrompt,
        deletePrompts,
    } = useAdminPrompts();
    const copyText = useCopyText();
    const [form] = Form.useForm<Partial<Prompt> & { tagText?: string }>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingPrompt, setEditingPrompt] = useState<Partial<Prompt> | null>(null);
    const [detailPrompt, setDetailPrompt] = useState<Prompt | null>(null);
    const [deletingPrompt, setDeletingPrompt] = useState<Prompt | null>(null);
    const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
    const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
    const [isSyncOpen, setIsSyncOpen] = useState(false);
    const defaultCategory = categories[0]?.category || "";
    const categoryName = (category: string) => categories.find((item) => item.category === category)?.name || category;
    const categoryOptions = [{ label: t("admin.prompts.filters.allCategories"), value: "" }, ...categories.map((item) => ({ label: item.name, value: item.category }))];
    const tagOptions = tags.map((item) => ({ label: item, value: item }));

    useEffect(() => {
        if (editingPrompt) form.setFieldsValue({ ...editingPrompt, tagText: editingPrompt.tags?.join(", ") || "" });
    }, [editingPrompt, form]);

    useEffect(() => setKeywordText(keyword), [keyword]);

    const savePrompt = async () => {
        const value = await form.validateFields();
        await saveAdminPrompt({
            ...editingPrompt,
            ...value,
            category: value.category || defaultCategory,
            tags: (value.tagText || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
        setEditingPrompt(null);
    };

    const batchDeletePrompts = async () => {
        await deletePrompts(selectedPromptIds);
        setSelectedPromptIds([]);
        setIsBatchDeleteOpen(false);
    };

    const columns: ProColumns<Prompt>[] = [
        {
            title: t("admin.prompts.table.cover"),
            dataIndex: "coverUrl",
            width: 88,
            render: (_, item) => (
                <Image src={item.coverUrl || "/logo-white-mode.svg"} alt={item.title} width={56} height={42} style={{ objectFit: "cover", borderRadius: 6 }} preview={{ mask: t("admin.common.actions.enlarge") }} fallback="/logo-white-mode.svg" />
            ),
        },
        {
            title: t("admin.prompts.table.title"),
            dataIndex: "title",
            width: 260,
            render: (_, item) => (
                <Typography.Link strong ellipsis style={{ maxWidth: 260, display: "block" }} onClick={() => setDetailPrompt(item)}>
                    {item.title}
                </Typography.Link>
            ),
        },
        {
            title: t("admin.prompts.table.category"),
            dataIndex: "category",
            width: 150,
            render: (_, item) => <Typography.Text type="secondary">{categoryName(item.category)}</Typography.Text>,
        },
        {
            title: t("admin.prompts.table.tags"),
            dataIndex: "tags",
            width: 180,
            render: (_, item) => (
                <Space size={[4, 4]} wrap>
                    {(item.tags || []).slice(0, 3).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                    ))}
                </Space>
            ),
        },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 112,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title={t("admin.common.actions.details")}>
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailPrompt(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.edit")}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingPrompt(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.delete")}>
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingPrompt(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="360px">
                                <Form.Item label={t("admin.common.filters.keyword")}>
                                    <Input.Search
                                        value={keywordText}
                                        placeholder={t("admin.prompts.filters.searchPlaceholder")}
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchPrompts(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label={t("admin.prompts.filters.group")}>
                                    <Select value={category} onChange={changeCategory} options={categoryOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label={t("admin.prompts.filters.tags")}>
                                    <Select mode="multiple" allowClear maxTagCount="responsive" value={tag} onChange={changeTag} options={tagOptions} placeholder={t("admin.prompts.filters.allTags")} />
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setKeywordText("");
                                                resetFilters();
                                            }}
                                        >
                                            {t("admin.common.actions.reset")}
                                        </Button>
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchPrompts(keywordText)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<Prompt>
                    rowKey="id"
                    columns={columns}
                    dataSource={prompts}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.prompts.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.records", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshPrompts() }}
                    rowSelection={{ selectedRowKeys: selectedPromptIds, onChange: (keys) => setSelectedPromptIds(keys.map(String)) }}
                    toolBarRender={() => [
                        <Button key="batch-delete" danger icon={<DeleteOutlined />} disabled={!selectedPromptIds.length} onClick={() => setIsBatchDeleteOpen(true)}>
                            {t("admin.prompts.actions.batchDelete", { count: selectedPromptIds.length, value: selectedPromptIds.length ? formatNumber(selectedPromptIds.length) : "" })}
                        </Button>,
                        <Button key="sync" icon={<SyncOutlined />} onClick={() => setIsSyncOpen(true)}>
                            {t("admin.common.actions.sync")}
                        </Button>,
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingPrompt({ category: defaultCategory, tags: [] })}>
                            {t("admin.common.actions.add")}
                        </Button>,
                    ]}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => t("admin.common.pagination.records", { count: value, value: formatNumber(value) }),
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Flex>

            <Modal
                title={t(editingPrompt?.id ? "admin.prompts.modal.editTitle" : "admin.prompts.modal.createTitle")}
                open={Boolean(editingPrompt)}
                width={720}
                onCancel={() => setEditingPrompt(null)}
                onOk={() => void savePrompt()}
                okText={t("admin.common.actions.save")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="title" label={t("admin.prompts.form.title")} rules={[{ required: true, message: t("admin.prompts.validation.titleRequired") }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="category" label={t("admin.prompts.form.category")}>
                        <Select options={categories.map((item) => ({ label: item.name, value: item.category }))} />
                    </Form.Item>
                    <Form.Item name="coverUrl" label={t("admin.prompts.form.coverUrl")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="tagText" label={t("admin.prompts.form.tags")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="prompt" label={t("admin.prompts.form.prompt")} rules={[{ required: true, message: t("admin.prompts.validation.promptRequired") }]}>
                        <Input.TextArea rows={6} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal title={t("admin.prompts.detail.title")} open={Boolean(detailPrompt)} width={760} onCancel={() => setDetailPrompt(null)} footer={<Button onClick={() => setDetailPrompt(null)}>{t("admin.common.actions.close")}</Button>}>
                {detailPrompt ? (
                    <Flex vertical gap={14}>
                        <Flex gap={14} align="start">
                            <Image
                                src={detailPrompt.coverUrl || "/logo-white-mode.svg"}
                                alt={detailPrompt.title}
                                width={116}
                                height={84}
                                style={{ objectFit: "cover", borderRadius: 8 }}
                                preview={{ mask: t("admin.common.actions.enlarge") }}
                                fallback="/logo-white-mode.svg"
                            />
                            <Flex vertical gap={8} style={{ minWidth: 0 }}>
                                <Typography.Title level={5} style={{ margin: 0 }}>
                                    {detailPrompt.title}
                                </Typography.Title>
                                <Space wrap>
                                    <Tag>{categoryName(detailPrompt.category)}</Tag>
                                    {(detailPrompt.tags || []).map((tag) => (
                                        <Tag key={tag}>{tag}</Tag>
                                    ))}
                                </Space>
                            </Flex>
                        </Flex>
                        {detailPrompt.preview ? (
                            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                                {detailPrompt.preview}
                            </Typography.Paragraph>
                        ) : null}
                        <Input.TextArea value={detailPrompt.prompt} rows={8} readOnly />
                        <Space>
                            <Button icon={<CopyOutlined />} onClick={() => copyText(detailPrompt.prompt)}>
                                {t("admin.prompts.actions.copyPrompt")}
                            </Button>
                            {detailPrompt.githubUrl ? (
                                <Button icon={<ExportOutlined />} href={detailPrompt.githubUrl} target="_blank">
                                    {t("admin.prompts.actions.remoteSource")}
                                </Button>
                            ) : null}
                        </Space>
                    </Flex>
                ) : null}
            </Modal>

            <Modal
                title={t("admin.prompts.sync.title")}
                open={isSyncOpen}
                width={640}
                onCancel={() => !isSyncing && setIsSyncOpen(false)}
                mask={{ closable: !isSyncing }}
                footer={
                    <Button disabled={isSyncing} onClick={() => setIsSyncOpen(false)}>
                        {t("admin.common.actions.cancel")}
                    </Button>
                }
            >
                <Table
                    rowKey="category"
                    dataSource={categories.filter((item) => item.remote)}
                    pagination={false}
                    columns={[
                        {
                            title: t("admin.prompts.sync.remoteSource"),
                            dataIndex: "name",
                            render: (_, item) => (
                                <Flex align="center" gap={8}>
                                    {item.name}
                                    {item.githubUrl ? (
                                        <Typography.Link href={item.githubUrl} target="_blank">
                                            <ExportOutlined />
                                        </Typography.Link>
                                    ) : null}
                                </Flex>
                            ),
                        },
                        {
                            title: "",
                            key: "sync",
                            width: 96,
                            align: "right",
                            render: (_, item) => (
                                <Button
                                    type="primary"
                                    loading={isSyncing}
                                    onClick={async () => {
                                        try {
                                            await syncCategory(item.category);
                                            setIsSyncOpen(false);
                                        } catch {}
                                    }}
                                >
                                    {t("admin.common.actions.sync")}
                                </Button>
                            ),
                        },
                    ]}
                />
            </Modal>

            <Modal
                title={t("admin.prompts.delete.title")}
                open={Boolean(deletingPrompt)}
                onCancel={() => setDeletingPrompt(null)}
                onOk={async () => {
                    if (!deletingPrompt) return;
                    await deletePrompt(deletingPrompt.id);
                    setDeletingPrompt(null);
                }}
                okText={t("admin.common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("admin.common.actions.cancel")}
            >
                {t("admin.prompts.delete.confirm", { title: deletingPrompt?.title })}
            </Modal>

            <Modal
                title={t("admin.prompts.batchDelete.title")}
                open={isBatchDeleteOpen}
                onCancel={() => setIsBatchDeleteOpen(false)}
                onOk={() => void batchDeletePrompts()}
                okText={t("admin.common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("admin.common.actions.cancel")}
            >
                {t("admin.prompts.batchDelete.confirm", { count: selectedPromptIds.length, value: formatNumber(selectedPromptIds.length) })}
            </Modal>
        </main>
    );
}
