"use client";

export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}

export function fitNodeToAspect(node: { position: { x: number; y: number }; width: number; height: number; metadata?: { freeResize?: boolean } }, naturalWidth: number, naturalHeight: number) {
    if (node.metadata?.freeResize || !naturalWidth || !naturalHeight) return { position: node.position, width: node.width, height: node.height };
    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
    const longest = Math.max(node.width, node.height);
    const ratio = naturalWidth / naturalHeight;
    const width = ratio >= 1 ? longest : longest * ratio;
    const height = ratio >= 1 ? longest / ratio : longest;
    return { position: { x: center.x - width / 2, y: center.y - height / 2 }, width, height };
}
