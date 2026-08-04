"use client";

import { CopyOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Card, Col, Flex, Form, Image, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography, Upload, type UploadFile } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatNumber } from "@/i18n/formatters";
import type { AdminAsset } from "@/services/api/admin";
import { useAdminAssets } from "./use-admin-assets";

type AssetFormValues = Partial<AdminAsset> & { tagText?: string };

export default function AdminAssetsPage() {
    const { t } = useTranslation();
    const { assets, tags, keyword, kind, tag, page, pageSize, total, isLoading, searchAssets, changeKind, changeTag, changePage, changePageSize, resetFilters, refreshAssets, saveAsset: saveAdminAsset, deleteAsset } = useAdminAssets();
    const { message: appMessage } = App.useApp();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const [keywordText, setKeywordText] = useState(keyword);
    const [editingAsset, setEditingAsset] = useState<Partial<AdminAsset> | null>(null);
    const [detailAsset, setDetailAsset] = useState<AdminAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<AdminAsset | null>(null);
    const [imageFile, setImageFile] = useState<UploadFile | null>(null);
    const [uploading, setUploading] = useState(false);
    const formType = Form.useWatch("type", form) || editingAsset?.type || "text";
    const tagOptions = tags.map((item) => ({ label: item, value: item }));
    const typeOptions = [
        { label: t("admin.assets.types.all"), value: "" },
        { label: t("admin.assets.types.text"), value: "text" },
        { label: t("admin.assets.types.image"), value: "image" },
    ];
    const editTypeOptions = typeOptions.slice(1);

    useEffect(() => {
        if (editingAsset) {
            form.setFieldsValue({ ...editingAsset, tagText: editingAsset.tags?.join(", ") || "" });
            setImageFile(null);
        }
    }, [editingAsset, form]);

    useEffect(() => setKeywordText(keyword), [keyword]);

    const saveAsset = async () => {
        const value = await form.validateFields();
        const nextType = value.type || "text";
        let url = value.url;
        if (nextType === "image" && imageFile) {
            setUploading(true);
            try {
                url = await uploadAssetImage(imageFile, {
                    unreadable: t("admin.assets.messages.fileUnreadable"),
                    uploadFailed: t("admin.assets.messages.uploadFailed"),
                });
            } finally {
                setUploading(false);
            }
        }
        await saveAdminAsset({
            ...editingAsset,
            ...value,
            type: nextType,
            url,
            coverUrl: value.coverUrl || (nextType === "image" ? url : ""),
            tags: (value.tagText || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
        setEditingAsset(null);
        setImageFile(null);
    };

    const columns: ProColumns<AdminAsset>[] = [
        {
            title: t("admin.assets.table.cover"),
            dataIndex: "coverUrl",
            width: 88,
            render: (_, item) => (
                <Image
                    src={item.coverUrl || item.url || "/logo-white-mode.svg"}
                    alt={item.title}
                    width={56}
                    height={42}
                    style={{ objectFit: "cover", borderRadius: 6 }}
                    preview={{ mask: t("admin.common.actions.enlarge") }}
                    fallback="/logo-white-mode.svg"
                />
            ),
        },
        {
            title: t("admin.assets.table.title"),
            dataIndex: "title",
            width: 260,
            render: (_, item) => (
                <Typography.Link strong ellipsis style={{ maxWidth: 260, display: "block" }} onClick={() => setDetailAsset(item)}>
                    {item.title}
                </Typography.Link>
            ),
        },
        {
            title: t("admin.assets.table.type"),
            dataIndex: "type",
            width: 84,
            render: (_, item) => <Tag>{t(item.type === "image" ? "admin.assets.types.image" : "admin.assets.types.text")}</Tag>,
        },
        {
            title: t("admin.assets.table.tags"),
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
            title: t("admin.assets.table.category"),
            dataIndex: "category",
            width: 120,
            render: (_, item) => <Typography.Text type="secondary">{item.category || t("admin.assets.values.uncategorized")}</Typography.Text>,
        },
        {
            title: t("admin.common.table.actions"),
            key: "actions",
            width: 112,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title={t("admin.common.actions.details")}>
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailAsset(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.edit")}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingAsset(item)} />
                    </Tooltip>
                    <Tooltip title={t("admin.common.actions.delete")}>
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingAsset(item)} />
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
                                        placeholder={t("admin.assets.filters.searchPlaceholder")}
                                        allowClear
                                        enterButton={<SearchOutlined />}
                                        onSearch={() => searchAssets(keywordText)}
                                        onChange={(event) => setKeywordText(event.target.value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col flex="180px">
                                <Form.Item label={t("admin.assets.filters.type")}>
                                    <Select value={kind} onChange={changeKind} options={typeOptions} />
                                </Form.Item>
                            </Col>
                            <Col flex="220px">
                                <Form.Item label={t("admin.assets.filters.tags")}>
                                    <Select mode="multiple" allowClear maxTagCount="responsive" value={tag} onChange={changeTag} options={tagOptions} placeholder={t("admin.assets.filters.allTags")} />
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
                                        <Button type="primary" icon={<ReloadOutlined />} onClick={() => searchAssets(keywordText)}>
                                            {t("admin.common.actions.query")}
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminAsset>
                    rowKey="id"
                    columns={columns}
                    dataSource={assets}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>{t("admin.assets.title")}</Typography.Text>
                            <Tag>{t("admin.common.counts.records", { count: total, value: formatNumber(total) })}</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshAssets() }}
                    toolBarRender={() => [
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingAsset({ type: "text", tags: [] })}>
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
                title={t(editingAsset?.id ? "admin.assets.modal.editTitle" : "admin.assets.modal.createTitle")}
                open={Boolean(editingAsset)}
                width={760}
                onCancel={() => setEditingAsset(null)}
                onOk={() => void saveAsset()}
                okText={t("admin.common.actions.save")}
                cancelText={t("admin.common.actions.cancel")}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="type" label={t("admin.assets.form.type")} rules={[{ required: true, message: t("admin.assets.validation.typeRequired") }]}>
                        <Select options={editTypeOptions} />
                    </Form.Item>
                    <Form.Item name="title" label={t("admin.assets.form.title")} rules={[{ required: true, message: t("admin.assets.validation.titleRequired") }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="coverUrl" label={t("admin.assets.form.coverUrl")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="tagText" label={t("admin.assets.form.tags")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="category" label={t("admin.assets.form.category")}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label={t("admin.assets.form.description")}>
                        <Input.TextArea rows={3} />
                    </Form.Item>
                    {formType === "image" ? (
                        <Form.Item label={t("admin.assets.form.imageFile")} required extra={t("admin.assets.form.imageUploadHint")}>
                            <Upload
                                accept="image/*"
                                maxCount={1}
                                fileList={imageFile ? [imageFile] : []}
                                beforeUpload={(file) => {
                                    setImageFile(file as unknown as UploadFile);
                                    return false;
                                }}
                                onRemove={() => setImageFile(null)}
                            >
                                <Button icon={<UploadOutlined />} loading={uploading}>
                                    {t("admin.assets.actions.selectImage")}
                                </Button>
                            </Upload>
                        </Form.Item>
                    ) : (
                        <Form.Item name="content" label={t("admin.assets.form.textContent")} rules={[{ required: true, message: t("admin.assets.validation.contentRequired") }]}>
                            <Input.TextArea rows={6} />
                        </Form.Item>
                    )}
                </Form>
            </Modal>

            <Modal title={t("admin.assets.detail.title")} open={Boolean(detailAsset)} width={760} onCancel={() => setDetailAsset(null)} footer={<Button onClick={() => setDetailAsset(null)}>{t("admin.common.actions.close")}</Button>}>
                {detailAsset ? (
                    <Flex vertical gap={14}>
                        <Flex gap={14} align="start">
                            <Image
                                src={detailAsset.coverUrl || detailAsset.url || "/logo-white-mode.svg"}
                                alt={detailAsset.title}
                                width={116}
                                height={84}
                                style={{ objectFit: "cover", borderRadius: 8 }}
                                preview={{ mask: t("admin.common.actions.enlarge") }}
                                fallback="/logo-white-mode.svg"
                            />
                            <Flex vertical gap={8} style={{ minWidth: 0 }}>
                                <Typography.Title level={5} style={{ margin: 0 }}>
                                    {detailAsset.title}
                                </Typography.Title>
                                <Space wrap>
                                    <Tag>{t(detailAsset.type === "image" ? "admin.assets.types.image" : "admin.assets.types.text")}</Tag>
                                    {detailAsset.category ? <Tag>{detailAsset.category}</Tag> : null}
                                    {(detailAsset.tags || []).map((tag) => (
                                        <Tag key={tag}>{tag}</Tag>
                                    ))}
                                </Space>
                            </Flex>
                        </Flex>
                        {detailAsset.description ? (
                            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                                {detailAsset.description}
                            </Typography.Paragraph>
                        ) : null}
                        <Input.TextArea value={detailAsset.type === "image" ? detailAsset.url || detailAsset.coverUrl : detailAsset.content} rows={7} readOnly />
                        <Button icon={<CopyOutlined />} onClick={() => copyText(detailAsset.type === "image" ? detailAsset.url || detailAsset.coverUrl : detailAsset.content)}>
                            {t("admin.assets.actions.copyContent")}
                        </Button>
                    </Flex>
                ) : null}
            </Modal>

            <Modal
                title={t("admin.assets.delete.title")}
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={async () => {
                    if (!deletingAsset) return;
                    await deleteAsset(deletingAsset.id);
                    setDeletingAsset(null);
                }}
                okText={t("admin.common.actions.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("admin.common.actions.cancel")}
            >
                {t("admin.assets.delete.confirm", { title: deletingAsset?.title })}
            </Modal>
        </main>
    );
}

async function uploadAssetImage(file: UploadFile, fallback: { unreadable: string; uploadFailed: string }) {
    const origin = file.originFileObj || (file as unknown as File);
    if (!origin) throw new Error(fallback.unreadable);
    const token = localStorage.getItem("infinite-canvas-auth-token-v1") || "";
    const parsed = JSON.parse(token);
    const tokenValue = parsed?.state?.token || "";

    if (file.status === "done" && file.response) return file.response as string;

    const formData = new FormData();
    formData.append("file", origin);
    const response = await fetch("/api/admin/assets/upload-image", { method: "POST", body: formData, headers: { Authorization: `Bearer ${tokenValue}` } });
    const json = await response.json();
    if (json.code !== 0) throw new Error(json.msg || fallback.uploadFailed);
    return json.data.url as string;
}
