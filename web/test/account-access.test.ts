import assert from "node:assert/strict";
import { test } from "node:test";

import { enterpriseCapabilities } from "../src/lib/account-access.ts";

test("enterprise identity controls settings and navigation capabilities", () => {
    assert.deepEqual(enterpriseCapabilities(undefined), { showSummary: false, canRename: false, canAccessAssets: false });
    assert.deepEqual(enterpriseCapabilities({ role: "user" }), { showSummary: false, canRename: false, canAccessAssets: false });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "owner", enterpriseStatus: "active" }), { showSummary: true, canRename: true, canAccessAssets: true });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "member", enterpriseStatus: "active" }), { showSummary: true, canRename: false, canAccessAssets: true });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "owner", enterpriseStatus: "disabled" }), { showSummary: false, canRename: false, canAccessAssets: false });
});
