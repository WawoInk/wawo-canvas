import { saveAs } from "file-saver";

export type CsvColumn<T> = {
    title: string;
    value: (item: T) => unknown;
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function buildCsv<T>(columns: CsvColumn<T>[], items: T[]) {
    return `\uFEFF${[columns.map((column) => csvCell(column.title)), ...items.map((item) => columns.map((column) => csvCell(column.value(item))))].map((row) => row.join(",")).join("\r\n")}`;
}

export async function fetchAllPages<T>(loadPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>) {
    const items: T[] = [];
    const pageSize = 500;
    for (let page = 1; ; page += 1) {
        const result = await loadPage(page, pageSize);
        items.push(...result.items);
        if (items.length >= result.total || result.items.length === 0) return items;
    }
}

export function downloadCsv<T>(fileName: string, columns: CsvColumn<T>[], items: T[]) {
    saveAs(new Blob([buildCsv(columns, items)], { type: "text/csv;charset=utf-8" }), fileName);
}
