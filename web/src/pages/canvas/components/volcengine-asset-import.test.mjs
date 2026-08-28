import assert from "node:assert/strict";
import { test } from "node:test";

import { clearVolcengineMaterialMetadata, createVolcengineAssetNode, replaceWithVolcengineAsset } from "./volcengine-asset-import.ts";

const outbound = { id: "brand-library", name: "品牌素材库" };
const image = {
    Id: "asset-image-1",
    Name: "主视觉",
    URL: "https://cdn.example.com/hero.png",
    GroupId: "group-1",
    AssetType: "Image",
    Status: "Success",
    ProjectName: "brand",
    CreateTime: "",
    UpdateTime: "",
};

test("creates Volcengine nodes with the preview URL and source identifiers", () => {
    const node = createVolcengineAssetNode({ asset: image, outbound, id: "image-1", createdAt: "2026-08-28T00:00:00.000Z", position: { x: 500, y: 400 } });

    assert.equal(node.type, "image");
    assert.deepEqual(node.metadata, {
        content: image.URL,
        status: "success",
        materialSource: "volcengine",
        volcengineAssetId: image.Id,
        volcengineAssetOutboundId: outbound.id,
        volcengineAssetOutboundName: outbound.name,
    });
    assert.deepEqual(node.position, { x: 330, y: 280 });
    assert.equal(createVolcengineAssetNode({ asset: { ...image, AssetType: "Video" }, outbound, id: "video-1", createdAt: "2026-08-28T00:00:00.000Z", position: { x: 500, y: 400 } }).type, "video");
    assert.equal(createVolcengineAssetNode({ asset: { ...image, AssetType: "Audio" }, outbound, id: "audio-1", createdAt: "2026-08-28T00:00:00.000Z", position: { x: 500, y: 400 } }).type, "audio");
});

test("replaces local media without retaining a stale platform file reference", () => {
    const node = replaceWithVolcengineAsset(
        {
            id: "video-1",
            type: "video",
            title: "旧视频",
            position: { x: 100, y: 200 },
            width: 420,
            height: 236,
            metadata: { content: "https://s3.example.com/old.mp4", fileId: "file-1", storageKey: "", materialSource: "local", model: "keep-me" },
        },
        { ...image, Id: "asset-audio-1", Name: "旁白", URL: "https://cdn.example.com/voice.mp3", AssetType: "Audio" },
        outbound,
    );

    assert.equal(node.type, "audio");
    assert.equal(node.metadata.fileId, undefined);
    assert.equal(node.metadata.storageKey, undefined);
    assert.equal(node.metadata.content, "https://cdn.example.com/voice.mp3");
    assert.equal(node.metadata.materialSource, "volcengine");
    assert.equal(node.metadata.volcengineAssetId, "asset-audio-1");
    assert.equal(node.metadata.model, "keep-me");
});

test("clears Volcengine identifiers for local uploads", () => {
    assert.deepEqual(clearVolcengineMaterialMetadata({ materialSource: "volcengine", volcengineAssetId: "asset-1", volcengineAssetOutboundId: "library-1", volcengineAssetOutboundName: "素材库", fileId: "file-1" }), {
        materialSource: "local",
        fileId: "file-1",
    });
});
