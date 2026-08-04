import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { formatList, formatNumber } from "@/i18n/formatters";

export function imageReferenceLabel(index: number) {
    return i18n.t("imageWorkbench.references.label", { index: formatNumber(index + 1, { useGrouping: false }) });
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return i18n.t("imageWorkbench.references.promptContext", { labels: formatList(labels), prompt: text });
}
