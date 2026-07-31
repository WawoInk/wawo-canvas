import assert from "node:assert/strict";
import test from "node:test";

import { buildCsv, fetchAllPages } from "../src/pages/account/account-log-export.ts";

test("账户日志 CSV 保留中文并正确转义逗号、引号和换行", () => {
    const csv = buildCsv([{ title: "备注", value: (item: { remark: string }) => item.remark }], [{ remark: '包含,逗号和"引号"\n换行' }]);

    assert.equal(csv, '\uFEFF"备注"\r\n"包含,逗号和""引号""\n换行"');
});

test("账户日志导出会分页拉取全部筛选结果", async () => {
    const calls: Array<[number, number]> = [];
    const items = await fetchAllPages(async (page, pageSize) => {
        calls.push([page, pageSize]);
        return page === 1 ? { items: Array.from({ length: 500 }, (_, index) => index + 1), total: 501 } : { items: [501], total: 501 };
    });

    assert.equal(items.length, 501);
    assert.deepEqual(calls, [
        [1, 500],
        [2, 500],
    ]);
});
