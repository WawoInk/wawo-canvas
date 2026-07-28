import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

test("按秒视频按所选分辨率和时长展示总积分", async (t) => {
    const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const server = await createServer({ root: webDir, configFile: resolve(webDir, "vite.config.ts"), server: { middlewareMode: true }, appType: "custom" });
    t.after(() => server.close());
    const { requestCreditCost } = await server.ssrLoadModule("/src/constant/credits.tsx");

    assert.equal(
        requestCreditCost({
            channelMode: "remote",
            model: "seedance-2-0-line-2",
            resolution: "720",
            duration: "6",
            modelCosts: [{ model: "seedance-2-0-line-2", credits: 0, resolutionCredits: { "720p": 2, "1080p": 4 } }],
        }),
        12,
    );
    assert.equal(requestCreditCost({ channelMode: "remote", model: "stable-video", fallbackCredits: 7 }), 7);
});
