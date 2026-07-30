export type DecimalValue = string;

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
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

function decimalParts(value: unknown) {
    const normalized = normalizeDecimal(value);
    const sign = normalized.startsWith("-") ? -1 : 1;
    const [whole, fraction = ""] = (sign < 0 ? normalized.slice(1) : normalized).split(".");
    return { sign, scale: fraction.length, units: BigInt(`${whole}${fraction}`) };
}
