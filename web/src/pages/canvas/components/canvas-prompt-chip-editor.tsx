"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Maximize2, Minimize2, Music2, Video } from "lucide-react";

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
type EditorSelection = {
    start: number;
    end: number;
};
const CARET_PLACEHOLDER = "\uFEFF";

export function CanvasPromptChipEditor({ value, references, onChange, onSubmit, className, style, placeholder }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const referenceKeyRef = useRef("");
    const selectionRef = useRef<EditorSelection | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const referenceById = useMemo(() => new Map(activeReferences.map((item) => [item.nodeId, item])), [activeReferences]);
    const referenceKey = activeReferences.map((item) => `${item.nodeId}\0${item.label}\0${item.previewUrl || ""}`).join("\u0001");
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        return query ? activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query)) : activeReferences;
    }, [activeReferences, mention]);

    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const savedSelection = selectionRef.current;
        const referencesChanged = referenceKeyRef.current !== referenceKey;
        referenceKeyRef.current = referenceKey;
        if (!referencesChanged && serializeEditor(editor) === value) {
            ensureTrailingCaretNode(editor);
        } else {
            const focused = document.activeElement === editor;
            editor.replaceChildren();
            parsePromptTokens(value, activeReferences).forEach((token) => {
                if (token.type === "text") editor.append(document.createTextNode(token.value));
                else {
                    const reference = referenceById.get(token.nodeId);
                    editor.append(reference ? createChip(reference, theme) : document.createTextNode(token.label));
                }
            });
            ensureTrailingCaretNode(editor);
            if (focused && !savedSelection) placeCaretAtEnd(editor);
        }
        if (savedSelection) {
            editor.focus();
            restoreEditorSelection(editor, savedSelection);
            selectionRef.current = null;
        }
    }, [activeReferences, expanded, referenceById, referenceKey, theme, value]);

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
        ensureTrailingCaretNode(editor);
        onChange(serializeEditor(editor));
        syncMention();
    };
    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (range.startContainer !== editor && !editor.contains(range.startContainer)) return;
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

    const toggleExpanded = () => {
        selectionRef.current = captureEditorSelection(editorRef.current) || { start: value.length, end: value.length };
        closeMention();
        setExpanded((value) => !value);
    };

    const editor = (
        <div
            data-canvas-no-zoom
            className={expanded ? "fixed z-[110] overflow-hidden rounded-lg shadow-2xl" : "relative h-24 w-full"}
            style={
                expanded
                    ? {
                          left: "50%",
                          top: "50%",
                          width: "min(960px, calc(100vw - 32px))",
                          height: "min(720px, calc(100vh - 48px))",
                          transform: "translate(-50%, -50%)",
                          background: theme.node.fill,
                      }
                    : undefined
            }
        >
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
                className={`${className || ""} ${expanded ? "!h-full" : ""} overflow-y-auto whitespace-pre-wrap break-words`}
                style={{ ...style, paddingRight: "2.75rem", paddingBottom: "2.5rem" }}
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
                    if (event.nativeEvent.isComposing || composingRef.current) return;
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                        event.preventDefault();
                        closeMention();
                        selectEditorContents(editorRef.current);
                        return;
                    }
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
            <button
                type="button"
                className="absolute bottom-2 right-2 z-20 grid size-8 place-items-center rounded-md border transition hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                title={expanded ? "缩小输入框" : "放大输入框"}
                aria-label={expanded ? "缩小输入框" : "放大输入框"}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded();
                }}
            >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            {mention && candidates.length && editorRef.current ? <MentionMenu editor={editorRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
        </div>
    );

    return expanded ? (
        <>
            <div className="h-24 w-full" />
            {createPortal(editor, document.body)}
        </>
    ) : (
        editor
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

function MentionMenu({
    editor,
    references,
    activeIndex,
    theme,
    onSelect,
}: {
    editor: HTMLElement;
    references: CanvasResourceReference[];
    activeIndex: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const rect = editor.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 232);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 264);
    const stop = (event: PointerEvent | MouseEvent) => event.stopPropagation();
    return createPortal(
        <div
            role="listbox"
            aria-label="资源"
            className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
            onPointerDown={stop}
            onMouseDown={stop}
        >
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
    return serializeNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    let seenNode = false;
    let previousWasBlock = false;
    nodes.forEach((node) => {
        const block = node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
        if (block) {
            if (seenNode && (previousWasBlock || !result.endsWith("\n"))) result += "\n";
            if (!isPlaceholderBlock(node)) result += serializeNodes(node.childNodes);
            seenNode = true;
            previousWasBlock = true;
            return;
        }
        const content = serializeInlineNode(node);
        if (!content.replace(/\uFEFF/g, "")) return;
        if (seenNode && previousWasBlock) result += "\n";
        result += content;
        seenNode = true;
        previousWasBlock = false;
    });
    return result;
}

function serializeInlineNode(node: ChildNode) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.dataset.promptLabel) return node.dataset.promptLabel;
    if (node.tagName === "BR") return "\n";
    return serializeNodes(node.childNodes);
}

function isPlaceholderBlock(element: HTMLElement) {
    const children = Array.from(element.childNodes).filter((node) => !(node.nodeType === Node.TEXT_NODE && !(node.textContent || "").replace(/\uFEFF/g, "")));
    return children.length === 1 && children[0] instanceof HTMLElement && children[0].tagName === "BR";
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
    const target = adjacentChipNode(range, key);
    if (!target) return false;
    range.selectNode(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand("delete");
}

function adjacentChipNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        const before = text.slice(0, offset).replace(/\uFEFF/g, "");
        const after = text.slice(offset).replace(/\uFEFF/g, "");
        if ((previous && before) || (!previous && after)) return null;
        return findChipSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findChipSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findChipSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.promptLabel ? current : null;
}

function ensureTrailingCaretNode(editor: HTMLElement) {
    const last = editor.lastChild;
    if (last instanceof HTMLElement && last.dataset.promptLabel) editor.append(document.createTextNode(CARET_PLACEHOLDER));
}

function selectEditorContents(editor: HTMLElement | null) {
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
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

function captureEditorSelection(editor: HTMLElement | null): EditorSelection | null {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const start = serializedOffset(editor, range.startContainer, range.startOffset);
    const end = serializedOffset(editor, range.endContainer, range.endOffset);
    return start === null || end === null ? null : { start, end };
}

function serializedOffset(editor: HTMLElement, node: Node, offset: number) {
    if (!editor.contains(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, offset);
    return serializeNodes(range.cloneContents().childNodes).replace(/\uFEFF/g, "").length;
}

function restoreEditorSelection(editor: HTMLElement, saved: EditorSelection) {
    const start = pointAtPromptOffset(editor, saved.start);
    const end = pointAtPromptOffset(editor, saved.end);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function pointAtPromptOffset(editor: HTMLElement, target: number) {
    let remaining = Math.max(0, target);
    for (let index = 0; index < editor.childNodes.length; index += 1) {
        const node = editor.childNodes[index];
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            const length = text.replace(/\uFEFF/g, "").length;
            if (remaining <= length) return { node, offset: domTextOffset(text, remaining) };
            remaining -= length;
        } else if (node instanceof HTMLElement && node.dataset.promptLabel) {
            const length = node.dataset.promptLabel.length;
            if (remaining <= length) return { node: editor, offset: index + (remaining ? 1 : 0) };
            remaining -= length;
        }
    }
    return { node: editor, offset: editor.childNodes.length };
}

function domTextOffset(text: string, target: number) {
    let visible = 0;
    for (let offset = 0; offset < text.length; offset += 1) {
        if (text[offset] !== CARET_PLACEHOLDER) visible += 1;
        if (visible === target) return offset + 1;
    }
    return text.length;
}
