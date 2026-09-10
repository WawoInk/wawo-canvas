import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const configModule = new URL("../src/config.ts", import.meta.url).href;
const tsx = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href;

function inTemporaryHome(run: (home: string, execute: (code: string) => void) => void) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
    try {
        run(home, (code) => execFileSync(process.execPath, ["--import", tsx, "--input-type=module", "-e", `import {saveConfig, loadConfig} from ${JSON.stringify(configModule)}; ${code}`], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: "pipe" }));
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}

test("saving configuration creates owner-only directory and file", { skip: process.platform === "win32" }, () => {
    inTemporaryHome((home, execute) => {
        execute('process.umask(0); saveConfig({url: "http://127.0.0.1:17371", token: "fake-config-token"});');
        const dir = path.join(home, ".infinite-canvas");
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(path.join(dir, "canvas-agent.json")).mode & 0o777, 0o600);
    });
});

test("saving configuration tightens existing permissive paths without replacing credentials", { skip: process.platform === "win32" }, () => {
    inTemporaryHome((home, execute) => {
        const dir = path.join(home, ".infinite-canvas");
        const file = path.join(dir, "canvas-agent.json");
        fs.mkdirSync(dir);
        fs.writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:17371", token: "fake-config-token" }));
        fs.chmodSync(dir, 0o755);
        fs.chmodSync(file, 0o644);
        execute('saveConfig(loadConfig());');
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, "fake-config-token");
    });
});

test("loading existing configuration also tightens permissions without changing its contents", { skip: process.platform === "win32" }, () => {
    inTemporaryHome((home, execute) => {
        const dir = path.join(home, ".infinite-canvas");
        const file = path.join(dir, "canvas-agent.json");
        fs.mkdirSync(dir);
        const contents = '{"url":"http://127.0.0.1:17371","token":"fake-config-token"}';
        fs.writeFileSync(file, contents);
        fs.chmodSync(dir, 0o755);
        fs.chmodSync(file, 0o644);
        execute('loadConfig();');
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(fs.readFileSync(file, "utf8"), contents);
    });
});

test("saving configuration applies exact owner permissions even with a restrictive umask", { skip: process.platform === "win32" }, () => {
    inTemporaryHome((home, execute) => {
        execute('process.umask(0o777); saveConfig({url: "http://127.0.0.1:17371", token: "fake-config-token"});');
        const dir = path.join(home, ".infinite-canvas");
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(path.join(dir, "canvas-agent.json")).mode & 0o777, 0o600);
    });
});
