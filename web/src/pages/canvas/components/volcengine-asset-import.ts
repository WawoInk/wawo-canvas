import type { VolcengineAsset, VolcengineAssetOutbound } from "@/services/api/volcengine-assets";

import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "../types";

type VolcengineNodeInput = {
    asset: VolcengineAsset;
    outbound: Pick<VolcengineAssetOutbound, "id" | "name">;
};

type CreateVolcengineNodeInput = VolcengineNodeInput & {
    id: string;
    createdAt: string;
    position: Position;
};

const volcengineMetadataFields = ["materialSource", "volcengineAssetId", "volcengineAssetOutboundId", "volcengineAssetOutboundName"] as const;
const replacedMediaFields = [
    "content",
    "status",
    "errorDetails",
    "naturalWidth",
    "naturalHeight",
    "storageKey",
    "fileId",
    "mimeType",
    "bytes",
    "durationMs",
    "freeResize",
    "isBatchRoot",
    "batchRootId",
    "batchChildIds",
    "batchUsesReferenceImages",
    "primaryImageId",
    "imageBatchExpanded",
    ...volcengineMetadataFields,
] as const;

function omitMetadata(metadata: CanvasNodeMetadata = {}, fields: readonly (keyof CanvasNodeMetadata)[]) {
    const next = { ...metadata };
    fields.forEach((field) => delete next[field]);
    return next;
}

export function volcengineAssetNodeType(asset: Pick<VolcengineAsset, "AssetType">) {
    return asset.AssetType === "Video" ? CanvasNodeType.Video : asset.AssetType === "Audio" ? CanvasNodeType.Audio : CanvasNodeType.Image;
}

export function clearVolcengineMaterialMetadata(metadata: CanvasNodeMetadata = {}): CanvasNodeMetadata {
    return { ...omitMetadata(metadata, volcengineMetadataFields), materialSource: "local" };
}

export function volcengineAssetMetadata({ asset, outbound }: VolcengineNodeInput): CanvasNodeMetadata {
    return {
        content: asset.URL,
        status: "success",
        materialSource: "volcengine",
        volcengineAssetId: asset.Id,
        volcengineAssetOutboundId: outbound.id,
        volcengineAssetOutboundName: outbound.name || outbound.id,
    };
}

export function createVolcengineAssetNode({ asset, outbound, id, createdAt, position }: CreateVolcengineNodeInput): CanvasNodeData {
    const type = volcengineAssetNodeType(asset);
    const size = NODE_DEFAULT_SIZE[type];
    return {
        id,
        createdAt,
        type,
        title: asset.Name || asset.Id,
        position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
        width: size.width,
        height: size.height,
        metadata: volcengineAssetMetadata({ asset, outbound }),
    };
}

export function replaceWithVolcengineAsset(node: CanvasNodeData, asset: VolcengineAsset, outbound: Pick<VolcengineAssetOutbound, "id" | "name">): CanvasNodeData {
    const type = volcengineAssetNodeType(asset);
    const size = NODE_DEFAULT_SIZE[type];
    return {
        ...node,
        type,
        title: asset.Name || asset.Id,
        position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
        width: size.width,
        height: size.height,
        metadata: { ...omitMetadata(node.metadata, replacedMediaFields), ...volcengineAssetMetadata({ asset, outbound }) },
    };
}
