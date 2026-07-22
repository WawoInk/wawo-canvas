import assert from "node:assert/strict";
import { test } from "node:test";

import { applyImageBackground, buildAsyncImageEditFormData } from "./async-image-edit-form.ts";
import { imageBackgroundFields } from "./image-background.ts";

test("only sends transparent image backgrounds", () => {
    assert.deepEqual(imageBackgroundFields("transparent"), { background: "transparent" });
    assert.deepEqual(imageBackgroundFields(""), {});
    const formData = new FormData();
    applyImageBackground(formData, "transparent");
    assert.equal(formData.get("background"), "transparent");
});

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

test("adds transparent background to multipart image edits", () => {
    const body = buildAsyncImageEditFormData({
        model: "gpt-image-2",
        prompt: "make a sticker",
        image: new File(["image-bytes"], "source.png", { type: "image/png" }),
        n: 1,
        background: "transparent",
        output_format: "png",
    });

    assert.equal(body.get("background"), "transparent");
});
