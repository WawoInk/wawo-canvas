async (page) => {
    const state = __STATE__;
    const outputDir = __OUTPUT_DIR__;
    const results = [];
    const baseUrl = state.baseUrl;
    const uiCreatedTitle = `UI前端新增-${state.suffix}-${Date.now().toString(36)}`;

    const record = async (name, action) => {
        const started = Date.now();
        try {
            const detail = await action();
            results.push({ name, status: "PASS", durationMs: Date.now() - started, detail: detail || "" });
        } catch (error) {
            results.push({ name, status: "FAIL", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    };
    const visible = async (locator, message) => {
        await locator.waitFor({ state: "visible", timeout: 10000 });
        if (!(await locator.isVisible())) throw new Error(message);
    };
    const absent = async (locator, message) => {
        if (await locator.isVisible().catch(() => false)) throw new Error(message);
    };
    const shot = (name) => page.screenshot({ path: `${outputDir}/screenshots/${name}.png`, fullPage: true });
    const login = async (username, password) => {
        await page.goto(`${baseUrl}/login`);
        await page.getByRole("textbox", { name: "用户名" }).fill(username);
        await page.getByRole("textbox", { name: "密码" }).fill(password);
        await page.getByRole("button", { name: /登\s*录/ }).click();
        await visible(page.getByRole("button", { name: "账户菜单" }), `登录失败：${username}`);
    };
    const logout = async () => {
        const sideLogout = page.getByRole("button", { name: /退出登录/ });
        if (await sideLogout.isVisible().catch(() => false)) {
            await sideLogout.click();
        } else {
            await page.getByRole("button", { name: "账户菜单" }).click();
            await page.getByRole("menuitem", { name: "退出登录" }).click();
        }
        await visible(page.getByRole("link", { name: "登录" }), "退出登录失败");
    };
    const searchEnterpriseAsset = async (title) => {
        const input = page.getByPlaceholder("搜索标题、描述或内容");
        await input.fill(title);
        await input.locator("xpath=..//button").click();
        await visible(page.getByText(title, { exact: true }), `未找到企业素材：${title}`);
    };

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(baseUrl);
    await page.evaluate(() => localStorage.clear());
    await page.context().clearCookies();
    await page.reload();

    await record("UI-001 管理员入口与企业列表", async () => {
        await login(state.admin.username, state.admin.password);
        await page.getByRole("button", { name: "账户菜单" }).click();
        await visible(page.getByRole("link", { name: "管理后台" }), "管理员未显示管理后台入口");
        await page.getByRole("link", { name: "管理后台" }).click();
        await page.getByRole("link", { name: "企业管理" }).click();
        const search = page.getByRole("searchbox", { name: "搜索企业名称或主账号" });
        await search.fill(state.enterpriseA.owner.username);
        await page.getByRole("button", { name: /查询/ }).click();
        const row = page.getByRole("row").filter({ hasText: state.enterpriseA.owner.username });
        await visible(row, "企业搜索结果未显示");
        await visible(row.getByText(state.enterpriseA.name, { exact: true }), "企业名称未显示");
        await shot("01-admin-enterprises");

        await page.getByRole("button", { name: /创建企业/ }).click();
        const createDialog = page.getByRole("dialog", { name: "创建企业" });
        await visible(createDialog.getByRole("textbox", { name: "企业名称" }), "创建企业表单缺少企业名称");
        await visible(createDialog.getByRole("textbox", { name: "主账号用户名" }), "创建企业表单缺少主账号用户名");
        await createDialog.getByRole("button", { name: /取\s*消/ }).click();

        await row.getByRole("button").first().click();
        const creditDialog = page.getByRole("dialog", { name: new RegExp(`调整主账号积分.*${state.enterpriseA.owner.username}`) });
        await visible(creditDialog.getByRole("spinbutton", { name: "调整数量" }), "积分调整表单缺少数量");
        await visible(creditDialog.getByText("最近平台调整", { exact: true }), "积分调整记录未显示");
        await creditDialog.getByRole("button", { name: /关\s*闭/ }).click();
    });

    await record("UI-002 主账号账户设置、成员和积分操作", async () => {
        await logout();
        await login(state.enterpriseA.owner.username, state.enterpriseA.owner.password);
        await visible(page.getByRole("link", { name: "企业素材库" }), "主账号未显示企业素材库导航");
        await page.getByRole("button", { name: "账户菜单" }).click();
        await page.getByRole("link", { name: "账户设置" }).click();
        await visible(page.getByRole("heading", { name: "企业成员" }), "主账号未显示成员管理");
        await visible(page.getByRole("heading", { name: "企业积分流水" }), "主账号未显示企业积分流水");
        await visible(page.getByText(state.enterpriseA.name, { exact: true }), "企业概况名称不正确");
        const membersSection = page.getByRole("heading", { name: "企业成员" }).locator("xpath=ancestor::section");
        const memberRow = membersSection.getByRole("row").filter({ hasText: state.memberA.username }).first();
        await visible(memberRow, "成员列表未显示测试成员");
        await shot("02-owner-account");

        await memberRow.getByRole("button", { name: "分配积分" }).click();
        let dialog = page.getByRole("dialog", { name: /^分配积分/ });
        await dialog.getByRole("spinbutton", { name: "积分数量" }).fill("1");
        await dialog.getByRole("button", { name: "确认分配" }).click();
        await visible(page.getByText("积分分配成功", { exact: true }), "积分分配未成功");

        await memberRow.getByRole("button", { name: "收回积分" }).click();
        dialog = page.getByRole("dialog", { name: /^收回积分/ });
        await dialog.getByRole("spinbutton", { name: "积分数量" }).fill("1");
        await dialog.getByRole("button", { name: "确认收回" }).click();
        await visible(page.getByText("积分收回成功", { exact: true }), "积分收回未成功");
    });

    await record("UI-003 主账号新增、复制、删除企业文本素材", async () => {
        await page.goto(`${baseUrl}/enterprise-assets`);
        await visible(page.getByRole("button", { name: /新增企业素材/ }), "主账号未显示新增企业素材按钮");
        await page.getByRole("button", { name: /新增企业素材/ }).click();
        const dialog = page.getByRole("dialog", { name: "新增企业素材" });
        await dialog.getByRole("textbox", { name: "标题" }).fill(uiCreatedTitle);
        await dialog.getByRole("textbox", { name: "文本内容" }).fill(`Playwright 创建的文本素材 ${state.suffix}`);
        await dialog.getByRole("button", { name: /保\s*存/ }).click();
        await visible(page.getByText("企业素材已新增", { exact: true }), "企业素材新增未成功");
        await searchEnterpriseAsset(uiCreatedTitle);
        const card = page.locator(".ant-card").filter({ hasText: uiCreatedTitle });
        await card.getByRole("button", { name: /加入我的素材/ }).click();
        await visible(page.getByText(new RegExp(`“${uiCreatedTitle}”已加入我的素材`)), "主账号复制企业素材未成功");
        await page.goto(`${baseUrl}/assets`);
        await visible(page.getByText(uiCreatedTitle, { exact: true }), "个人素材页未显示主账号副本");

        await page.goto(`${baseUrl}/enterprise-assets`);
        await searchEnterpriseAsset(uiCreatedTitle);
        await page.getByRole("button", { name: `删除${uiCreatedTitle}` }).click();
        await page.getByRole("button", { name: "删 除", exact: true }).click();
        await visible(page.getByText("企业素材已删除", { exact: true }), "企业素材删除未成功");
        await page.goto(`${baseUrl}/assets`);
        await visible(page.getByText(uiCreatedTitle, { exact: true }), "删除源素材后个人副本消失");
        await shot("03-owner-personal-copy");
    });

    await record("UI-004 移动端企业导航", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${baseUrl}/account`);
        await page.getByRole("button", { name: "打开导航菜单" }).click();
        await visible(page.getByRole("link", { name: "企业素材库" }), "移动端未显示企业素材库导航");
        await shot("04-mobile-enterprise-nav");
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await record("UI-005 成员只读权限与复制到个人素材", async () => {
        await logout();
        await login(state.memberA.username, state.memberA.password);
        await page.goto(`${baseUrl}/account`);
        await visible(page.getByText("企业成员", { exact: true }), "成员企业身份未显示");
        await absent(page.getByRole("button", { name: "创建成员" }), "成员错误显示创建成员按钮");
        await absent(page.getByRole("heading", { name: "企业积分流水" }), "成员错误显示企业积分流水");
        await shot("05-member-account");

        await page.goto(`${baseUrl}/enterprise-assets`);
        await visible(page.getByText("只读成员", { exact: true }), "成员页面未显示只读标识");
        await absent(page.getByRole("button", { name: /新增企业素材/ }), "成员错误显示新增企业素材按钮");
        await searchEnterpriseAsset(state.uiAsset.title);
        const card = page.locator(".ant-card").filter({ hasText: state.uiAsset.title });
        await card.getByRole("button", { name: /加入我的素材/ }).click();
        await visible(page.getByText(new RegExp(`“${state.uiAsset.title}”已加入我的素材`)), "成员复制企业素材未成功");
        await page.goto(`${baseUrl}/assets`);
        await visible(page.getByText(state.uiAsset.title, { exact: true }).first(), "成员个人素材页未显示副本");
        await shot("06-member-personal-copy");
    });

    await record("UI-006 切换到个人账号后企业入口与上一账号素材消失", async () => {
        await logout();
        await login(state.personal.username, state.personal.password);
        await absent(page.getByRole("link", { name: "企业素材库" }), "个人账号错误显示企业素材库导航");
        await page.goto(`${baseUrl}/account`);
        await absent(page.getByRole("heading", { name: "企业概况" }), "个人账号错误显示企业概况");
        await absent(page.getByText(state.enterpriseA.name, { exact: true }), "个人账号展示上一企业信息");
        await page.goto(`${baseUrl}/assets`);
        await page.waitForTimeout(1000);
        await absent(page.getByText(state.uiAsset.title, { exact: true }).first(), "个人账号展示上一成员的个人素材");
        await page.goto(`${baseUrl}/enterprise-assets`);
        await visible(page.getByText("无权限访问企业素材库", { exact: true }), "个人账号直接访问未显示 403");
        await shot("07-personal-forbidden");
    });

    return { total: results.length, passed: results.filter((item) => item.status === "PASS").length, failed: results.filter((item) => item.status === "FAIL").length, results, uiCreatedTitle };
}
