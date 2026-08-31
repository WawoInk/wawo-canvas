import axios from "axios";

import { buildApiUrl, resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { buildAsyncImageEditRequest, imageEditReferenceFields, resolveImageRequestFormat } from "@/services/api/async-image-edit-form";
import { imageBackgroundFields } from "@/services/api/image-background";
import type { ImageRequestFormat } from "@/services/api/settings";
import { imageToDataUrl } from "@/services/blob-storage";
import { queueCreditBalanceRefresh } from "@/services/credit-balance-sync";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage = AiTextMessage | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string } | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ModelUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type ModelFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error" | "other";

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
    usage?: ModelUsage;
    finishReason?: ModelFinishReason;
};

export type ModelStreamEvent =
    | { type: "phase"; phase: "requesting" | "streaming" }
    | { type: "text_delta"; delta: string; content: string }
    | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta: string; arguments: string }
    | ({ type: "usage" } & ModelUsage)
    | { type: "done"; result: ToolResponseResult }
    | { type: "error"; error: Error }
    | { type: "abort"; error: Error };

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem = { type?: "message"; content?: Array<{ type?: string; text?: string }> } | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    result?: { data?: Array<Record<string, unknown>> };
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; usage?: ModelUsage; finishReason?: ModelFinishReason; done?: boolean };
type ChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | null;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
};

type ChatToolDef = {
    type: "function";
    function: { name: string; description?: string; parameters: Record<string, unknown> };
};

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type ChatCompletionChunk = {
    choices?: Array<{ delta?: { role?: string; content?: string | null; tool_calls?: Array<{ index?: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
    usage?: ChatUsage;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

type ChatCompletionPayload = {
    id?: string;
    choices?: Array<{
        message?: { role?: string; content?: string | null; tool_calls?: Array<{ id?: string; type?: "function"; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string;
    }>;
    usage?: ChatUsage;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

type ChatStreamState = { buffer: string; text: string; toolCalls: Map<number, { id: string; name: string; args: string }>; usage?: ModelUsage; finishReason?: ModelFinishReason; done?: boolean };
export type RequestOptions = { signal?: AbortSignal; onEvent?: (event: ModelStreamEvent) => void; includeUsage?: boolean };

function normalizeFinishReason(reason?: string | null): ModelFinishReason | undefined {
    switch (reason?.trim().toLowerCase()) {
        case "stop":
            return "stop";
        case "length":
        case "max_tokens":
            return "length";
        case "tool_calls":
        case "function_call":
            return "tool_calls";
        case "content_filter":
        case "safety":
        case "recitation":
        case "blocklist":
        case "prohibited_content":
        case "spii":
        case "image_safety":
            return "content_filter";
        case "error":
        case "malformed_function_call":
        case "unexpected_tool_call":
        case "too_many_tool_calls":
        case "missing_thought_signature":
        case "malformed_response":
            return "error";
        case undefined:
        case "":
            return undefined;
        default:
            return "other";
    }
}

function normalizeChatUsage(usage?: ChatUsage): ModelUsage | undefined {
    if (!usage || !Object.values(usage).some((value) => typeof value === "number")) return undefined;
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    return { inputTokens, outputTokens, totalTokens: usage.total_tokens ?? inputTokens + outputTokens };
}

function normalizeGeminiUsage(usage?: GeminiPayload["usageMetadata"]): ModelUsage | undefined {
    if (!usage || !Object.values(usage).some((value) => typeof value === "number")) return undefined;
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    return { inputTokens, outputTokens, totalTokens: usage.totalTokenCount ?? inputTokens + outputTokens };
}

function isJsonMediaType(contentType: string) {
    return /(?:^|[\/+])json(?:;|$)/i.test(contentType);
}

function isEventStreamMediaType(contentType: string) {
    return /text\/event-stream/i.test(contentType);
}

function looksLikeJson(text: string) {
    const first = text.trimStart()[0];
    return first === "{" || first === "[";
}

async function readResponseStart(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) {
    let text = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return { done, text: text + decoder.decode() };
        text += decoder.decode(value, { stream: true });
        if (text.trim()) return { done, text };
    }
}

async function readRemainingText(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, text: string) {
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        text += decoder.decode(value, { stream: true });
    }
}

function completeRequest(result: ToolResponseResult, options?: RequestOptions) {
    options?.onEvent?.({ type: "done", result });
    return result;
}

function completeNonStreamingRequest(result: ToolResponseResult, onDelta?: (text: string) => void, options?: RequestOptions) {
    if (result.content) {
        onDelta?.(result.content);
        options?.onEvent?.({ type: "text_delta", delta: result.content, content: result.content });
    }
    result.toolCalls.forEach((toolCall, index) =>
        options?.onEvent?.({
            type: "tool_call_delta",
            index,
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsDelta: toolCall.function.arguments,
            arguments: toolCall.function.arguments,
        }),
    );
    if (result.usage) options?.onEvent?.({ type: "usage", ...result.usage });
    return result;
}

function failRequest(error: unknown, options: RequestOptions | undefined, fallback: string): never {
    if (options?.signal?.aborted || (error instanceof Error && error.name === "AbortError") || axios.isCancel(error)) {
        const abortError = error instanceof Error && error.name === "AbortError" ? error : new Error(readAxiosError(error, i18n.t("errors.requestCancelled")));
        if (abortError.name !== "AbortError") abortError.name = "AbortError";
        options?.onEvent?.({ type: "abort", error: abortError });
        throw abortError;
    }
    const requestError = new Error(readAxiosError(error, fallback));
    options?.onEvent?.({ type: "error", error: requestError });
    throw requestError;
}

function responseHeader(headers: unknown, name: string) {
    if (!headers || typeof headers !== "object") return "";
    const value = "get" in headers && typeof headers.get === "function" ? headers.get(name) : (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : "";
}

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(i18n.t("errors.image.invalidSizeFormat"));
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(i18n.t("errors.image.invalidRatio"));
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error(i18n.t("errors.image.ratioTooLarge"));
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(i18n.t("errors.image.invalidDimensions"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(i18n.t("errors.image.dimensionStep"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(i18n.t("errors.image.edgeTooLarge"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(i18n.t("errors.image.ratioTooLarge"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(i18n.t("errors.image.pixelRange"));
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error(i18n.t("errors.image.invalidSizeFormat"));
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImageDataUrls(items?: Array<Record<string, unknown>>) {
    return (items || []).map(resolveImageDataUrl).filter((value): value is string => Boolean(value));
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || i18n.t("errors.requestFailed"));
    }
    const images = parseImageDataUrls(payload.data).map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) {
        throw new Error(i18n.t("errors.image.noImageReturned"));
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return i18n.t("errors.requestCancelled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || readStatusError(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return i18n.t("errors.requestCancelled");
    return error instanceof Error ? error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return i18n.t("errors.authenticationFailed");
    if (status === 429) return i18n.t("errors.rateLimited");
    return status ? i18n.t("errors.requestFailedWithStatus", { fallback, status }) : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    return config.channelMode === "remote"
        ? {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              Authorization: `Bearer ${config.apiKey}`,
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}

function configuredImageRequestFormat(config: AiConfig, fallback: ImageRequestFormat) {
    return config.channelMode === "remote" ? resolveImageRequestFormat(config.imageRequestFormats, config.model, fallback) : fallback;
}

function configuredCanvasImageEditPath(config: AiConfig) {
    const mode = config.channelMode === "remote" ? config.imageRequestFormats.find((item) => item.model.trim() === config.model.trim())?.canvasRequestMode : undefined;
    return mode === "generations" ? "/async/images/generations" : "/async/images/edits";
}

function imageRequestFormData(fields: Record<string, string | number | undefined>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) formData.set(key, String(value));
    }
    return formData;
}

function imageRequestBody(fields: Record<string, string | number | undefined>, format: ImageRequestFormat) {
    return format === "multipart/form-data" ? imageRequestFormData(fields) : fields;
}

function imageRequestHeaders(config: AiConfig, format: ImageRequestFormat) {
    return aiHeaders(config, format === "application/json" ? format : undefined);
}

async function referenceImageToFile(image: ReferenceImage) {
    if (!image.fileId) return dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) });
    const token = useUserStore.getState().token;
    const response = await fetch(`/api/v1/files/${encodeURIComponent(image.fileId)}/content`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok || response.headers.get("content-type")?.includes("application/json")) throw new Error(i18n.t("errors.image.readFailed"));
    const blob = await response.blob();
    if (!blob.size) throw new Error(i18n.t("errors.image.readFailed"));
    return new File([blob], image.name || "reference.png", { type: blob.type || image.type || "image/png" });
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || i18n.t("errors.requestFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || i18n.t("errors.requestFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(i18n.t("errors.image.geminiRejected", { reason: payload.promptFeedback.blockReason }));
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) break;
        consumeResponseStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, i18n.t("errors.requestFailed")));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

// ── Chat Completions (shared by openai & xvanai) ─────────────────────

function chatCompletionsUrl(config: AiConfig) {
    if (config.channelMode !== "remote") return buildApiUrl(config.baseUrl, "/chat/completions");
    return config.apiFormat === "xvanai" ? "/api/v1/xvanai/chat/completions" : "/api/v1/chat/completions";
}

function toChatMessages(messages: ResponseInputMessage[]): ChatMessage[] {
    return messages.map((message): ChatMessage => {
        if ("type" in message) {
            return { role: "assistant" as const, content: null, tool_calls: [{ id: message.call_id, type: "function" as const, function: { name: message.name, arguments: message.arguments } }] };
        }
        if (message.role === "tool") {
            return { role: "tool" as const, content: message.content, tool_call_id: message.tool_call_id };
        }
        return {
            role: message.role as "system" | "user" | "assistant",
            content: typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map((item) => (item.type === "text" ? item.text : "")).join("") : "",
        };
    });
}

function toChatTools(tools: ResponseFunctionTool[]): ChatToolDef[] {
    return tools.map((tool) => ({ type: "function" as const, function: { name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters } }));
}

async function requestChatCompletions(config: AiConfig, messages: ResponseInputMessage[], tools?: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    options?.onEvent?.({ type: "phase", phase: "requesting" });
    const chatMessages = toChatMessages(withSystemMessage(config, messages));
    const body: Record<string, unknown> = { model: config.model, messages: chatMessages, stream: true };
    if (options?.includeUsage) body.stream_options = { include_usage: true };
    if (tools?.length) {
        body.tools = toChatTools(tools);
        body.tool_choice = toolChoice;
    }
    const response = await fetch(chatCompletionsUrl(config), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, i18n.t("errors.requestFailed")));
    options?.onEvent?.({ type: "phase", phase: "streaming" });
    const contentType = response.headers?.get?.("content-type") || "";
    const eventStream = isEventStreamMediaType(contentType);
    if (isJsonMediaType(contentType) || (!response.body && !eventStream)) {
        const payload = (await response.json()) as ChatCompletionPayload;
        validateChatCompletionPayload(payload);
        return completeNonStreamingRequest(parseChatCompletionPayload(payload), onDelta, options);
    }
    if (!response.body) throw new Error("模型流响应缺少响应体");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatStreamState = { buffer: "", text: "", toolCalls: new Map() };
    if (!eventStream) {
        const start = await readResponseStart(reader, decoder);
        if (looksLikeJson(start.text)) {
            const payload = JSON.parse(start.done ? start.text : await readRemainingText(reader, decoder, start.text)) as ChatCompletionPayload;
            validateChatCompletionPayload(payload);
            return completeNonStreamingRequest(parseChatCompletionPayload(payload), onDelta, options);
        }
        consumeChatStream(state, start.text, onDelta, options);
    }
    while (!state.done) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatStream(state, decoder.decode(value, { stream: true }), onDelta, options);
    }
    consumeChatStream(state, decoder.decode(), onDelta, options, true);
    const toolCalls = Array.from(state.toolCalls.entries())
        .sort(([left], [right]) => left - right)
        .map(([, toolCall]) => toolCall)
        .filter((toolCall) => toolCall.name)
        .map((toolCall) => ({ id: toolCall.id || nanoid(), type: "function" as const, function: { name: toolCall.name, arguments: toolCall.args } }));
    return {
        content: state.text,
        toolCalls,
        ...(state.usage ? { usage: state.usage } : {}),
        ...(state.finishReason ? { finishReason: state.finishReason } : {}),
    };
}

function consumeChatStream(state: ChatStreamState, text: string, onDelta?: (text: string) => void, options?: RequestOptions, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) break;
        consumeChatStreamBlock(state.buffer.slice(0, match.index), state, onDelta, options);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatStreamBlock(state.buffer, state, onDelta, options);
        state.buffer = "";
    }
}

function consumeChatStreamBlock(block: string, state: ChatStreamState, onDelta?: (text: string) => void, options?: RequestOptions) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || state.done) return;
    if (data === "[DONE]") {
        state.done = true;
        return;
    }
    const chunk = JSON.parse(data) as ChatCompletionChunk;
    validateChatCompletionPayload(chunk);
    for (const choice of chunk.choices || []) {
        const finishReason = normalizeFinishReason(choice.finish_reason);
        if (finishReason === "error") throw new Error(`模型返回错误结束原因：${choice.finish_reason || "error"}`);
        if (finishReason) state.finishReason = finishReason;
        const delta = choice.delta;
        if (!delta) continue;
        if (delta.content) {
            state.text += delta.content;
            onDelta?.(state.text);
            options?.onEvent?.({ type: "text_delta", delta: delta.content, content: state.text });
        }
        for (const toolCall of delta.tool_calls || []) {
            const index = toolCall.index ?? 0;
            const existing = state.toolCalls.get(index) || { id: "", name: "", args: "" };
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name = toolCall.function.name;
            const argumentsDelta = toolCall.function?.arguments || "";
            existing.args += argumentsDelta;
            state.toolCalls.set(index, existing);
            options?.onEvent?.({
                type: "tool_call_delta",
                index,
                ...(existing.id ? { id: existing.id } : {}),
                ...(existing.name ? { name: existing.name } : {}),
                argumentsDelta,
                arguments: existing.args,
            });
        }
    }
    const usage = normalizeChatUsage(chunk.usage);
    if (usage) {
        state.usage = usage;
        options?.onEvent?.({ type: "usage", ...usage });
    }
}

function validateChatCompletionPayload(payload: { error?: { message?: string }; code?: number; msg?: string }) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || i18n.t("errors.requestFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function parseChatCompletionPayload(payload: ChatCompletionPayload): ToolResponseResult {
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const usage = normalizeChatUsage(payload.usage);
    const finishReason = normalizeFinishReason(choice?.finish_reason);
    if (finishReason === "error") throw new Error(`模型返回错误结束原因：${choice?.finish_reason || "error"}`);
    const toolCalls = (message?.tool_calls || [])
        .filter((toolCall) => toolCall.function?.name)
        .map((toolCall) => ({
            id: toolCall.id || nanoid(),
            type: "function" as const,
            function: { name: toolCall.function?.name || "", arguments: toolCall.function?.arguments || "" },
        }));
    return {
        content: message?.content || "",
        toolCalls,
        ...(usage ? { usage } : {}),
        ...(finishReason ? { finishReason } : {}),
    };
}

// ──────────────────────────────────────────────────────────────────────

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [config.systemPrompt.trim(), ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig = typeof toolChoice === "object" ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] } : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

/**
 * Remote-mode wrapper for Gemini requests: sends the Gemini-formatted body
 * to the backend proxy at `/api/v1*` using `aiApiUrl`/`aiHeaders`.
 * The backend re-writes the protocol to Gemini upstream per the selected channel.
 */
async function postGeminiViaBackend(config: AiConfig, path: string, geminiBody: Record<string, unknown>, options?: RequestOptions): Promise<GeminiPayload> {
    const url = aiApiUrl(config, path);
    const headers = { ...aiHeaders(config, "application/json"), Accept: "application/json" };
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, ...geminiBody }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, i18n.t("errors.backendProxyFailed")));
    return (await response.json()) as GeminiPayload;
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    options?.onEvent?.({ type: "phase", phase: "requesting" });
    const remote = config.channelMode === "remote";
    const response = await fetch(remote ? aiApiUrl(config, "/chat/completions") : `${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: remote ? { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" } : { ...geminiHeaders(config), Accept: "text/event-stream" },
        body: JSON.stringify(remote ? { model: config.model, ...body, stream: true } : body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, remote ? i18n.t("errors.backendProxyFailed") : i18n.t("errors.requestFailed")));
    options?.onEvent?.({ type: "phase", phase: "streaming" });
    const contentType = response.headers?.get?.("content-type") || "";
    const eventStream = isEventStreamMediaType(contentType);
    if (isJsonMediaType(contentType) || (!response.body && !eventStream)) {
        const payload = (await response.json()) as GeminiPayload;
        return completeNonStreamingRequest(parseGeminiToolResponse(payload), onDelta, options);
    }
    if (!response.body) throw new Error("模型流响应缺少响应体");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    if (!eventStream) {
        const start = await readResponseStart(reader, decoder);
        if (looksLikeJson(start.text)) {
            const payload = JSON.parse(start.done ? start.text : await readRemainingText(reader, decoder, start.text)) as GeminiPayload;
            return completeNonStreamingRequest(parseGeminiToolResponse(payload), onDelta, options);
        }
        consumeGeminiStreamText(state, start.text, onDelta, options);
    }
    while (!state.done) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta, options);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, options, true);
    const finishReason = state.toolCalls.length ? "tool_calls" : state.finishReason;
    return {
        content: state.text,
        toolCalls: state.toolCalls,
        ...(state.usage ? { usage: state.usage } : {}),
        ...(finishReason ? { finishReason } : {}),
    };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, options?: RequestOptions, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) break;
        consumeGeminiStreamBlock(state.buffer.slice(0, match.index), state, onDelta, options);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta, options);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void, options?: RequestOptions) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || state.done) return;
    if (data === "[DONE]") {
        state.done = true;
        return;
    }
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
        options?.onEvent?.({ type: "text_delta", delta: result.content, content: state.text });
    }
    result.toolCalls.forEach((toolCall, offset) => {
        const index = state.toolCalls.length + offset;
        options?.onEvent?.({
            type: "tool_call_delta",
            index,
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsDelta: toolCall.function.arguments,
            arguments: toolCall.function.arguments,
        });
    });
    state.toolCalls.push(...result.toolCalls);
    if (result.usage) {
        state.usage = result.usage;
        options?.onEvent?.({ type: "usage", ...result.usage });
    }
    if (result.finishReason) state.finishReason = result.finishReason;
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    const usage = normalizeGeminiUsage(payload.usageMetadata);
    const rawFinishReason = payload.candidates?.find((candidate) => candidate.finishReason)?.finishReason;
    const normalizedFinishReason = normalizeFinishReason(rawFinishReason);
    if (normalizedFinishReason === "error") throw new Error(`Gemini 返回错误结束原因：${rawFinishReason || "error"}`);
    const finishReason = toolCalls.length ? "tool_calls" : normalizedFinishReason;
    return { content, toolCalls, ...(usage ? { usage } : {}), ...(finishReason ? { finishReason } : {}) };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    if (config.channelMode === "remote") {
        const body = {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
            contents: [{ role: "user", parts }],
        };
        const payload = await postGeminiViaBackend(config, "/images/generations", body);
        return parseGeminiImagePayload(payload);
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error(i18n.t("errors.image.noImageReturnedByGemini"));
    return images;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, i18n.t("errors.requestFailed")));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const format = configuredImageRequestFormat(requestConfig, "application/json");
    const body = {
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...imageBackgroundFields(requestConfig.background),
        output_format: IMAGE_OUTPUT_FORMAT,
    };
    try {
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/generations"), imageRequestBody(body, format), {
            headers: imageRequestHeaders(requestConfig, format),
            signal: options?.signal,
        });
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.requestFailed")));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error(i18n.t("errors.image.geminiMaskUnsupported"));
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, i18n.t("errors.requestFailed")));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const format = configuredImageRequestFormat(requestConfig, "multipart/form-data");
    const fields = {
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, requestPrompt),
        n,
        output_format: IMAGE_OUTPUT_FORMAT,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...imageBackgroundFields(requestConfig.background),
    };
    let body: Record<string, unknown> | FormData;
    if (format === "application/json") {
        const images = await Promise.all(references.map(imageToDataUrl));
        body = {
            ...fields,
            ...imageEditReferenceFields(requestConfig.model, images),
            ...(mask ? { mask: await imageToDataUrl(mask) } : {}),
        };
    } else {
        const formData = imageRequestFormData(fields);
        const files = await Promise.all(references.map(referenceImageToFile));
        files.forEach((file) => formData.append("image", file));
        if (mask) formData.set("mask", dataUrlToFile(mask));
        body = formData;
    }

    try {
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), body, {
            headers: imageRequestHeaders(requestConfig, format),
            signal: options?.signal,
        });
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.requestFailed")));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        const emptyAnswer = i18n.t("errors.noContentReturned");
        const result =
            requestConfig.apiFormat === "gemini"
                ? await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)
                : await requestChatCompletions(requestConfig, messages as ResponseInputMessage[], undefined, "auto", onDelta, options);
        const answer = result.content || emptyAnswer;
        if (!result.content) {
            onDelta(answer);
            options?.onEvent?.({ type: "text_delta", delta: answer, content: answer });
        }
        completeRequest({ ...result, content: answer }, options);
        return answer;
    } catch (error) {
        return failRequest(error, options, i18n.t("errors.requestFailed"));
    } finally {
        if (requestConfig.channelMode === "remote") queueCreditBalanceRefresh();
    }
}

// ── Async Image Generation ──────────────────────────────────────────

export type AsyncImageTask = { id: string; model: string; images?: Array<{ dataUrl: string }>; platformTaskId?: string };
export type AsyncImageTaskState = { status: "pending" } | { status: "succeeded"; images: Array<{ dataUrl: string }> } | { status: "failed"; error: string };
const MAX_ASYNC_IMAGE_REFERENCES = 9;

function readAsyncImageTask(data: ImageApiResponse & { id?: string }, headers: unknown, model: string, missingId: string): AsyncImageTask {
    if (typeof data.code === "number" && data.code !== 0) throw new Error(data.msg || i18n.t("errors.requestFailed"));
    if (data.error?.message) throw new Error(data.error.message);
    const images = parseImageDataUrls(data.result?.data ?? data.data).map((dataUrl) => ({ dataUrl }));
    if (images.length) return { id: data.id || responseHeader(headers, "x-generation-task-id"), model, images };
    if (!data.id) throw new Error(missingId);
    return { id: data.id, model };
}

export async function createAsyncImageTask(config: AiConfig, prompt: string, count = 1, source = "canvas"): Promise<AsyncImageTask> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const format = configuredImageRequestFormat(requestConfig, "application/json");
    const body = {
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...imageBackgroundFields(requestConfig.background),
        output_format: IMAGE_OUTPUT_FORMAT,
    };

    try {
        const response = await axios.post<ImageApiResponse & { id?: string; status?: string }>(aiApiUrl(requestConfig, "/async/images/generations"), imageRequestBody(body, format), {
            headers: { ...imageRequestHeaders(requestConfig, format), "X-Source": source },
        });
        const task = readAsyncImageTask(response.data, response.headers, requestConfig.model, i18n.t("errors.image.asyncCreateMissingTaskId"));
        const platformTaskId = responseHeader(response.headers, "x-generation-task-id");
        return platformTaskId ? { ...task, platformTaskId } : task;
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.image.asyncCreateFailed")));
    }
}

export async function createAsyncImageEditTask(config: AiConfig, prompt: string, references: ReferenceImage[], count = 1, source = "canvas"): Promise<AsyncImageTask> {
    if (references.length > MAX_ASYNC_IMAGE_REFERENCES) throw new Error(i18n.t("errors.image.tooManyReferences", { max: MAX_ASYNC_IMAGE_REFERENCES }));
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
    const requestSize = resolveRequestSize(normalizeQuality(config.quality), config.size);
    const format = configuredImageRequestFormat(requestConfig, "multipart/form-data");
    const images = format === "application/json" ? await Promise.all(references.map(imageToDataUrl)) : [];
    const files = format === "multipart/form-data" ? await Promise.all(references.map(referenceImageToFile)) : [];
    const request = buildAsyncImageEditRequest(
        {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, prompt),
            image: files,
            n,
            ...(requestSize ? { size: requestSize } : {}),
            ...imageBackgroundFields(requestConfig.background),
            output_format: IMAGE_OUTPUT_FORMAT,
        },
        format,
        images,
    );

    try {
        const response = await axios.post<ImageApiResponse & { id?: string; status?: string }>(aiApiUrl(requestConfig, configuredCanvasImageEditPath(requestConfig)), request.body, {
            headers: { ...aiHeaders(requestConfig, request.contentType), "X-Source": source },
        });
        const task = readAsyncImageTask(response.data, response.headers, requestConfig.model, i18n.t("errors.image.asyncEditMissingTaskId"));
        const platformTaskId = responseHeader(response.headers, "x-generation-task-id");
        return platformTaskId ? { ...task, platformTaskId } : task;
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.image.asyncEditFailed")));
    }
}

export async function pollAsyncImageTask(config: AiConfig, task: AsyncImageTask, options?: RequestOptions): Promise<AsyncImageTaskState> {
    if (task.images?.length) return { status: "succeeded", images: task.images };
    const requestConfig = resolveModelRequestConfig(config, task.model);
    try {
        const response = await axios.get<{
            code?: number;
            msg?: string;
            status?: string;
            data?: Array<Record<string, unknown>>;
            result?: { data?: Array<Record<string, unknown>> };
            error?: { code?: string; message?: string };
        }>(aiApiUrl(requestConfig, `/tasks/${encodeURIComponent(task.id)}`), {
            headers: aiHeaders(requestConfig),
            params: { model: requestConfig.model },
            signal: options?.signal,
        });
        const body = response.data;
        // ponytail: backend wraps errors; unwrap before inspecting task fields
        if (body.status === "failed" || body.status === "cancelled") return { status: "failed", error: body.error?.message || i18n.t("errors.image.generationFailed") };
        if (typeof body.code === "number" && body.code !== 0) throw new Error(body.msg || i18n.t("errors.image.taskQueryFailed"));
        if (body.error?.message) throw new Error(body.error.message);
        const imageData = body.result?.data ?? body.data;
        if (body.status === "completed" || imageData) {
            const images = parseImageDataUrls(imageData).map((dataUrl) => ({ dataUrl }));
            if (!images.length) return { status: "failed", error: i18n.t("errors.image.taskSucceededWithoutImage") };
            return { status: "succeeded", images };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.image.taskQueryFailed")));
    }
}

export async function cancelAsyncImageTask(config: AiConfig, task: AsyncImageTask): Promise<void> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    try {
        await axios.post(aiApiUrl(requestConfig, `/tasks/${encodeURIComponent(task.id)}/cancel`), null, { headers: aiHeaders(requestConfig, "application/json") });
    } catch {
        // ponytail: cancel is best-effort
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        const result =
            requestConfig.apiFormat === "gemini"
                ? await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options)
                : await requestChatCompletions(requestConfig, messages, tools, toolChoice, onDelta, options);
        return completeRequest(result, options);
    } catch (error) {
        return failRequest(error, options, i18n.t("errors.requestFailed"));
    } finally {
        if (requestConfig.channelMode === "remote") queueCreditBalanceRefresh();
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("errors.image.readModelsFailed")));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
