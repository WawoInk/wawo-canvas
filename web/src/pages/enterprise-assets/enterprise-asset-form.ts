import type { EnterpriseAssetInput, EnterpriseAssetType } from "@/services/api/enterprise-assets";

export type EnterpriseAssetFormDraft = Pick<EnterpriseAssetInput, "title" | "tags" | "description" | "content"> & { type: EnterpriseAssetType };
export type EnterpriseAssetMedia = { id: string; width: number; height: number; bytes: number; mimeType: string };

export function buildEnterpriseAssetInput(values: EnterpriseAssetFormDraft, media?: EnterpriseAssetMedia): EnterpriseAssetInput {
    const base = { type: values.type, title: values.title, tags: values.tags || [], description: values.description || "", content: values.type === "text" ? values.content : "" };
    if (values.type === "text") return base;
    if (!media) throw new Error("请上传图片或视频文件");
    return { ...base, fileId: media.id, width: media.width, height: media.height, bytes: media.bytes, mimeType: media.mimeType };
}
