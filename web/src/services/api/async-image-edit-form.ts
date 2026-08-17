import type { ImageRequestFormat, ImageRequestFormatSetting } from "@/services/api/settings";

export type AsyncImageEditFields = {
    model: string;
    prompt: string;
    image: File | File[];
    n: number;
    size?: string;
    background?: string;
    output_format: string;
};

export function applyImageBackground(formData: FormData, background?: string) {
    if (background === "transparent") formData.set("background", background);
}

export function buildAsyncImageEditFormData(fields: AsyncImageEditFields) {
    const formData = new FormData();
    formData.set("model", fields.model);
    formData.set("prompt", fields.prompt);
    const images = Array.isArray(fields.image) ? fields.image : [fields.image];
    images.forEach((image) => formData.append("image", image));
    formData.set("n", String(fields.n));
    if (fields.size) formData.set("size", fields.size);
    applyImageBackground(formData, fields.background);
    formData.set("output_format", fields.output_format);
    return formData;
}

export function resolveImageRequestFormat(settings: ImageRequestFormatSetting[], model: string, fallback: ImageRequestFormat) {
    const format = settings.find((item) => item.model.trim() === model.trim())?.format;
    return format === "application/json" || format === "multipart/form-data" ? format : fallback;
}

export function imageEditReferenceFields(model: string, images: string[]) {
    return model.trim() === "Images" ? { images: images.map((image_url) => ({ image_url })) } : { image: images.length === 1 ? images[0] : images };
}

export function buildAsyncImageEditRequest(fields: AsyncImageEditFields, format: ImageRequestFormat, images: string | string[]) {
    if (format === "application/json") {
        const { image: _file, ...body } = fields;
        const values = Array.isArray(images) ? images : [images];
        return { body: { ...body, ...imageEditReferenceFields(fields.model, values) }, contentType: format };
    }
    return { body: buildAsyncImageEditFormData(fields), contentType: undefined };
}
