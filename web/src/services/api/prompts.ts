import i18n from "@/i18n";
import { formatDate } from "@/i18n/formatters";
import { compactApiParams, serializeApiParams } from "@/services/api/request";

export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

export const ALL_PROMPTS_OPTION = "__all__";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page, pageSize }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    const params = serializeApiParams(
        compactApiParams({
            ...(keyword ? { keyword } : {}),
            ...(tag.length ? { tag } : {}),
            ...(category !== ALL_PROMPTS_OPTION ? { category } : {}),
            ...(page ? { page } : {}),
            ...(pageSize ? { pageSize } : {}),
        }),
    );
    const response = await fetch(`/api/prompts${params.size ? `?${params}` : ""}`);
    if (!response.ok) throw new Error(i18n.t("prompts.errors.fetch"));
    const envelope = await response.json();
    if (!envelope || typeof envelope !== "object" || (typeof envelope.code === "number" && envelope.code !== 0)) {
        throw new Error(envelope?.msg || i18n.t("prompts.errors.fetch"));
    }
    return envelope.data as PromptListResponse;
}

export function formatPromptDate(value: string) {
    return formatDate(value, { year: "numeric", month: "2-digit", day: "2-digit" });
}
