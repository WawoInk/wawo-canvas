import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDir = resolve(process.argv[2] || ".");
const state = JSON.parse(await readFile(resolve(outputDir, "state.json"), "utf8"));
const results = [];

async function request(method, path, token, body) {
    const response = await fetch(`${state.baseUrl}${path}`, {
        method,
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json();
}

try {
    const admin = await request("POST", "/api/admin/login", "", state.admin);
    if (admin.code !== 0) throw new Error(admin.msg || "管理员登录失败");
    for (const enterprise of [state.enterpriseA, state.enterpriseB]) {
        if (!enterprise?.id) continue;
        const response = await request("POST", `/api/admin/enterprises/${enterprise.id}/status`, admin.data.token, { status: "disabled" });
        results.push({ enterpriseId: enterprise.id, status: response.code === 0 ? "PASS" : "FAIL", message: response.msg || "" });
    }
} catch (error) {
    results.push({ status: "FAIL", message: error instanceof Error ? error.message : String(error) });
}

await writeFile(resolve(outputDir, "cleanup-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results));
if (results.some((item) => item.status === "FAIL")) process.exitCode = 1;
