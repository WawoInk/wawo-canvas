import assert from "node:assert/strict";
import { test } from "node:test";

import { enterpriseCapabilities } from "../src/lib/account-access.ts";

test("enterprise identity controls settings and navigation capabilities", () => {
    assert.deepEqual(enterpriseCapabilities(undefined), { showSummary: false, canRename: false, canManageMembers: false, canAccessAssets: false, canManageAssets: false });
    assert.deepEqual(enterpriseCapabilities({ role: "user" }), { showSummary: false, canRename: false, canManageMembers: false, canAccessAssets: false, canManageAssets: false });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "owner", enterpriseStatus: "active" }), {
        showSummary: true,
        canRename: true,
        canManageMembers: true,
        canAccessAssets: true,
        canManageAssets: true,
    });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "member", enterpriseStatus: "active" }), {
        showSummary: true,
        canRename: false,
        canManageMembers: false,
        canAccessAssets: true,
        canManageAssets: false,
    });
    assert.deepEqual(enterpriseCapabilities({ role: "user", enterpriseId: "enterprise-a", enterpriseRole: "owner", enterpriseStatus: "disabled" }), {
        showSummary: false,
        canRename: false,
        canManageMembers: false,
        canAccessAssets: false,
        canManageAssets: false,
    });
});
