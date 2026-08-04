import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDir = resolve(process.argv[2] || ".");
const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const results = [];
const state = { baseUrl, suffix, admin: { username: adminUsername, password: adminPassword } };
let failed = false;

await mkdir(outputDir, { recursive: true });

function assert(condition, message, value) {
    if (!condition) throw new Error(`${message}${value === undefined ? "" : `: ${JSON.stringify(value).slice(0, 500)}`}`);
}

async function request(method, path, token, body) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        throw new Error(`${method} ${path} 返回非 JSON（HTTP ${response.status}）：${raw.slice(0, 200)}`);
    }
    return { status: response.status, ...payload };
}

function expectCode(response, code, message) {
    assert(response.code === code, `期望 code=${code}，实际 code=${response.code}`, response);
    if (message) assert(String(response.msg || "").includes(message), `期望提示包含“${message}”`, response);
    return response.data;
}

async function run(name, action, fatal = false) {
    const started = Date.now();
    try {
        const detail = await action();
        results.push({ name, status: "PASS", durationMs: Date.now() - started, detail: detail ?? "" });
        return detail;
    } catch (error) {
        failed = true;
        results.push({ name, status: "FAIL", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
        if (fatal) throw error;
        return undefined;
    }
}

let admin;
let enterpriseA;
let enterpriseB;
let ownerA;
let ownerB;
let memberA;
let memberB;
let personal;
let ownerAToken;
let ownerBToken;
let memberAToken;
let memberBToken;
let personalToken;

try {
    await run("LIVE-001 健康检查", async () => {
        const response = await fetch(`${baseUrl}/api/health`);
        assert(response.ok && (await response.text()).trim() === "ok", "健康检查失败");
    }, true);

    admin = await run("LIVE-002 管理员登录", async () => {
        const response = await request("POST", "/api/admin/login", "", { username: adminUsername, password: adminPassword });
        const session = expectCode(response, 0);
        assert(session.user.role === "admin" && session.token, "管理员会话异常", session.user);
        return session;
    }, true);

    await run("LIVE-003 创建企业必填校验", async () => {
        const response = await request("POST", "/api/admin/enterprises", admin.token, { name: "", ownerUsername: "", ownerPassword: "" });
        expectCode(response, 1, "不能为空");
    });

    const ownerAUsername = `e2eoa${suffix}`;
    const ownerBUsername = `e2eob${suffix}`;
    const ownerAPassword = `owner-a-${suffix}`;
    const ownerBPassword = `owner-b-${suffix}`;
    enterpriseA = await run("LIVE-004 创建企业 A 与主账号", async () => {
        const response = await request("POST", "/api/admin/enterprises", admin.token, {
            name: `自动测试企业A-${suffix}`,
            ownerUsername: ownerAUsername,
            ownerPassword: ownerAPassword,
            ownerDisplayName: `自动测试主账号A-${suffix}`,
        });
        const enterprise = expectCode(response, 0);
        assert(enterprise.ownerName === ownerAUsername && enterprise.ownerCredits === 0 && enterprise.status === "active", "企业 A 初始状态异常", enterprise);
        state.enterpriseA = { id: enterprise.id, name: enterprise.name };
        return enterprise;
    }, true);

    await run("LIVE-005 重复主账号创建原子失败", async () => {
        const response = await request("POST", "/api/admin/enterprises", admin.token, { name: `重复企业-${suffix}`, ownerUsername: ownerAUsername, ownerPassword: ownerAPassword });
        expectCode(response, 1, "用户名已存在");
        const listed = expectCode(await request("GET", `/api/admin/enterprises?keyword=${encodeURIComponent(ownerAUsername)}&pageSize=20`, admin.token), 0);
        assert(listed.total === 1 && listed.items[0].id === enterpriseA.id, "重复创建留下了半成品", listed);
    });

    enterpriseB = await run("LIVE-006 创建企业 B 用于越权测试", async () => {
        const response = await request("POST", "/api/admin/enterprises", admin.token, {
            name: `自动测试企业B-${suffix}`,
            ownerUsername: ownerBUsername,
            ownerPassword: ownerBPassword,
            ownerDisplayName: `自动测试主账号B-${suffix}`,
        });
        const enterprise = expectCode(response, 0);
        state.enterpriseB = { id: enterprise.id, name: enterprise.name };
        return enterprise;
    }, true);

    await run("LIVE-007 企业搜索与主账号字段", async () => {
        const listed = expectCode(await request("GET", `/api/admin/enterprises?keyword=${encodeURIComponent(ownerAUsername)}&pageSize=20`, admin.token), 0);
        assert(listed.total === 1 && listed.items[0].ownerId === enterpriseA.ownerId && listed.items[0].memberCount === 0, "企业搜索结果异常", listed);
    });

    await run("LIVE-008 平台积分按增量调整与余额下限", async () => {
        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/credits`, admin.token, { delta: 0, reason: "零值" }), 1, "不能为 0");
        const added = expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/credits`, admin.token, { delta: 300, reason: "自动测试充值" }), 0);
        assert(added.ownerCredits === 300, "充值后余额错误", added);
        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/credits`, admin.token, { delta: -500, reason: "自动测试超扣" }), 1, "余额不足");
        const deducted = expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/credits`, admin.token, { delta: -50, reason: "自动测试扣减" }), 0);
        assert(deducted.ownerCredits === 250, "扣减后余额错误", deducted);
    });

    await run("LIVE-009 企业主账号余额不能被用户管理接口覆盖", async () => {
        expectCode(await request("POST", `/api/admin/users/${enterpriseA.ownerId}/credits`, admin.token, { credits: 999999 }), 1, "企业管理");
        const listed = expectCode(await request("GET", `/api/admin/enterprises?keyword=${encodeURIComponent(ownerAUsername)}`, admin.token), 0);
        assert(listed.items[0].ownerCredits === 250, "余额被覆盖", listed.items[0]);
    });

    ownerA = await run("LIVE-010 企业主账号 A 登录与身份字段", async () => {
        const session = expectCode(await request("POST", "/api/auth/login", "", { username: ownerAUsername, password: ownerAPassword }), 0);
        assert(session.user.enterpriseId === enterpriseA.id && session.user.enterpriseRole === "owner" && session.user.role === "user", "主账号身份异常", session.user);
        ownerAToken = session.token;
        return session;
    }, true);
    ownerB = await run("LIVE-011 企业主账号 B 登录", async () => {
        const session = expectCode(await request("POST", "/api/auth/login", "", { username: ownerBUsername, password: ownerBPassword }), 0);
        ownerBToken = session.token;
        return session;
    }, true);

    const memberAUsername = `e2ema${suffix}`;
    const memberBUsername = `e2emb${suffix}`;
    let memberAPassword = `member-a-${suffix}`;
    const memberBPassword = `member-b-${suffix}`;
    memberA = await run("LIVE-012 创建成员时忽略伪造权限字段", async () => {
        const response = await request("POST", "/api/v1/enterprise/members", ownerAToken, {
            username: memberAUsername,
            password: memberAPassword,
            displayName: `自动测试成员A-${suffix}`,
            email: `member-a-${suffix}@example.com`,
            enterpriseId: enterpriseB.id,
            enterpriseRole: "owner",
            role: "admin",
            credits: 999999,
        });
        const member = expectCode(response, 0);
        assert(member.enterpriseId === enterpriseA.id && member.enterpriseRole === "member" && member.role === "user" && member.credits === 0, "成员权限字段被客户端覆盖", member);
        return member;
    }, true);
    memberB = await run("LIVE-013 创建企业 B 成员", async () => {
        return expectCode(await request("POST", "/api/v1/enterprise/members", ownerBToken, { username: memberBUsername, password: memberBPassword, displayName: `自动测试成员B-${suffix}` }), 0);
    }, true);

    memberA = await run("LIVE-014 成员 A 独立登录", async () => {
        const session = expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: memberAPassword }), 0);
        assert(session.user.enterpriseRole === "member" && session.user.credits === 0, "成员登录身份异常", session.user);
        memberAToken = session.token;
        return memberA;
    }, true);
    memberB = await run("LIVE-015 成员 B 独立登录", async () => {
        const session = expectCode(await request("POST", "/api/auth/login", "", { username: memberBUsername, password: memberBPassword }), 0);
        memberBToken = session.token;
        return memberB;
    }, true);

    const personalUsername = `e2ep${suffix}`;
    let personalPassword = `personal-${suffix}`;
    personal = await run("LIVE-016 注册个人账号", async () => {
        const session = expectCode(await request("POST", "/api/auth/register", "", { username: personalUsername, password: personalPassword }), 0);
        assert(!session.user.enterpriseId && !session.user.enterpriseRole, "个人账号意外获得企业身份", session.user);
        personalToken = session.token;
        return session;
    }, true);

    await run("LIVE-017 成员查询范围不接受客户端企业 ID", async () => {
        const listed = expectCode(await request("GET", `/api/v1/enterprise/members?enterpriseId=${encodeURIComponent(enterpriseB.id)}&pageSize=100`, ownerAToken), 0);
        assert(listed.total === 1 && listed.items[0].id === memberA.id && !listed.items.some((item) => item.id === memberB.id), "成员列表越过企业边界", listed);
    });

    const transferId = `allocate-${suffix}`;
    await run("LIVE-018 积分分配、幂等与请求冲突", async () => {
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "allocate", amount: 0, requestId: `invalid-${suffix}` }), 1, "正整数");
        const first = expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "allocate", amount: 100, requestId: transferId }), 0);
        assert(first.ownerCredits === 150 && first.member.credits === 100, "首次分配余额错误", first);
        const replay = expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "allocate", amount: 100, requestId: transferId }), 0);
        assert(replay.ownerCredits === 150 && replay.member.credits === 100, "重复请求重复记账", replay);
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "allocate", amount: 99, requestId: transferId }), 1, "请求 ID");
    });

    await run("LIVE-019 积分收回、余额不足与越权拒绝", async () => {
        const reclaimed = expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "reclaim", amount: 30, requestId: `reclaim-${suffix}` }), 0);
        assert(reclaimed.ownerCredits === 180 && reclaimed.member.credits === 70, "积分收回余额错误", reclaimed);
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "reclaim", amount: 999, requestId: `reclaim-too-much-${suffix}` }), 1, "成员余额不足");
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, memberAToken, { action: "allocate", amount: 1, requestId: `member-forbidden-${suffix}` }), 1, "仅企业主账号");
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberB.id}/credits`, ownerAToken, { action: "allocate", amount: 1, requestId: `cross-${suffix}` }), 1, "不存在或无权操作");
    });

    await run("LIVE-020 并发分配最多成功一次且余额不为负", async () => {
        const calls = [1, 2].map((index) => request("POST", `/api/v1/enterprise/members/${memberA.id}/credits`, ownerAToken, { action: "allocate", amount: 150, requestId: `concurrent-${index}-${suffix}` }));
        const responses = await Promise.all(calls);
        assert(responses.filter((item) => item.code === 0).length === 1 && responses.filter((item) => item.code === 1).length === 1, "并发分配结果不符合预期", responses);
        const listed = expectCode(await request("GET", `/api/v1/enterprise/members?keyword=${encodeURIComponent(memberAUsername)}`, ownerAToken), 0);
        const enterprise = expectCode(await request("GET", `/api/admin/enterprises?keyword=${encodeURIComponent(ownerAUsername)}`, admin.token), 0).items[0];
        assert(listed.items[0].credits === 220 && enterprise.ownerCredits === 30, "并发后余额不守恒", { member: listed.items[0], enterprise });
    });

    await run("LIVE-021 企业积分流水筛选与范围隔离", async () => {
        const all = expectCode(await request("GET", "/api/v1/enterprise/credit-logs?pageSize=100", ownerAToken), 0);
        assert(all.items.length >= 8 && all.items.every((item) => item.userId === enterpriseA.ownerId || item.userId === memberA.id), "企业流水混入其他账号", all);
        const filtered = expectCode(await request("GET", `/api/v1/enterprise/credit-logs?memberId=${memberA.id}&type=enterprise_allocate&pageSize=100`, ownerAToken), 0);
        assert(filtered.items.length === 2 && filtered.items.every((item) => item.userId === memberA.id && item.type === "enterprise_allocate"), "流水筛选异常", filtered);
        const crossKeyword = expectCode(await request("GET", `/api/v1/enterprise/credit-logs?keyword=${encodeURIComponent(ownerBUsername)}&enterpriseId=${enterpriseB.id}&pageSize=100`, ownerAToken), 0);
        assert(crossKeyword.total === 0, "流水关键词泄露其他企业", crossKeyword);
        expectCode(await request("GET", "/api/v1/enterprise/credit-logs?pageSize=100", memberAToken), 1, "仅企业主账号");
    });

    await run("LIVE-022 用户列表展示企业归属且主账号余额不可伪造", async () => {
        const users = expectCode(await request("GET", `/api/admin/users?keyword=${encodeURIComponent(ownerAUsername)}`, admin.token), 0);
        assert(users.total === 1 && users.items[0].enterpriseId === enterpriseA.id && users.items[0].enterpriseRole === "owner" && users.items[0].credits === 30, "管理员用户视图异常", users);
    });

    await run("LIVE-023 个人资料校验与用户名只读", async () => {
        expectCode(await request("PUT", "/api/v1/account/profile", ownerAToken, { displayName: "错误邮箱", email: "not-an-email" }), 1, "邮箱格式不正确");
        const updated = expectCode(await request("PUT", "/api/v1/account/profile", ownerAToken, { username: "forged-name", displayName: `更新昵称-${suffix}`, email: `owner-a-${suffix}@example.com` }), 0);
        assert(updated.username === ownerAUsername && updated.displayName === `更新昵称-${suffix}`, "用户名被普通资料接口修改", updated);
    });

    const renamedEnterprise = `自动测试企业A已更新-${suffix}`;
    await run("LIVE-024 企业概况与改名权限", async () => {
        const summary = expectCode(await request("GET", "/api/v1/enterprise/summary", ownerAToken), 0);
        assert(summary.id === enterpriseA.id && summary.role === "owner" && summary.memberCount === 1, "主账号企业概况异常", summary);
        const renamed = expectCode(await request("PUT", "/api/v1/account/enterprise", ownerAToken, { name: renamedEnterprise }), 0);
        assert(renamed.name === renamedEnterprise, "企业改名失败", renamed);
        expectCode(await request("PUT", "/api/v1/account/enterprise", memberAToken, { name: "越权改名" }), 1, "仅企业主账号");
        expectCode(await request("GET", "/api/v1/enterprise/summary", personalToken), 1, "不属于企业");
        enterpriseA.name = renamedEnterprise;
    });

    const sourceTitle = `源文本素材-${suffix}`;
    let sourceAsset;
    let personalCopy;
    sourceAsset = await run("LIVE-025 企业文本素材筛选、伪造范围忽略与只读权限", async () => {
        const created = expectCode(await request("POST", "/api/v1/enterprise/assets", ownerAToken, {
            enterpriseId: enterpriseB.id,
            userId: memberB.id,
            type: "text",
            title: sourceTitle,
            tags: ["自动测试", suffix],
            description: "用于跨企业与复制测试",
            content: `独立文本内容 ${suffix}`,
        }), 0);
        assert(created.enterpriseId === enterpriseA.id && created.userId === enterpriseA.ownerId, "企业素材范围被客户端覆盖", created);
        const filtered = expectCode(await request("GET", `/api/v1/enterprise/assets?keyword=${encodeURIComponent(suffix)}&type=text&tag=${encodeURIComponent("自动测试")}&pageSize=100`, memberAToken), 0);
        assert(filtered.items.some((item) => item.id === created.id), "成员无法筛选本企业素材", filtered);
        expectCode(await request("POST", "/api/v1/enterprise/assets", memberAToken, { type: "text", title: "成员越权创建", content: "x" }), 1, "仅企业主账号");
        expectCode(await request("GET", `/api/v1/enterprise/assets/${created.id}`, ownerBToken), 1);
        expectCode(await request("GET", `/api/v1/enterprise/assets/${created.id}`, personalToken), 1);
        return created;
    }, true);

    personalCopy = await run("LIVE-026 企业文本素材复制为独立个人副本", async () => {
        const copied = expectCode(await request("POST", `/api/v1/enterprise/assets/${sourceAsset.id}/copy`, memberAToken), 0);
        assert(copied.id !== sourceAsset.id && copied.userId === memberA.id && !copied.enterpriseId && copied.content === sourceAsset.content, "个人副本不独立", copied);
        expectCode(await request("POST", `/api/v1/enterprise/assets/${sourceAsset.id}/copy`, ownerBToken), 1);
        expectCode(await request("POST", `/api/v1/enterprise/assets/${sourceAsset.id}/copy`, personalToken), 1);
        return copied;
    }, true);

    await run("LIVE-027 删除源素材后个人副本仍可读", async () => {
        expectCode(await request("DELETE", `/api/v1/enterprise/assets/${sourceAsset.id}`, ownerAToken), 0);
        expectCode(await request("GET", `/api/v1/enterprise/assets/${sourceAsset.id}`, memberAToken), 1);
        const personalAssets = expectCode(await request("GET", "/api/v1/assets?pageSize=100", memberAToken), 0);
        const copy = personalAssets.items.find((item) => item.id === personalCopy.id);
        assert(copy && copy.content === sourceAsset.content && !copy.enterpriseId, "源删除后个人副本丢失", personalAssets);
    });

    await run("LIVE-028 成员密码重置与禁用立即使会话失效", async () => {
        const nextPassword = `member-a-new-${suffix}`;
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/password`, ownerAToken, { password: nextPassword }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", memberAToken), 1);
        expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: memberAPassword }), 1);
        const relogin = expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: nextPassword }), 0);
        memberAPassword = nextPassword;
        memberAToken = relogin.token;
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/status`, ownerAToken, { status: "ban" }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", memberAToken), 1);
        expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: memberAPassword }), 1);
        expectCode(await request("POST", `/api/v1/enterprise/members/${memberA.id}/status`, ownerAToken, { status: "active" }), 0);
        const active = expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: memberAPassword }), 0);
        memberAToken = active.token;
    });

    let ownerAPasswordFinal = ownerAPassword;
    await run("LIVE-029 主账号密码重置、主账号停用与企业停用语义", async () => {
        const resetPassword = `owner-a-new-${suffix}`;
        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/owner/password`, admin.token, { password: resetPassword }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", ownerAToken), 1);
        expectCode(await request("POST", "/api/auth/login", "", { username: ownerAUsername, password: ownerAPassword }), 1);
        let ownerSession = expectCode(await request("POST", "/api/auth/login", "", { username: ownerAUsername, password: resetPassword }), 0);
        ownerAPasswordFinal = resetPassword;
        ownerAToken = ownerSession.token;

        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/owner/status`, admin.token, { status: "ban" }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", ownerAToken), 1);
        expectCode(await request("GET", "/api/v1/credit-logs", memberAToken), 0);
        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/owner/status`, admin.token, { status: "active" }), 0);
        ownerSession = expectCode(await request("POST", "/api/auth/login", "", { username: ownerAUsername, password: resetPassword }), 0);
        ownerAToken = ownerSession.token;

        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/status`, admin.token, { status: "disabled" }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", ownerAToken), 1);
        expectCode(await request("GET", "/api/v1/credit-logs", memberAToken), 1);
        expectCode(await request("POST", `/api/admin/enterprises/${enterpriseA.id}/status`, admin.token, { status: "active" }), 0);
        ownerAToken = expectCode(await request("POST", "/api/auth/login", "", { username: ownerAUsername, password: resetPassword }), 0).token;
        memberAToken = expectCode(await request("POST", "/api/auth/login", "", { username: memberAUsername, password: memberAPassword }), 0).token;
    });

    await run("LIVE-030 自助修改密码使旧会话失效", async () => {
        expectCode(await request("POST", "/api/v1/account/password", personalToken, { currentPassword: "wrong", newPassword: `bad-${suffix}` }), 1, "当前密码错误");
        const nextPassword = `personal-new-${suffix}`;
        expectCode(await request("POST", "/api/v1/account/password", personalToken, { currentPassword: personalPassword, newPassword: nextPassword }), 0);
        expectCode(await request("GET", "/api/v1/credit-logs", personalToken), 1);
        expectCode(await request("POST", "/api/auth/login", "", { username: personalUsername, password: personalPassword }), 1);
        const session = expectCode(await request("POST", "/api/auth/login", "", { username: personalUsername, password: nextPassword }), 0);
        personalPassword = nextPassword;
        personalToken = session.token;
    });

    const uiAssetTitle = `UI共享素材-${suffix}`;
    const uiAsset = await run("LIVE-031 为浏览器测试准备只读共享素材", async () => {
        return expectCode(await request("POST", "/api/v1/enterprise/assets", ownerAToken, {
            type: "text",
            title: uiAssetTitle,
            tags: ["UI自动化"],
            description: "供 Playwright 成员只读与复制验证",
            content: `UI 自动化共享内容 ${suffix}`,
        }), 0);
    }, true);

    state.enterpriseA = { ...enterpriseA, owner: { username: ownerAUsername, password: ownerAPasswordFinal, id: enterpriseA.ownerId } };
    state.enterpriseB = { ...enterpriseB, owner: { username: ownerBUsername, password: ownerBPassword, id: enterpriseB.ownerId } };
    state.memberA = { id: memberA.id, username: memberAUsername, password: memberAPassword };
    state.memberB = { id: memberB.id, username: memberBUsername, password: memberBPassword };
    state.personal = { username: personalUsername, password: personalPassword };
    state.uiAsset = { id: uiAsset.id, title: uiAssetTitle };
    state.deletedSourceCopy = { sourceTitle, copyId: personalCopy.id };
    state.ready = true;
} catch (error) {
    failed = true;
    results.push({ name: "LIVE-FATAL", status: "FAIL", durationMs: 0, error: error instanceof Error ? error.message : String(error) });
}

const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === "PASS").length,
    failed: results.filter((item) => item.status === "FAIL").length,
};
await writeFile(resolve(outputDir, "live-api-results.json"), `${JSON.stringify({ startedAt: new Date().toISOString(), baseUrl, summary, results }, null, 2)}\n`);
if (state.enterpriseA) await writeFile(resolve(outputDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (failed) process.exitCode = 1;
