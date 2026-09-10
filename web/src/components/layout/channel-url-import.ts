import { createModelChannel, useConfigStore } from "@/stores/use-config-store";

type ChannelCredentials = { baseUrl?: string | null; apiKey?: string | null };
type ImportResult = { status: "created" | "updated" | "missing-base-url" | "invalid-base-url" | "disabled" | "pending"; channelName?: string };

export function importChannelCredentials(input: ChannelCredentials): ImportResult {
    const { config, updateConfig, publicSettings, configHydrated } = useConfigStore.getState();
    if (!publicSettings) return { status: "pending" };
    if (publicSettings.modelChannel.allowCustomChannel !== true) return { status: "disabled" };
    if (!configHydrated) return { status: "pending" };
    const rawBaseUrl = input.baseUrl?.trim();
    if (!rawBaseUrl) return { status: "missing-base-url" };
    let baseUrl: string;
    try {
        const url = new URL(rawBaseUrl);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return { status: "invalid-base-url" };
        baseUrl = normalizeBaseUrl(rawBaseUrl);
    } catch {
        return { status: "invalid-base-url" };
    }
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => {
        try {
            return normalizeBaseUrl(channel.baseUrl).replace(/\/v1$/i, "") === baseUrl.replace(/\/v1$/i, "");
        } catch {
            return false;
        }
    });
    if (matchingIndex < 0) {
        const channel = createModelChannel({ name: new URL(baseUrl).hostname.replace(/^(?:www|api)\./i, ""), baseUrl, apiKey, apiFormat: "openai", models: [] });
        updateConfig("channels", [...config.channels, channel]);
        return { status: "created", channelName: channel.name };
    }
    const existing = config.channels[matchingIndex];
    if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) return { status: "updated", channelName: existing.name };
    updateConfig(
        "channels",
        config.channels.map((channel, index) => (index === matchingIndex ? { ...channel, baseUrl, ...(apiKey ? { apiKey } : {}) } : channel)),
    );
    return { status: "updated", channelName: existing.name };
}

function normalizeBaseUrl(value: string) {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

export function readChannelImportUrl(replaceUrl: (url: string) => void): ChannelCredentials | null {
    const params = new URLSearchParams(window.location.search);
    const keys = ["baseUrl", "baseurl", "apiKey", "apikey"];
    if (!keys.some((key) => params.has(key))) return null;
    const credentials = { baseUrl: params.get("baseUrl") || params.get("baseurl"), apiKey: params.get("apiKey") || params.get("apikey") };
    for (const key of keys) params.delete(key);
    replaceUrl(`${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    return credentials;
}
