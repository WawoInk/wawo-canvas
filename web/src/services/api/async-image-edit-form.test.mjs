import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAsyncImageEditFormData } from "./async-image-edit-form.ts";

test("builds the async image edit request as multipart form data", () => {
    const image = new File(["image-bytes"], "source.png", { type: "image/png" });
    const body = buildAsyncImageEditFormData({
        model: "gpt-image-2",
        prompt: "replace the background",
        image,
        n: 1,
        size: "1024x1024",
        output_format: "png",
    });

    assert.ok(body instanceof FormData);
    assert.equal(body.get("image"), image);
    assert.ok(body.get("image") instanceof File);
    assert.deepEqual(Object.fromEntries([...body].filter(([key]) => key !== "image")), {
        model: "gpt-image-2",
        prompt: "replace the background",
        n: "1",
        size: "1024x1024",
        output_format: "png",
    });
});
