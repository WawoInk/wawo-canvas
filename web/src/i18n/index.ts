import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const supportedLanguages = ["zh-CN", "en-US"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const LANGUAGE_STORAGE_KEY = "infinite-canvas:language";

export function resolveLanguage(language?: string | null): SupportedLanguage {
    return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function localeFromPathname(pathname: string): SupportedLanguage | null {
    const segment = pathname.split("/")[1];
    return supportedLanguages.find((language) => language === segment) || null;
}

export function appPathname(pathname: string) {
    const language = localeFromPathname(pathname);
    return language ? pathname.slice(language.length + 1) || "/" : pathname || "/";
}

export function localeHref(location: Pick<Location, "pathname" | "search" | "hash">, language: SupportedLanguage) {
    const pathname = location.pathname.startsWith("/") ? location.pathname : `/${location.pathname}`;
    return `/${language}${appPathname(pathname)}${location.search}${location.hash}`;
}

const languageDetector = new LanguageDetector();
languageDetector.addDetector({
    name: "localePath",
    lookup: () => (typeof window === "undefined" ? undefined : localeFromPathname(window.location.pathname) || undefined),
});

void i18n
    .use(languageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            "zh-CN": { translation: zhCN },
            "en-US": { translation: enUS },
        },
        supportedLngs: supportedLanguages,
        fallbackLng: "en-US",
        load: "currentOnly",
        detection: {
            order: ["localePath", "localStorage", "navigator"],
            lookupLocalStorage: LANGUAGE_STORAGE_KEY,
            caches: ["localStorage"],
            convertDetectedLanguage: resolveLanguage,
        },
        interpolation: { escapeValue: false },
        returnNull: false,
        react: { useSuspense: false },
    });

export default i18n;
