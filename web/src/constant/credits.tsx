import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

import { normalizeResolutionToken } from "@/lib/seedance-video";
import { multiplyDecimalByInteger, type DecimalValue } from "@/lib/decimal";
import { modelOptionName } from "@/stores/use-config-store";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    credits: DecimalValue;
    resolutionCredits?: Record<string, DecimalValue>;
};

function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    const modelName = modelOptionName(model);
    return modelCosts?.find((item) => item.model === modelName);
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; resolution?: string; duration?: string | number; fallbackCredits?: DecimalValue }) {
    if (options.channelMode !== "remote") return "0";
    const cost = modelCreditCost(options.modelCosts, options.model);
    const resolutionCredits = options.resolution ? cost?.resolutionCredits?.[normalizeResolutionToken(options.resolution)] : undefined;
    if (resolutionCredits !== undefined) return multiplyDecimalByInteger(resolutionCredits, Math.max(0, Math.floor(Number(options.duration)) || 0));
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return multiplyDecimalByInteger(cost?.credits ?? options.fallbackCredits ?? "0", count);
}
