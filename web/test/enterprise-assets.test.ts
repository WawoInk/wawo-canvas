import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEnterpriseAssetInput } from "../src/pages/enterprise-assets/enterprise-asset-form.ts";
import { defaultEnterpriseAssetQuery, enterpriseAssetQueryKey, updateEnterpriseAssetQuery } from "../src/pages/enterprise-assets/enterprise-asset-query.ts";

test("enterprise asset filters reset pagination and keep query cache scoped", () => {
    const current = { ...defaultEnterpriseAssetQuery, keyword: "旧搜索", tag: ["品牌"], page: 4 };
    assert.deepEqual(updateEnterpriseAssetQuery(current, { page: 2 }), { ...current, page: 2 });
    assert.deepEqual(updateEnterpriseAssetQuery(current, { keyword: "新搜索" }), { ...current, keyword: "新搜索", page: 1 });
    assert.deepEqual(updateEnterpriseAssetQuery(current, { type: "text", tag: [] }), { ...current, type: "text", tag: [], page: 1 });
    assert.deepEqual(updateEnterpriseAssetQuery(current, { pageSize: 20 }), { ...current, pageSize: 20, page: 1 });

    const ownerKey = enterpriseAssetQueryKey("owner-a", "enterprise-a", current);
    assert.notDeepEqual(ownerKey, enterpriseAssetQueryKey("member-a", "enterprise-a", current));
    assert.notDeepEqual(ownerKey, enterpriseAssetQueryKey("owner-b", "enterprise-b", current));
    assert.deepEqual(ownerKey.slice(-5), [current.keyword, current.type, current.tag, current.page, current.pageSize]);
});

test("enterprise asset form builds text and uploaded media payloads", () => {
    assert.deepEqual(buildEnterpriseAssetInput({ type: "text", title: "品牌介绍", tags: ["品牌"], description: "团队文案", content: "统一介绍" }), {
        type: "text",
        title: "品牌介绍",
        tags: ["品牌"],
        description: "团队文案",
        content: "统一介绍",
    });
    assert.deepEqual(buildEnterpriseAssetInput({ type: "image", title: "品牌 Logo", tags: [], description: "透明底", content: "不应提交" }, { id: "file-image", width: 1200, height: 800, bytes: 2048, mimeType: "image/png" }), {
        type: "image",
        title: "品牌 Logo",
        tags: [],
        description: "透明底",
        content: "",
        fileId: "file-image",
        width: 1200,
        height: 800,
        bytes: 2048,
        mimeType: "image/png",
    });
});
