import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// @ts-expect-error Bun provides module mocking at test runtime.
import { mock } from "bun:test";

mock.module("@/components/ui/select", () => ({
    Select: ({ children }: PropsWithChildren) => createElement("div", null, children),
    SelectContent: ({ children }: PropsWithChildren) => createElement("div", null, children),
    SelectItem: ({ value, children }: PropsWithChildren<{ value: string }>) => createElement("div", { "data-value": value }, children),
    SelectTrigger: ({ children }: PropsWithChildren) => createElement("div", null, children),
}));

const { ModelPicker } = await import("./model-picker");
const { defaultConfig } = await import("@/stores/use-config-store");

test("remote explicit options still obey the capability allowlist", () => {
    const html = renderToStaticMarkup(
        createElement(ModelPicker, {
            config: {
                ...defaultConfig,
                channelMode: "remote",
                models: ["video-allowed", "video-hidden"],
                videoModels: ["video-allowed"],
            },
            value: "video-allowed",
            capability: "video",
            options: [
                { value: "video-allowed", label: "Allowed video" },
                { value: "video-hidden", label: "Hidden video" },
            ],
            onChange: () => {},
        }),
    );

    assert.match(html, /Allowed video/);
    assert.doesNotMatch(html, /Hidden video/);
});
