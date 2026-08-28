import assert from "node:assert/strict";
import { test } from "node:test";

import { runVolcengineAssetBatch } from "./volcengine-assets-batch.ts";

test("keeps registering later assets when one single-asset request fails", async () => {
    const attempted: string[] = [];
    const result = await runVolcengineAssetBatch(["first", "second", "third"], async (asset) => {
        attempted.push(asset);
        if (asset === "second") throw new Error("upstream rejected second");
    });

    assert.deepEqual(attempted, ["first", "second", "third"]);
    assert.deepEqual(result, {
        total: 3,
        successCount: 2,
        failedCount: 1,
        firstError: new Error("upstream rejected second"),
    });
});

test("uses the existing single-asset request once for one submitted asset", async () => {
    let requests = 0;
    const result = await runVolcengineAssetBatch(["only"], async () => {
        requests += 1;
    });

    assert.equal(requests, 1);
    assert.deepEqual(result, { total: 1, successCount: 1, failedCount: 0 });
});
