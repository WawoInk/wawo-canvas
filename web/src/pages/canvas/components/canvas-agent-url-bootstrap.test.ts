import assert from "node:assert/strict";
import test from "node:test";
import { consumeAgentUrlBootstrap } from "./canvas-agent-url-bootstrap.ts";

test("fragment credentials are consumed once and removed before the caller can connect", () => {
    const location = new URL("https://canvas.example/canvas/project/1?mode=new#agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=fake-fragment-token&tab=chat");
    const state = { idx: 2, key: "test-route" };
    const history = {
        state,
        replaceState(nextState: unknown, _title: string, url?: string | URL | null) {
            assert.equal(nextState, state);
            location.href = new URL(String(url), location).href;
        },
    };
    const bootstrap = consumeAgentUrlBootstrap(location, history);
    assert.equal(location.href, "https://canvas.example/canvas/project/1?mode=new#tab=chat");
    assert.deepEqual(bootstrap, { url: "http://127.0.0.1:17371", token: "fake-fragment-token" });
    assert.equal(consumeAgentUrlBootstrap(location, history), null);
});

test("partial and duplicate fragment credentials are still cleared, while query credentials are never consumed", () => {
    for (const fragment of ["#agentToken=fake-only-token", "#agentUrl=javascript%3Afake&agentToken=fake-one&agentToken=fake-two", "#agentUrl=&agentToken="]) {
        const location = new URL(`https://canvas.example/canvas?mode=choose${fragment}`);
        const history = {
            state: null,
            replaceState(_state: unknown, _title: string, url?: string | URL | null) {
                location.href = new URL(String(url), location).href;
            },
        };
        assert.notEqual(consumeAgentUrlBootstrap(location, history), null);
        assert.equal(location.href, "https://canvas.example/canvas?mode=choose");
    }
    const location = new URL("https://canvas.example/canvas?agentUrl=http://127.0.0.1:17371&agentToken=fake-query-token#help");
    assert.equal(
        consumeAgentUrlBootstrap(location, {
            state: null,
            replaceState() {
                assert.fail("query credentials must not bootstrap a connection");
            },
        }),
        null,
    );
});
