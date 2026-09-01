import type { PublicSettings, PublicTextModelProtocol } from "@/services/api/settings";

const protocols: PublicTextModelProtocol[] = ["openai", "xvanai", "gemini"];

export type BrainstormAdminModelOption = {
    value: string;
    label: string;
    protocol: PublicTextModelProtocol;
};

export function brainstormAdminTextModelOptions(settings?: PublicSettings | null): BrainstormAdminModelOption[] {
    const channel = settings?.modelChannel;
    const available = new Set((channel?.availableModels || []).map((model) => model.trim()).filter(Boolean));
    const costs = new Map((channel?.modelCosts || []).map((item) => [item.model.trim(), item.displayName?.trim() || item.model.trim()]));
    const seen = new Set<string>();
    return (channel?.textModels || []).reduce<BrainstormAdminModelOption[]>((result, rawModel) => {
        const model = rawModel.trim();
        const protocol = channel?.textModelProtocols?.[model]?.trim().toLowerCase() as PublicTextModelProtocol | undefined;
        if (!model || seen.has(model) || !available.has(model) || !protocol || !protocols.includes(protocol)) return result;
        seen.add(model);
        result.push({ value: model, label: costs.get(model) || model, protocol });
        return result;
    }, []);
}

export function resolveBrainstormAdminModel(settings: PublicSettings, selectedModel?: string) {
    const options = brainstormAdminTextModelOptions(settings);
    const requested = (selectedModel || settings.modelChannel.defaultTextModel || "").trim();
    const option = options.find((item) => item.value === requested);
    if (!option) throw new Error("Brainstorm Agent 未配置有效的管理员文本模型，请重新选择。");
    return option;
}
