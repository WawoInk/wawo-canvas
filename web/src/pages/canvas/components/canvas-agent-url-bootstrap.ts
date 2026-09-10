export function hasAgentUrlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return params.has("agentUrl") || params.has("agentToken");
}

/** Consume credentials before starting any connection or asynchronous work. */
export function consumeAgentUrlBootstrap(location: Pick<Location, "href">, history: Pick<History, "state" | "replaceState">) {
    const current = new URL(location.href);
    const params = new URLSearchParams(current.hash.slice(1));
    if (!params.has("agentUrl") && !params.has("agentToken")) return null;
    const url = params.get("agentUrl")?.trim() || "";
    const token = params.get("agentToken")?.trim() || "";
    params.delete("agentUrl");
    params.delete("agentToken");
    current.hash = params.toString();
    history.replaceState(history.state, "", `${current.pathname}${current.search}${current.hash}`);
    return { url, token };
}
