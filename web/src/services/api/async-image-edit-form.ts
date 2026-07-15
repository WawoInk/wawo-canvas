export type AsyncImageEditFields = {
    model: string;
    prompt: string;
    image: File;
    n: number;
    size?: string;
    output_format: string;
};

export function buildAsyncImageEditFormData(fields: AsyncImageEditFields) {
    const formData = new FormData();
    formData.set("model", fields.model);
    formData.set("prompt", fields.prompt);
    formData.set("image", fields.image);
    formData.set("n", String(fields.n));
    if (fields.size) formData.set("size", fields.size);
    formData.set("output_format", fields.output_format);
    return formData;
}
