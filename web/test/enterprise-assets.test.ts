import assert from "node:assert/strict";
import { test } from "node:test";

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
