import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

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
    credits: number;
};

function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    const modelName = modelOptionName(model);
    return modelCosts?.find((item) => item.model === modelName)?.credits || 0;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number }) {
    if (options.channelMode !== "remote") return 0;
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return modelCreditCost(options.modelCosts, options.model) * count;
}
