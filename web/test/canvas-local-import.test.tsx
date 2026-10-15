import "./register-dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import axios from "axios";
import i18n from "@/i18n";
import { useCanvasStore, type CanvasProject } from "@/pages/canvas/stores/use-canvas-store";
import { clearSyncTimers } from "@/pages/canvas/stores/canvas-sync";
import { CanvasNodeType } from "@/pages/canvas/types";
import { useUserStore } from "@/stores/use-user-store";

Object.assign(globalThis, { __APP_VERSION__: "test", IS_REACT_ACT_ENVIRONMENT: true });
const { default: CanvasPage } = await import("@/pages/canvas/project/index");
await i18n.changeLanguage("zh-CN");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=", "base64");
const mediaFormats = [
    {
        kind: "images",
        nodeType: CanvasNodeType.Image,
        extensions: {
            apng: "image/apng",
            avif: "image/avif",
            bmp: "image/bmp",
            gif: "image/gif",
            heic: "image/heic",
            heif: "image/heif",
            ico: "image/vnd.microsoft.icon",
            jfif: "image/jpeg",
            jpe: "image/jpeg",
            jpeg: "image/jpeg",
            jpg: "image/jpeg",
            png: "image/png",
            svg: "image/svg+xml",
            tif: "image/tiff",
            tiff: "image/tiff",
            webp: "image/webp",
        },
    },
    {
        kind: "videos",
        nodeType: CanvasNodeType.Video,
        extensions: {
            mp4: "video/mp4",
            m4v: "video/mp4",
            webm: "video/webm",
            mov: "video/quicktime",
            qt: "video/quicktime",
            mkv: "video/x-matroska",
            avi: "video/x-msvideo",
            mpeg: "video/mpeg",
            mpg: "video/mpeg",
            ogv: "video/ogg",
            wmv: "video/x-ms-wmv",
            flv: "video/x-flv",
            "3gp": "video/3gpp",
            "3g2": "video/3gpp2",
            ts: "video/mp2t",
            mts: "video/mp2t",
            m2ts: "video/mp2t",
        },
    },
    {
        kind: "audios",
        nodeType: CanvasNodeType.Audio,
        extensions: {
            mp3: "audio/mpeg",
            wav: "audio/wav",
            m4a: "audio/mp4",
            m4b: "audio/mp4",
            aac: "audio/aac",
            ogg: "audio/ogg",
            oga: "audio/ogg",
            opus: "audio/ogg",
            flac: "audio/flac",
            aif: "audio/x-aiff",
            aiff: "audio/x-aiff",
            aifc: "audio/x-aiff",
            wma: "audio/x-ms-wma",
            amr: "audio/amr",
            weba: "audio/webm",
            au: "audio/basic",
            snd: "audio/basic",
            caf: "audio/x-caf",
        },
    },
] as const;

for (const { kind, nodeType, extensions } of mediaFormats) {
    for (const sourceMime of ["", "application/octet-stream", "binary/octet-stream"]) {
        test(`common ${kind} extensions with ${sourceMime || "empty MIME"} upload and persist as ${kind}`, async () => {
            await withCanvas(async ({ drop, uploads, uploadTypes }) => {
                const formats = Object.entries(extensions);
                const files = formats.map(([extension]) => new File([`bytes:${extension}`], `local.${extension.toUpperCase()}`, { type: sourceMime, lastModified: 123456789 }));
                await drop(files);
                await waitFor(() => useCanvasStore.getState().openProject("import-project")?.nodes.length === files.length + 1);
                assert.deepEqual(
                    uploadTypes,
                    files.map(() => kind),
                );
                await useCanvasStore.getState().waitForLocalPersistence();
                const saved = await useCanvasStore.persist.getOptions().storage!.getItem("infinite-canvas:canvas_store");
                const nodes = saved?.state.projects.find((project) => project.id === "import-project")?.nodes || [];
                for (let index = 0; index < files.length; index++) {
                    assert.equal(uploads[index].name, files[index].name);
                    assert.equal(uploads[index].type, formats[index][1]);
                    assert.deepEqual(await uploads[index].arrayBuffer(), await files[index].arrayBuffer());
                    const node = nodes.find((node) => node.title === files[index].name);
                    assert.equal(node?.type, nodeType);
                    assert.equal(node?.metadata?.fileId, `imported-${index + 1}`);
                    assert.equal(node?.metadata?.mimeType, formats[index][1]);
                    assert.equal(node?.metadata?.bytes, files[index].size);
                }
            });
        });
    }
}

test("generic container MIME uses OGG and MP4 family extensions to distinguish audio and video", async () => {
    await withCanvas(async ({ drop, uploads, uploadTypes }) => {
        const containers = [
            ["ogv", "application/ogg", "video/ogg", CanvasNodeType.Video],
            ["ogg", "application/ogg", "audio/ogg", CanvasNodeType.Audio],
            ["oga", "application/ogg", "audio/ogg", CanvasNodeType.Audio],
            ["opus", "application/ogg", "audio/ogg", CanvasNodeType.Audio],
            ["mp4", "application/mp4", "video/mp4", CanvasNodeType.Video],
            ["m4v", "application/mp4", "video/mp4", CanvasNodeType.Video],
            ["m4a", "application/mp4", "audio/mp4", CanvasNodeType.Audio],
            ["m4b", "application/mp4", "audio/mp4", CanvasNodeType.Audio],
        ] as const;
        const files = containers.map(([extension, type]) => new File([`container:${extension}`], `local.${extension.toUpperCase()}`, { type }));
        await drop(files);
        await waitFor(() => useCanvasStore.getState().openProject("import-project")?.nodes.length === files.length + 1);
        assert.deepEqual(
            uploadTypes,
            containers.map((item) => (item[3] === CanvasNodeType.Video ? "videos" : "audios")),
        );
        for (let index = 0; index < files.length; index++) {
            assert.equal(uploads[index].name, files[index].name);
            assert.equal(uploads[index].type, containers[index][2]);
            assert.deepEqual(await uploads[index].arrayBuffer(), await files[index].arrayBuffer());
            const node = useCanvasStore
                .getState()
                .openProject("import-project")
                ?.nodes.find((node) => node.title === files[index].name);
            assert.equal(node?.type, containers[index][3]);
            assert.equal(node?.metadata?.fileId, `imported-${index + 1}`);
        }
    });
});

test("an explicit media MIME overrides a misleading extension while a non-media MIME is rejected", async () => {
    await withCanvas(async ({ drop, uploads, uploadTypes }) => {
        await drop([new File([png], "picture.MP3", { type: "image/png" }), new File(["video"], "video.WAV", { type: "video/mp2t" }), new File(["audio"], "audio.PNG", { type: "audio/ogg" }), new File(["notes"], "notes.MP3", { type: "text/plain" })]);
        await waitFor(() => useCanvasStore.getState().openProject("import-project")?.nodes.length === 4);
        assert.deepEqual(uploadTypes, ["images", "videos", "audios"]);
        assert.deepEqual(
            uploads.map((file) => file.type),
            ["image/png", "video/mp2t", "audio/ogg"],
        );
        assert.deepEqual(
            uploads.map((file) => file.name),
            ["picture.MP3", "video.WAV", "audio.PNG"],
        );
    });
});

test("unrecognized extensions, explicit non-media MIME and mismatched container families are rejected", async () => {
    await withCanvas(async ({ drop, choose, uploads }) => {
        const files = [
            new File(["unknown"], "media.bin"),
            new File(["unknown"], "mp4", { type: "binary/octet-stream" }),
            new File(["notes"], "notes.WAV", { type: "text/plain" }),
            new File(["notes"], "notes.PNG", { type: "application/pdf" }),
            new File(["ogg"], "media.MP4", { type: "application/ogg" }),
            new File(["mp4"], "media.OPUS", { type: "application/mp4" }),
            new File(["ogg"], "media.bin", { type: "application/ogg" }),
        ];
        await drop(files);
        for (const file of files) await choose(file);
        assert.equal(uploads.length, 0);
        assert.equal(useCanvasStore.getState().openProject("import-project")?.nodes.length, 1);
    });
});

test("the file picker exposes all common extensions and uses their normalized upload types", async () => {
    await withCanvas(async ({ host, choose, uploads, uploadTypes }) => {
        const accepted = host.querySelector<HTMLInputElement>('input[type="file"]')?.accept.split(",");
        assert.ok(accepted?.includes("audio/*"));
        for (const { extensions } of mediaFormats) for (const extension of Object.keys(extensions)) assert.ok(accepted?.includes(`.${extension}`), `the picker accepts .${extension}`);
        const files = [new File(["video"], "video.MOV"), new File(["audio"], "voice.AMR", { type: "application/octet-stream" }), new File(["audio"], "voice.OPUS", { type: "application/ogg" }), new File(["audio"], "book.M4B", { type: "application/mp4" })];
        for (const file of files) await choose(file);
        await waitFor(() => useCanvasStore.getState().openProject("import-project")?.nodes.length === files.length + 1);
        assert.deepEqual(uploadTypes, ["videos", "audios", "audios", "audios"]);
        assert.deepEqual(
            uploads.map((file) => file.type),
            ["video/quicktime", "audio/amr", "audio/ogg", "audio/mp4"],
        );
        for (let index = 0; index < files.length; index++) {
            assert.equal(uploads[index].name, files[index].name);
            assert.deepEqual(await uploads[index].arrayBuffer(), await files[index].arrayBuffer());
            assert.equal(
                useCanvasStore
                    .getState()
                    .openProject("import-project")
                    ?.nodes.find((node) => node.title === files[index].name)?.metadata?.fileId,
                `imported-${index + 1}`,
            );
        }
    });
});

test("failed video and audio uploads do not persist local-path-only nodes", async () => {
    await withCanvas(async ({ drop, uploads }) => {
        await drop([new File(["video"], "failed.MP4"), new File(["audio"], "failed.M4A", { type: "application/mp4" })]);
        await waitFor(() => uploads.length === 2 && Boolean(document.body.textContent?.includes("storage unavailable")));
        await useCanvasStore.getState().waitForLocalPersistence();
        const saved = await useCanvasStore.persist.getOptions().storage!.getItem("infinite-canvas:canvas_store");
        assert.equal(saved?.state.projects.find((project) => project.id === "import-project")?.nodes.length, 1);
    }, true);
});

for (const mimeType of ["image/png", "", "application/octet-stream"]) {
    test(`a local PNG drop (MIME=${mimeType || "empty"}) uploads bytes and restores the persisted fileId`, async () => {
        await withCanvas(async ({ host, drop, uploads, remount, images }) => {
            await drop([new File([png], "local.PNG", { type: mimeType, lastModified: 123456789 })]);
            await waitFor(() => images().length === 1);
            assert.equal(uploads.length, 1);
            assert.equal(uploads[0].name, "local.PNG");
            assert.equal(uploads[0].type, "image/png");
            assert.deepEqual(Buffer.from(await uploads[0].arrayBuffer()), png);
            assert.equal(images()[0].metadata?.fileId, "imported-1");
            assert.equal(images()[0].metadata?.content, "https://media.example/imported-1.png");
            assert.equal(images()[0].metadata?.mimeType, "image/png");
            assert.equal(images()[0].width / images()[0].height, 2);
            await useCanvasStore.getState().waitForLocalPersistence();
            const saved = await useCanvasStore.persist.getOptions().storage!.getItem("infinite-canvas:canvas_store");
            assert.equal(saved?.state.projects.find((project) => project.id === "import-project")?.nodes.find((node) => node.type === CanvasNodeType.Image)?.metadata?.fileId, "imported-1");
            await remount();
            await waitFor(() => Boolean(host.querySelector('img[src="https://media.example/refreshed-imported-1.png"]')));
            assert.equal(uploads.length, 1, "opening the saved project refreshes its URL without uploading again");
        });
    });
}

test("one drop imports every local image and ignores unsupported files", async () => {
    await withCanvas(async ({ drop, uploads, images }) => {
        await drop([new File(["notes"], "notes.png", { type: "text/plain" }), new File([png], "png"), new File([png], "unknown.txt"), new File([png], "first.png", { type: "image/png" }), new File([png], "second.png", { type: "image/png" })]);
        await waitFor(() => images().length === 2);
        assert.deepEqual(
            uploads.map((file) => file.name),
            ["first.png", "second.png"],
        );
        assert.deepEqual(
            images().map((node) => node.metadata?.fileId),
            ["imported-1", "imported-2"],
        );
    });
});

test("mixed image, video and audio drops keep their existing upload types and bytes", async () => {
    await withCanvas(async ({ drop, uploads, uploadTypes }) => {
        const files = [new File([png], "image.png", { type: "image/png" }), new File(["video-bytes"], "video.mp4", { type: "video/mp4" }), new File(["audio-bytes"], "audio.mp3", { type: "audio/mpeg" })];
        await drop(files);
        await waitFor(() => useCanvasStore.getState().openProject("import-project")?.nodes.length === 4);
        assert.deepEqual(uploadTypes, ["images", "videos", "audios"]);
        for (let index = 0; index < files.length; index++) {
            assert.equal(uploads[index].name, files[index].name);
            assert.equal(uploads[index].type, files[index].type);
            assert.deepEqual(await uploads[index].arrayBuffer(), await files[index].arrayBuffer());
            const node = useCanvasStore
                .getState()
                .openProject("import-project")
                ?.nodes.find((node) => node.title === files[index].name);
            assert.equal(node?.metadata?.fileId, `imported-${index + 1}`);
            assert.equal(node?.type, [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio][index]);
        }
    });
});

test("an upload completed after switching projects cannot attach to either canvas", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await withCanvas(
        async ({ drop, uploads, images, switchProject }) => {
            await drop([new File([png], "late.png", { type: "image/png" })]);
            await waitFor(() => uploads.length === 1);
            await switchProject();
            await act(async () => {
                release();
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            assert.equal(images().length, 0);
            assert.equal(
                useCanvasStore
                    .getState()
                    .openProject("other-project")
                    ?.nodes.some((node) => node.type === CanvasNodeType.Image),
                false,
            );
        },
        false,
        gate,
    );
});

test("an upload completed after switching accounts cannot persist in the new account", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await withCanvas(
        async ({ drop, uploads }) => {
            await drop([new File([png], "late-account.png", { type: "image/png" })]);
            await waitFor(() => uploads.length === 1);
            await act(async () => {
                useUserStore.setState({ token: "other-token", user: { id: "other-user" } as ReturnType<typeof useUserStore.getState>["user"] });
                release();
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            assert.ok(useCanvasStore.getState().projects.every((project) => project.nodes.every((node) => node.metadata?.fileId !== "imported-1")));
        },
        false,
        gate,
    );
});

test("the local file picker shares image MIME normalization and platform persistence", async () => {
    await withCanvas(async ({ choose, uploads, images }) => {
        await choose(new File([png], "chosen.PNG", { type: "application/octet-stream" }));
        await waitFor(() => images().length === 1);
        assert.equal(uploads[0].name, "chosen.PNG");
        assert.equal(uploads[0].type, "image/png");
        assert.deepEqual(Buffer.from(await uploads[0].arrayBuffer()), png);
        assert.equal(images()[0].metadata?.fileId, "imported-1");
    });
});

test("a rejected image does not block another file in the same drop", async () => {
    await withCanvas(async ({ drop, uploads, images }) => {
        await drop([new File([png], "failed.png", { type: "image/png" }), new File([png], "second.png", { type: "image/png" })]);
        await waitFor(() => images().length === 1);
        assert.equal(uploads.length, 2);
        assert.equal(images()[0].title, "second.png");
        assert.equal(images()[0].metadata?.fileId, "imported-2");
    }, true);
});

test("an upload failure does not persist a local-path-only image node", async () => {
    await withCanvas(async ({ drop, uploads, images }) => {
        await drop([new File([png], "failed.png", { type: "image/png" })]);
        await waitFor(() => document.body.textContent?.includes("storage unavailable") || false);
        assert.equal(uploads.length, 1);
        assert.equal(images().length, 0);
        await useCanvasStore.getState().waitForLocalPersistence();
        const saved = await useCanvasStore.persist.getOptions().storage!.getItem("infinite-canvas:canvas_store");
        assert.equal(
            saved?.state.projects.find((project) => project.id === "import-project")?.nodes.some((node) => node.type === CanvasNodeType.Image),
            false,
        );
    }, true);
});

async function withCanvas(
    run: (fixture: {
        host: HTMLDivElement;
        drop: (files: File[]) => Promise<void>;
        choose: (file: File) => Promise<void>;
        uploads: File[];
        uploadTypes: string[];
        images: () => CanvasProject["nodes"];
        remount: () => Promise<void>;
        switchProject: () => Promise<void>;
    }) => Promise<void>,
    failUpload = false,
    uploadGate?: Promise<void>,
) {
    const originalUser = useUserStore.getState();
    const originalAdapter = axios.defaults.adapter;
    const originalFetch = globalThis.fetch;
    const originalImage = globalThis.Image;
    const originalCreateElement = document.createElement;
    const uploads: File[] = [];
    const uploadTypes: string[] = [];
    document.createElement = function (...args: Parameters<typeof document.createElement>) {
        const element = originalCreateElement.apply(this, args);
        if (args[0] === "video" || args[0] === "audio") {
            Object.defineProperties(element, { videoWidth: { value: 640 }, videoHeight: { value: 320 }, duration: { value: 1.25 } });
            queueMicrotask(() => element.dispatchEvent(new Event("loadedmetadata")));
        }
        return element;
    } as typeof document.createElement;
    globalThis.Image = class {
        naturalWidth = 640;
        naturalHeight = 320;
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
            queueMicrotask(() => this.onload?.());
        }
    } as unknown as typeof Image;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url === "/api/v1/files" && init?.method === "POST") {
            assert.equal(new Headers(init.headers).get("Authorization"), "Bearer import-token");
            const form = init.body as FormData;
            const kind = String(form.get("fileType"));
            assert.ok(["images", "videos", "audios"].includes(kind));
            uploadTypes.push(kind);
            uploads.push(form.get("file") as File);
            const uploaded = uploads.at(-1)!;
            const id = `imported-${uploads.length}`;
            await uploadGate;
            return Response.json(failUpload && uploaded.name.startsWith("failed.") ? { code: 1, msg: "storage unavailable" } : { code: 0, data: { id, url: `https://media.example/${id}.png`, mimeType: uploaded.type, bytes: uploaded.size } });
        }
        if (url.startsWith("/api/v1/files/imported-")) return Response.json({ code: 0, data: { url: `https://media.example/refreshed-${url.split("/").pop()}.png` } });
        return Response.json({ code: 0, data: { items: [], total: 0 } });
    };
    axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: config.url === "/api/v1/model-profiles" ? [] : { items: [], total: 0 } } });
    useUserStore.setState({ token: "", user: { id: "import-user" } as typeof originalUser.user });
    await useCanvasStore.persist.rehydrate();
    const project: CanvasProject = {
        id: "import-project",
        title: "图片导入",
        createdAt: "",
        updatedAt: "",
        revision: 1,
        localVersion: 0,
        dirty: false,
        nodes: [{ id: "seed", type: CanvasNodeType.Text, title: "文本", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "用于定位画布容器" } }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
    useCanvasStore.setState({ hydrated: true, synced: true, projects: [project, { ...project, id: "other-project", title: "另一画布" }], tombstones: [] });
    useUserStore.setState({ token: "import-token" });
    const host = document.createElement("div");
    document.body.append(host);
    let root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mount = async () => {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <MemoryRouter initialEntries={["/canvas/import-project"]}>
                        <App>
                            <Link to="/canvas/other-project">切换画布</Link>
                            <Routes>
                                <Route path="/canvas/:id" element={<CanvasPage />} />
                                <Route path="/canvas" element={<div>画布列表</div>} />
                            </Routes>
                        </App>
                    </MemoryRouter>
                </QueryClientProvider>,
            ),
        );
        await waitFor(() => Boolean(host.querySelector('[data-node-id="seed"]')));
    };
    try {
        await mount();
        await run({
            host,
            uploads,
            uploadTypes,
            images: () =>
                useCanvasStore
                    .getState()
                    .openProject(project.id)
                    ?.nodes.filter((node) => node.type === CanvasNodeType.Image) || [],
            choose: async (file) => {
                const input = host.querySelector<HTMLInputElement>('input[type="file"]');
                assert.ok(input);
                Object.defineProperty(input, "files", { configurable: true, value: [file] });
                await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
            },
            drop: async (files) => {
                const canvas = host.querySelector('[data-node-id="seed"]')?.parentElement?.parentElement;
                assert.ok(canvas);
                const event = new Event("drop", { bubbles: true, cancelable: true });
                Object.assign(event, { dataTransfer: { files }, clientX: 400, clientY: 300 });
                await act(async () => canvas.dispatchEvent(event));
                assert.ok(event.defaultPrevented);
            },
            remount: async () => {
                await act(async () => root.unmount());
                clearSyncTimers();
                await useCanvasStore.persist.rehydrate();
                useCanvasStore.setState({ hydrated: true, synced: true });
                root = createRoot(host);
                await mount();
            },
            switchProject: async () => {
                const link = host.querySelector<HTMLAnchorElement>('a[href="/canvas/other-project"]');
                assert.ok(link);
                await act(async () => {
                    link.click();
                    await new Promise((resolve) => setTimeout(resolve, 30));
                });
            },
        });
    } finally {
        await act(async () => root.unmount());
        client.clear();
        clearSyncTimers();
        host.remove();
        axios.defaults.adapter = originalAdapter;
        useUserStore.setState(originalUser, true);
        globalThis.fetch = originalFetch;
        globalThis.Image = originalImage;
        document.createElement = originalCreateElement;
    }
}

async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (check()) return;
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
    assert.ok(check(), "the expected import result became visible and durable");
}
