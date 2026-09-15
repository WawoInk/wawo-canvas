import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { requestAudioGeneration } from "./audio.ts";

test("canvas audio generation uses the platform endpoint and explicit source", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: new Blob(["audio"], { type: "audio/mpeg" }) };
    };

    try {
        await requestAudioGeneration(
            { ...defaultConfig, channelMode: "remote", model: "admin-audio", audioModel: "admin-audio" },
            "旁白",
            { source: "canvas" },
        );
        assert.equal(request.url, "/api/v1/audio/speech");
        assert.equal(request.options.headers["X-Source"], "canvas");
    } finally {
        axios.post = previousPost;
    }
});
