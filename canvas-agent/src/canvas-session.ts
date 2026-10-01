import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import { type ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import type { CanvasNode, CanvasNodeType, CanvasSnapshot } from "./types.js";

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ReplicaSession = { clients: Map<string, ServerResponse>; pending: Map<string, PendingRequest>; canvasState: CanvasSnapshot | null };

const DEFAULT_REPLICA_ID = "default";

export class CanvasSession {
    private replicas = new Map<string, ReplicaSession>();

    health() {
        const replicas = [...this.replicas.values()];
        return { ok: true, hasCanvas: replicas.some((replica) => Boolean(replica.canvasState)), clients: replicas.reduce((total, replica) => total + replica.clients.size, 0), replicas: replicas.length };
    }

    openEvents(url: URL, res: ServerResponse) {
        const replicaId = normalizeReplicaId(url.searchParams.get("canvasId"));
        const replica = this.getReplica(replicaId);
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        replica.clients.set(clientId, res);
        sendEvent(res, "hello", { ok: true, clientId, canvasId: replicaId });
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            const active = replica.clients.get(clientId) === res;
            if (active) replica.clients.delete(clientId);
            if (active && replica.canvasState?.clientId === clientId) replica.canvasState = null;
            this.cleanupReplica(replica);
        });
    }

    updateState(body: unknown, clientId?: string, replicaId?: string) {
        const snapshot = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
        const projectId = typeof snapshot.projectId === "string" ? snapshot.projectId.trim() : "";
        if (replicaId?.trim() && projectId && replicaId.trim() !== projectId) throw new Error("画布 Replica identity 不匹配");
        let id = normalizeReplicaId(replicaId || projectId);
        const legacy = !replicaId?.trim() && projectId ? this.replicas.get(DEFAULT_REPLICA_ID) : undefined;
        if (legacy?.clients.size) {
            const existing = this.replicas.get(projectId);
            const occupied = existing && existing !== legacy && (existing.clients.size || existing.canvasState || existing.pending.size);
            if (legacy.clients.size !== 1 || !clientId || !legacy.clients.has(clientId) || occupied) throw new Error("画布 state 缺少明确的 Replica identity");
            this.replicas.delete(DEFAULT_REPLICA_ID);
            this.replicas.set(projectId, legacy);
            id = projectId;
        }
        const replica = this.replicas.get(id);
        if (!clientId || !replica?.clients.has(clientId)) throw new Error("当前没有已连接画布客户端");
        replica.canvasState = { ...snapshot, clientId } as CanvasSnapshot;
    }

    resolveResult(body: { requestId?: string; error?: string; result?: unknown }, replicaId?: string) {
        if (!body.requestId) return;
        const explicitId = replicaId?.trim();
        const candidates = explicitId ? [this.replicas.get(explicitId)].filter(Boolean) as ReplicaSession[] : [...this.replicas.values()].filter((replica) => replica.pending.has(body.requestId!));
        if (candidates.length > 1) throw new Error("画布操作结果缺少明确的 Replica identity");
        const replica = candidates[0];
        const item = replica?.pending.get(body.requestId);
        if (explicitId && !item && [...this.replicas.values()].some((candidate) => candidate.pending.has(body.requestId!))) throw new Error("画布操作结果的 Replica identity 不匹配");
        if (!item || !body.requestId) return;
        replica.pending.delete(body.requestId);
        body.error ? item.reject(new Error(body.error)) : item.resolve(body.result);
        this.cleanupReplica(replica);
    }

    emit(replicaId: string, type: string, payload: unknown) {
        this.replicas.get(replicaId)?.clients.forEach((client) => sendEvent(client, type, payload));
    }

    emitter(replicaId?: string) {
        const id = replicaId?.trim() || this.resolveUniqueReplicaId();
        this.getReplica(id);
        return (type: string, payload: unknown) => this.emit(id, type, payload);
    }

    async callTool(name: unknown, rawInput: unknown, replicaId?: string) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        const id = replicaId?.trim() || this.resolveUniqueReplicaId();
        const replica = this.getReplica(id);
        let tool: ToolName = name;
        let input = parseToolInput(tool, rawInput) as Record<string, unknown>;
        const readTool = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"].includes(tool);
        if (readTool && (!replica.clients.size || !replica.canvasState)) throw new Error("当前没有已连接画布");
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(replica.canvasState);
        if (tool === "canvas_get_selection") {
            const ids = new Set(replica.canvasState?.selectedNodeIds || []);
            return { nodes: (replica.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (tool === "canvas_create_node") {
            const data = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "add_node", nodeType: data.nodeType, title: data.title, position: { x: data.x ?? nextCanvasX(replica.canvasState), y: data.y ?? 0 }, width: data.width, height: data.height, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_node") {
            const data = input as { text: string; x?: number; y?: number; title?: string; width?: number; height?: number };
            if (!data.text) throw new Error("text 必须是非空字符串");
            input = { ops: [textNodeOp(data, data.x ?? nextCanvasX(replica.canvasState), data.y ?? 0)] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_nodes") {
            const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
            const x = Number(data.x ?? nextCanvasX(replica.canvasState));
            const y = Number(data.y ?? 0);
            const gap = Number(data.gap ?? 40);
            input = {
                ops: data.items.map((item, index) => textNodeOp(item, item.x ?? (data.direction === "row" ? x + index * (340 + gap) : x), item.y ?? (data.direction === "row" ? y : y + index * (240 + gap)))),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_image_prompt_flow") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: "image" }, replica.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_config_node") {
            const data = input as Record<string, unknown>;
            const x = Number(data.x ?? nextCanvasX(replica.canvasState));
            const y = Number(data.y ?? 0);
            const configId = `config-${crypto.randomUUID()}`;
            const mode = generationMode(data.mode);
            const prompt = String(data.prompt || "");
            input = { ops: [configNodeOp(configId, data, x, y), ...(data.autoRun ? [runGenerationOp(configId, mode, prompt)] : [])] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_generation_flow") {
            input = { ops: generationFlowOps(input as Record<string, unknown>, replica.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_generate_text" || tool === "canvas_generate_image" || tool === "canvas_generate_video" || tool === "canvas_generate_audio") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: tool.replace("canvas_generate_", ""), autoRun: true }, replica.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node") {
            const data = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "update_node", id: data.id, patch: data.patch, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node_text") {
            const data = input as { id: string; text: string; title?: string };
            input = { ops: [{ type: "update_node", id: data.id, patch: { ...(data.title ? { title: data.title } : {}) }, metadata: { content: data.text, status: "success" } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_move_nodes") {
            const data = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
            input = {
                ops: data.items.map((item) => {
                    const current = findNode(replica.canvasState, item.id);
                    return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((current?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((current?.position.y || 0) + (item.dy || 0)) } } };
                }),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_resize_node") {
            const data = input as { id: string; width: number; height: number; freeResize?: boolean };
            input = { ops: [{ type: "update_node", id: data.id, patch: { width: data.width, height: data.height }, metadata: data.freeResize === undefined ? undefined : { freeResize: data.freeResize } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_delete_nodes") {
            input = { ops: [{ type: "delete_node", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_connect_nodes") {
            const data = input as { connections: Array<{ fromNodeId: string; toNodeId: string }> };
            input = { ops: data.connections.map((connection) => ({ type: "connect_nodes", ...connection })) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_select_nodes") {
            input = { ops: [{ type: "select_nodes", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_set_viewport") {
            input = { ops: [{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_run_generation") {
            const data = input as { nodeId: string; mode?: string; prompt?: string };
            input = { ops: [runGenerationOp(data.nodeId, generationMode(data.mode), data.prompt)] };
            tool = "canvas_apply_ops";
        }
        if (tool !== "canvas_apply_ops") throw new Error(`未知工具：${tool}`);
        if (!replica.clients.size) throw new Error("当前没有已连接画布");
        return await this.requestCanvasTool(replica, tool, input);
    }

    private async requestCanvasTool(replica: ReplicaSession, name: ToolName, input: Record<string, unknown>) {
        const requestId = crypto.randomUUID();
        const client = replica.clients.get(replica.canvasState?.clientId || "") || replica.clients.values().next().value;
        if (!client) throw new Error("当前没有已连接画布");
        sendEvent(client, "tool_call", { requestId, name, input });
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                replica.pending.delete(requestId);
                this.cleanupReplica(replica);
                reject(new Error("画布操作超时"));
            }, 30000);
            replica.pending.set(requestId, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
        });
    }

    private getReplica(replicaId: string) {
        let replica = this.replicas.get(replicaId);
        if (!replica) {
            replica = { clients: new Map(), pending: new Map(), canvasState: null };
            this.replicas.set(replicaId, replica);
        }
        return replica;
    }

    private deleteReplica(replica: ReplicaSession) {
        for (const [id, item] of this.replicas) if (item === replica) this.replicas.delete(id);
    }

    private cleanupReplica(replica: ReplicaSession) {
        if (!replica.clients.size && !replica.canvasState && !replica.pending.size) this.deleteReplica(replica);
    }

    private resolveUniqueReplicaId() {
        const ids = [...this.replicas].filter(([, replica]) => replica.clients.size).map(([id]) => id);
        if (ids.length === 1) return ids[0];
        if (!ids.length) throw new Error("当前没有已连接画布");
        throw new Error("多个画布已连接，必须指定 Replica identity");
    }
}

function normalizeReplicaId(value: string | null | undefined) {
    return value?.trim() || DEFAULT_REPLICA_ID;
}

function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) {
    return { type: "add_node", id: input.id, nodeType: "text", title: input.title, position: { x, y }, width: input.width, height: input.height, metadata: { content: input.text || "", status: "success", fontSize: 14 } };
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    return {
        type: "add_node",
        id,
        nodeType: "config",
        title: String(input.title || generationTitle(mode)),
        position: { x, y },
        width: typeof input.width === "number" ? input.width : undefined,
        height: typeof input.height === "number" ? input.height : undefined,
        metadata: cleanRecord({
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: input.model,
            size: input.size,
            quality: input.quality,
            count: input.count,
            seconds: input.seconds,
            vquality: input.vquality,
            generateAudio: input.generateAudio,
            watermark: input.watermark,
            audioVoice: input.audioVoice,
            audioFormat: input.audioFormat,
            audioSpeed: input.audioSpeed,
            audioInstructions: input.audioInstructions,
        }),
    };
}

function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const x = Number(input.x ?? nextCanvasX(state));
    const y = Number(input.y ?? 0);
    const textId = `text-${crypto.randomUUID()}`;
    const configId = `config-${crypto.randomUUID()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    const configInput = { ...input, prompt: tokens.join("\n") };
    return [
        textNodeOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, x, y),
        configNodeOp(configId, configInput, x + 420, y),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
        { type: "select_nodes", ids: [configId] },
        ...(input.autoRun ? [runGenerationOp(configId, mode, tokens.join("\n"))] : []),
    ];
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string) {
    return { type: "run_generation", nodeId, mode, prompt };
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

function findNode(state: CanvasSnapshot | null, id: string): CanvasNode | undefined {
    return (state?.nodes || []).find((node) => node.id === id);
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
