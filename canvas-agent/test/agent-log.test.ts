import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeTurn } from "../src/agents.js";

test("CLI stderr reaching the browser is redacted across chunks and on exit; stdout is unchanged", { skip: process.platform === "win32", timeout: 5000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-cli-test-"));
    const originalPath = process.env.PATH;
    const events: Array<{ type: string; payload: unknown }> = [];
    try {
        fs.writeFileSync(path.join(dir, "claude"), `#!${process.execPath}\nprocess.stderr.write("\\x1b[31mAuthorization: Basic fake-");\nsetTimeout(() => { process.stderr.write("basic-value\\x1b[0m\\nBearer fake-bearer-value\\napi_key=sk-fake-key-12345678\\ntoken=fake-tail-token"); process.stdout.write(' {"type":"result","text":"unchanged output"}\\n'); }, 20);\n`, { mode: 0o700 });
        process.env.PATH = `${dir}${path.delimiter}${originalPath || ""}`;
        await new Promise<void>((resolve) => runClaudeTurn("fake prompt", (type, payload) => {
            events.push({ type, payload });
            if (type === "agent_done") resolve();
        }));
        const logs = events.filter((event) => event.type === "agent_log").map((event) => (event.payload as { text: string }).text).join("");
        assert.ok(!logs.includes("fake-"), "stderr credentials must not reach the browser");
        assert.equal(logs, "Authorization: [REDACTED]\nBearer [REDACTED]\napi_key=[REDACTED]\ntoken=[REDACTED]");
        assert.ok(events.some((event) => event.type === "agent_event" && (event.payload as { text?: string }).text === "unchanged output"));
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("terminal forwarding also removes JSON credential fields and ANSI split inside names", { timeout: 5000 }, async () => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const { pipeAgentStderr } = await import("../src/agent-log.js");
    const child = spawn(process.execPath, ["-e", `process.stderr.write('diagnostic: {"authorization": "Basic fake-json-basic", "api_key": "fake-json-key", "token": "fake-json-token"}\\n'); process.stderr.write('to\\x1b[32mken\\x1b[0m=fake-colored-token\\nnormal error: retry later\\n');`], { stdio: ["ignore", "ignore", "pipe"] });
    const terminal: string[] = [];
    pipeAgentStderr(child, (text) => terminal.push(text));
    await once(child, "close");
    assert.ok(!terminal.join("").includes("fake-"), "terminal sink must receive only redacted credentials");
    assert.ok(terminal.join("").includes("normal error: retry later\n"));
});
