export type VideoBillingMode = "per_credit" | "per_second" | "per_call";

export type VideoModelCost = {
    model: string;
    credits: number;
    resolutionCredits?: Record<string, number>;
};

type VideoBillingBinding = {
    billingMode?: VideoBillingMode;
    limitOverrides?: { resolutionValues?: string[] };
};

export function videoBillingRule(binding: VideoBillingBinding, defaultResolutions: string[]) {
    return {
        mode: binding.billingMode || "per_call",
        resolutions: binding.limitOverrides?.resolutionValues || defaultResolutions,
    };
}

export function normalizeModelCosts(items: Array<Partial<VideoModelCost>>) {
    return items
        .filter((item) => item.model)
        .map((item) => ({
            model: item.model || "",
            credits: Math.max(0, Number(item.credits) || 0),
            ...(item.resolutionCredits
                ? {
                      resolutionCredits: Object.fromEntries(Object.entries(item.resolutionCredits).map(([resolution, credits]) => [resolution, Math.max(0, Number(credits) || 0)])),
                  }
                : {}),
        }));
}

export function modelCostFor(items: VideoModelCost[], model: string, fallbackModel?: string): VideoModelCost {
    const cost = items.find((item) => item.model === model) || items.find((item) => item.model === fallbackModel);
    return cost ? { ...cost, model } : { model, credits: 0 };
}

export function upsertModelCost(items: VideoModelCost[], model: string, patch: Partial<Omit<VideoModelCost, "model">>) {
    const current = items.find((item) => item.model === model) || { model, credits: 0 };
    const updated = normalizeModelCosts([{ ...current, ...patch, model }])[0];
    return [...items.filter((item) => item.model !== model), updated];
}
