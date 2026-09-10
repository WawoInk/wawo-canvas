import type { ChildProcess } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

/** Redact complete stderr lines before forwarding them to browser or terminal sinks. */
export function pipeAgentStderr(child: ChildProcess, emit: (text: string) => void) {
    let buffer = "";
    const send = (text: string) => emit(stripVTControlCharacters(text)
        .replace(/(authorization["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi, "$1[REDACTED]")
        .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/((?:api[ _-]*key|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]"));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (text: string) => {
        buffer += text;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            send(buffer.slice(0, newline + 1));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    });
    child.once("close", () => {
        if (buffer) send(buffer);
        buffer = "";
    });
}
