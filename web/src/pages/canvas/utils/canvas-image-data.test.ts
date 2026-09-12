import { expect, test } from "bun:test";
import { useUserStore } from "@/stores/use-user-store";
import { cropDataUrl, splitDataUrl } from "./canvas-image-data";

class TestImage {
    width = 4;
    height = 4;
    naturalWidth = 4;
    naturalHeight = 4;
    onload?: () => void;
    onerror?: () => void;
    #src = "";

    set src(value: string) {
        this.#src = value;
        queueMicrotask(() => this.onload?.());
    }

    get src() {
        return this.#src;
    }
}

test("remote canvas images can be cropped and split without tainting the output", async () => {
    const originalState = useUserStore.getState();
    const originalGlobals = { Image: globalThis.Image, document: globalThis.document, fetch: globalThis.fetch };
    let drawnImage: TestImage | undefined;
    Object.assign(globalThis, {
        Image: TestImage,
        document: {
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => ({ drawImage: (image: TestImage) => (drawnImage = image) }),
                toDataURL: () => {
                    if (drawnImage?.src.startsWith("http")) throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
                    return "data:image/png;base64,b2s=";
                },
            }),
        },
        fetch: async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === "/api/v1/files/proxy-upload") return new Response(JSON.stringify({ code: 0, data: { id: "file-1", url: "https://cdn.example/image.png", bytes: 5, mimeType: "image/png" } }));
            if (url === "/api/v1/files/file-1/content") return new Response(new Blob(["image"], { type: "image/png" }));
            throw new Error(`Unexpected fetch: ${url}`);
        },
    });
    useUserStore.setState({ token: "test-token", user: { id: "user-1" } as typeof originalState.user });

    try {
        const source = "https://cdn.example/image.png";
        await expect(cropDataUrl(source, { x: 0, y: 0, width: 1, height: 1 })).resolves.toStartWith("data:image/png");
        await expect(splitDataUrl(source, { rows: 2, columns: 2 })).resolves.toHaveLength(4);
    } finally {
        Object.assign(globalThis, originalGlobals);
        useUserStore.setState(originalState, true);
    }
});
