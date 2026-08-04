"use client";

import localforage from "localforage";
import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import i18n from "@/i18n";

export type StoredImage = { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string };
export type StoredFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };
export type StoredBlob = StoredImage | StoredFile;
// ponytail: compat aliases for existing callers
export type UploadedImage = StoredImage;
export type UploadedFile = StoredFile;

const imageStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const mediaStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

function storeFor(kind: "image" | "media") {
    return kind === "image" ? imageStore : mediaStore;
}
function defaultPrefix(kind: "image" | "media") {
    return kind === "image" ? "image" : "file";
}

// ── Upload ──────────────────────────────────────────────────────────────

export async function uploadImage(input: string | Blob): Promise<StoredImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `image:${nanoid()}`;
    await imageStore.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<StoredFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await mediaStore.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

// ── Resolve / Get / Set ──────────────────────────────────────────────────

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    return resolveBlobUrl(imageStore, storageKey, fallback);
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    return resolveBlobUrl(mediaStore, storageKey, fallback);
}

async function resolveBlobUrl(store: LocalForage, storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return imageStore.getItem<Blob>(storageKey);
}
export async function getMediaBlob(storageKey: string) {
    return mediaStore.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    return setBlob(imageStore, storageKey, blob);
}
export async function setMediaBlob(storageKey: string, blob: Blob) {
    return setBlob(mediaStore, storageKey, blob);
}

async function setBlob(store: LocalForage, storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

// ── Delete / Cleanup ────────────────────────────────────────────────────

export async function deleteStoredImages(keys: Iterable<string>) {
    await deleteBlobs(imageStore, keys);
}
export async function deleteStoredMedia(keys: Iterable<string>) {
    await deleteBlobs(mediaStore, keys);
}

async function deleteBlobs(store: LocalForage, keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    await cleanupUnused(imageStore, usedData, (k) => k.startsWith("image:"));
}

export async function cleanupUnusedMedia(usedData: unknown) {
    await cleanupUnused(mediaStore, usedData, isMediaKey);
}

async function cleanupUnused(store: LocalForage, usedData: unknown, keyFilter: (k: string) => boolean) {
    const usedKeys = collectKeys(usedData, keyFilter);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteBlobs(store, unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    return collectKeys(value, (k) => k.startsWith("image:"), keys);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    const pattern = /^(image|video|audio|file|video-reference|audio-reference):/;
    return collectKeys(value, (k) => pattern.test(k), keys);
}

function collectKeys(value: unknown, keyFilter: (k: string) => boolean, keys = new Set<string>()): Set<string> {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string") {
        const k = value.storageKey as string;
        if (keyFilter(k)) keys.add(k);
    }
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectKeys(child, keyFilter, keys)) : collectKeys(item, keyFilter, keys)));
    return keys;
}

function isMediaKey(k: string) {
    return /^(image|video|audio|file|video-reference|audio-reference):/.test(k);
}

// ── Image-specific helpers ───────────────────────────────────────────────

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    // ponytail: return public URLs as-is — S3 presigned URLs lack CORS headers so fetch() fails cross-origin
    if (/^https?:\/\//i.test(url)) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

// ── Metadata reading (doesn't touch storage) ────────────────────────────

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("errors.image.readFailed")));
        reader.readAsDataURL(blob);
    });
}
