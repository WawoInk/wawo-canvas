import assert from "node:assert/strict";
import { test } from "node:test";

import { modelCostFor, normalizeModelCosts, upsertModelCost, videoBillingRule } from "./billing-rules.ts";

test("视频定价规则沿用绑定模式和绑定允许的分辨率", () => {
    assert.deepEqual(
        videoBillingRule(
            {
                id: "stable-video",
                profileId: "seedance-1-5-pro",
                billingMode: "per_second",
                limitOverrides: { resolutionValues: ["480p", "720p"] },
            },
            ["480p", "720p", "1080p"],
        ),
        { mode: "per_second", resolutions: ["480p", "720p"] },
    );
    assert.deepEqual(videoBillingRule({ id: "legacy-video", profileId: "seedance-1-5-pro", limitOverrides: {} }, ["480p", "720p", "1080p"]), {
        mode: "per_call",
        resolutions: ["480p", "720p", "1080p"],
    });
});

test("模型定价归一化并按字段更新", () => {
    const normalized = normalizeModelCosts([
        { model: "stable-video", displayName: " 精品视频 ", credits: "-2", resolutionCredits: { "480p": "-1", "720p": "3" } },
        { model: "", credits: "9" },
    ]);
    assert.deepEqual(normalized, [{ model: "stable-video", displayName: "精品视频", credits: "0", resolutionCredits: { "480p": "0", "720p": "3" } }]);
    assert.deepEqual(upsertModelCost(normalized, "stable-video", { resolutionCredits: { "480p": "1", "720p": "3" } }), [{ model: "stable-video", displayName: "精品视频", credits: "0", resolutionCredits: { "480p": "1", "720p": "3" } }]);
});

test("绑定 ID 定价优先并回退到上游模型定价", () => {
    const costs = [
        { model: "vendor-video", credits: "7" },
        { model: "stable-video", credits: "9" },
    ];
    assert.deepEqual(modelCostFor(costs, "stable-video", "vendor-video"), { model: "stable-video", credits: "9" });
    assert.deepEqual(modelCostFor(costs.slice(0, 1), "stable-video", "vendor-video"), { model: "stable-video", credits: "7" });
});

test("模型定价保留完整小数精度", () => {
    assert.deepEqual(normalizeModelCosts([{ model: "precise", credits: "0.123456789012345678" }]), [{ model: "precise", credits: "0.123456789012345678" }]);
});
