"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { parsePromptTokens } from "./canvas-prompt-chips";

type Props = {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
};

type MentionState = { query: string };

export function CanvasPromptChipEditor({ value, references, onChange, onSubmit, className, style, placeholder }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const referenceKeyRef = useRef("");
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const referenceById = useMemo(() => new Map(activeReferences.map((item) => [item.nodeId, item])), [activeReferences]);
    const referenceKey = activeReferences.map((item) => `${item.nodeId}\0${item.label}\0${item.previewUrl || ""}`).join("\u0001");
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        return query ? activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query)) : activeReferences;
    }, [activeReferences, mention]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const referencesChanged = referenceKeyRef.current !== referenceKey;
        referenceKeyRef.current = referenceKey;
        if (!referencesChanged && serializeEditor(editor) === value) return;
        const focused = document.activeElement === editor;
        editor.replaceChildren();
        parsePromptTokens(value, activeReferences).forEach((token) => {
            if (token.type === "text") editor.append(document.createTextNode(token.value));
            else {
                const reference = referenceById.get(token.nodeId);
                editor.append(reference ? createChip(reference, theme) : document.createTextNode(token.label));
            }
        });
        if (focused) placeCaretAtEnd(editor);
    }, [activeReferences, referenceById, referenceKey, theme, value]);

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };
    const syncMention = () => {
        const match = /@([^\s@]*)$/.exec(textBeforeCaret());
        if (!match || !activeReferences.length) return closeMention();
        setMention({ query: match[1] || "" });
        setActiveIndex(0);
    };
    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        onChange(serializeEditor(editor));
        syncMention();
    };
    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        selectActiveMention(range);
        document.execCommand("insertHTML", false, `${createChip(reference, theme).outerHTML} `);
        closeMention();
        onChange(serializeEditor(editor));
    };
    const pastePlainText = (event: ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        requestAnimationFrame(syncFromEditor);
    };

    return (
        <div className="relative h-24 w-full">
            {!value ? (
                <div className="pointer-events-none absolute left-3 top-2 z-10 text-sm opacity-45" style={{ color: theme.node.text, lineHeight: style?.lineHeight }}>
                    {placeholder}
                </div>
            ) : null}
            <div
                ref={editorRef}
                role="textbox"
                aria-label="提示词"
                aria-multiline="true"
                contentEditable
                suppressContentEditableWarning
                className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words`}
                style={style}
                onInput={() => {
                    if (!composingRef.current) syncFromEditor();
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncFromEditor();
                }}
                onPaste={pastePlainText}
                onError={(event) => {
                    if (event.target instanceof HTMLImageElement) event.target.remove();
                }}
                onClick={(event) => {
                    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-prompt-label]");
                    if (!chip) return;
                    const range = document.createRange();
                    range.selectNode(chip);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    if (event.isComposing || composingRef.current) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentChip(event.key)) {
                        event.preventDefault();
                        requestAnimationFrame(syncFromEditor);
                        return;
                    }
                    if (event.key === "Enter" && onSubmit && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onBlur={() => window.setTimeout(closeMention, 120)}
            />
            {mention && candidates.length && editorRef.current ? <MentionMenu editor={editorRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
        </div>
    );
}

function createChip(reference: CanvasResourceReference, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.promptLabel = reference.label;
    chip.dataset.referenceNodeId = reference.nodeId;
    chip.title = reference.title;
    chip.className = "mx-0.5 inline-flex h-6 max-w-40 select-all items-center gap-1 overflow-hidden rounded-md border px-1 align-middle text-xs leading-none";
    Object.assign(chip.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text });
    if ((reference.kind === "image" || reference.kind === "video") && reference.previewUrl) {
        const image = document.createElement("img");
        image.src = reference.previewUrl;
        image.alt = "";
        image.className = "size-4 shrink-0 rounded-sm object-cover";
        image.addEventListener("error", () => image.remove());
        chip.append(image);
    }
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = reference.title || reference.label;
    chip.append(label);
    return chip;
}

function MentionMenu({ editor, references, activeIndex, theme, onSelect }: { editor: HTMLElement; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const rect = editor.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 232);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 264);
    const stop = (event: PointerEvent | MouseEvent) => event.stopPropagation();
    return createPortal(
        <div role="listbox" aria-label="资源" className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl" style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border }} onPointerDown={stop} onMouseDown={stop}>
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        onSelect(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if ((reference.kind === "image" || reference.kind === "video") && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" onError={(event) => (event.currentTarget.style.display = "none")} />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return <Icon className="size-4 shrink-0" />;
}

function serializeEditor(editor: HTMLElement) {
    let result = "";
    editor.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        else if (node instanceof HTMLElement) result += node.dataset.promptLabel || (node.tagName === "BR" ? "\n" : serializeEditor(node));
    });
    return result.replace(/\uFEFF/g, "");
}

function selectActiveMention(range: Range) {
    const match = /@([^\s@]*)$/.exec(textBeforeCaret());
    if (!match || range.startContainer.nodeType !== Node.TEXT_NODE) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - match[0].length));
}

function deleteAdjacentChip(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const previous = key === "Backspace";
    const container = range.startContainer;
    const offset = range.startOffset;
    let node: Node | null;
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && text.slice(0, offset).trim()) || (!previous && text.slice(offset).trim())) return false;
        node = previous ? container.previousSibling : container.nextSibling;
    } else node = container.childNodes[previous ? offset - 1 : offset] || null;
    while (node?.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim()) node = previous ? node.previousSibling : node.nextSibling;
    if (!(node instanceof HTMLElement) || !node.dataset.promptLabel) return false;
    if (container.nodeType === Node.TEXT_NODE) {
        if (previous) range.setStartBefore(node);
        else range.setEndAfter(node);
    } else range.selectNode(node);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete");
    return true;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const editor = element?.closest("[contenteditable='true']");
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}
