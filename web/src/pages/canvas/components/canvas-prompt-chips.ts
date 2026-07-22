export type PromptChipReference = { nodeId: string; label: string; active?: boolean };
export type PromptToken = { type: "text"; value: string } | { type: "reference"; nodeId: string; label: string };

export function parsePromptTokens(value: string, references: PromptChipReference[]): PromptToken[] {
    const byLabel = new Map(references.filter((item) => item.active !== false).map((item) => [item.label, item]));
    const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
    if (!labels.length) return value ? [{ type: "text", value }] : [];
    const pattern = new RegExp(`(${labels.map((label) => `${escapeRegExp(label)}${/\d$/.test(label) ? "(?!\\d)" : ""}`).join("|")})`, "g");
    return value.split(pattern).flatMap((part): PromptToken[] => {
        if (!part) return [];
        const reference = byLabel.get(part);
        return reference ? [{ type: "reference", nodeId: reference.nodeId, label: reference.label }] : [{ type: "text", value: part }];
    });
}

export function serializePromptTokens(tokens: PromptToken[]) {
    return tokens.map((token) => (token.type === "text" ? token.value : token.label)).join("");
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
