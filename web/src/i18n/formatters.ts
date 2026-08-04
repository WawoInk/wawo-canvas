import i18n, { resolveLanguage } from "@/i18n";

type DateValue = Date | string | number;

export function currentLocale() {
    return resolveLanguage(i18n.resolvedLanguage || i18n.language);
}

export function formatDate(value: DateValue, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(currentLocale(), options).format(date);
}

export function formatDateTime(value: DateValue, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
    return formatDate(value, options);
}

export function formatTime(value: DateValue, options: Intl.DateTimeFormatOptions = { timeStyle: "medium" }) {
    return formatDate(value, options);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
    return new Intl.NumberFormat(currentLocale(), options).format(value);
}

export function formatUnit(value: number, unit: NonNullable<Intl.NumberFormatOptions["unit"]>, options?: Omit<Intl.NumberFormatOptions, "style" | "unit">) {
    return formatNumber(value, { ...options, style: "unit", unit });
}

export function formatList(values: string[], options: Intl.ListFormatOptions = { style: "long", type: "conjunction" }) {
    return new Intl.ListFormat(currentLocale(), options).format(values);
}

export function formatDimensions(width: number, height: number) {
    return `${formatNumber(width, { useGrouping: false })} × ${formatNumber(height, { useGrouping: false })}`;
}

export function formatCurrency(value: number, currency: string, options?: Omit<Intl.NumberFormatOptions, "style" | "currency">) {
    return formatNumber(value, { ...options, style: "currency", currency });
}
