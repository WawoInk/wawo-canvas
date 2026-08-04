import { currentLocale } from "@/i18n/formatters";

export type DecimalValue = string;

type DecimalLocaleParts = {
    decimal: string;
    digits: string[];
    group: string;
    minus: string;
    primaryGroupSize: number;
    secondaryGroupSize: number;
};

const decimalLocaleParts = new Map<string, DecimalLocaleParts>();

export function normalizeDecimal(value: unknown): DecimalValue {
    const text = String(value ?? "").trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return "0";
    const whole = match[2].replace(/^0+(?=\d)/, "");
    const fraction = (match[3] || "").replace(/0+$/, "");
    const unsigned = fraction ? `${whole}.${fraction}` : whole;
    return match[1] === "-" && unsigned !== "0" ? `-${unsigned}` : unsigned;
}

export function nonNegativeDecimal(value: unknown): DecimalValue {
    const normalized = normalizeDecimal(value);
    return normalized.startsWith("-") ? "0" : normalized;
}

export function compareDecimal(left: unknown, right: unknown): number {
    const a = decimalParts(left);
    const b = decimalParts(right);
    if (a.sign !== b.sign) return a.sign > b.sign ? 1 : -1;
    const scale = Math.max(a.scale, b.scale);
    const aValue = a.units * BigInt(10) ** BigInt(scale - a.scale);
    const bValue = b.units * BigInt(10) ** BigInt(scale - b.scale);
    return aValue === bValue ? 0 : (aValue > bValue ? 1 : -1) * a.sign;
}

export function multiplyDecimalByInteger(value: unknown, multiplier: number): DecimalValue {
    const normalized = normalizeDecimal(value);
    const negative = normalized.startsWith("-");
    const [whole, fraction = ""] = (negative ? normalized.slice(1) : normalized).split(".");
    const units = BigInt(`${whole}${fraction}`) * BigInt(Math.max(0, Math.trunc(multiplier)));
    const digits = units.toString().padStart(fraction.length + 1, "0");
    const result = fraction.length ? `${digits.slice(0, -fraction.length) || "0"}.${digits.slice(-fraction.length)}` : digits;
    return normalizeDecimal(negative ? `-${result}` : result);
}

export function formatDecimal(value: unknown): string {
    const normalized = normalizeDecimal(value);
    const negative = normalized.startsWith("-");
    const [whole, fraction] = (negative ? normalized.slice(1) : normalized).split(".");
    const localeParts = getDecimalLocaleParts(currentLocale());
    const groups: string[] = [];
    let end = whole.length;
    let groupSize = localeParts.primaryGroupSize;
    while (end > groupSize) {
        groups.unshift(whole.slice(end - groupSize, end));
        end -= groupSize;
        groupSize = localeParts.secondaryGroupSize;
    }
    groups.unshift(whole.slice(0, end));
    const localizeDigits = (text: string) => text.replace(/\d/g, (digit) => localeParts.digits[Number(digit)]);
    const grouped = groups.map(localizeDigits).join(localeParts.group);
    return `${negative ? localeParts.minus : ""}${grouped}${fraction ? `${localeParts.decimal}${localizeDigits(fraction)}` : ""}`;
}

function decimalParts(value: unknown) {
    const normalized = normalizeDecimal(value);
    const sign = normalized.startsWith("-") ? -1 : 1;
    const [whole, fraction = ""] = (sign < 0 ? normalized.slice(1) : normalized).split(".");
    return { sign, scale: fraction.length, units: BigInt(`${whole}${fraction}`) };
}

function getDecimalLocaleParts(locale: string): DecimalLocaleParts {
    const cached = decimalLocaleParts.get(locale);
    if (cached) return cached;
    const formatter = new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 1 });
    const sample = formatter.formatToParts(1_234_567_890_123.4);
    const integerGroups = sample.filter((part) => part.type === "integer").map((part) => part.value.length);
    const primaryGroupSize = integerGroups.at(-1) || 3;
    const parts = {
        decimal: sample.find((part) => part.type === "decimal")?.value || ".",
        digits: Array.from({ length: 10 }, (_, digit) => new Intl.NumberFormat(locale, { useGrouping: false }).format(digit)),
        group: sample.find((part) => part.type === "group")?.value || ",",
        minus: formatter.formatToParts(-1).find((part) => part.type === "minusSign")?.value || "-",
        primaryGroupSize,
        secondaryGroupSize: integerGroups.at(-2) || primaryGroupSize,
    };
    decimalLocaleParts.set(locale, parts);
    return parts;
}
