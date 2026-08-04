# Internationalization Decisions

## Scope

- Frontend-only migration under `web/`.
- Preserve all existing routes, business behavior, stores, and API contracts.
- Keep server-provided `{ code, data, msg }` messages unchanged; translate frontend-owned fallbacks and validation messages.

## Architecture

- Use `i18next`, `react-i18next`, and `i18next-browser-languagedetector`.
- Supported locales are `zh-CN` and `en-US`.
- Detection order is persisted user choice, then browser locale.
- Normalize `zh-*` to `zh-CN`, `en-*` to `en-US`, and unsupported browser locales to `zh-CN`.
- Missing resources fall back to `en-US`.
- Persist the selected locale in `localStorage` under `infinite-canvas:language`.
- Keep locale state out of Zustand because i18next already owns and publishes it.
- Keep URL paths unchanged; this authenticated SPA does not use locale prefixes.

## Integration

- Initialize i18n before React renders.
- Switch Ant Design and Day.js locale from the active i18next language.
- Update `html[lang]`, document title, and meta description at runtime.
- Put the language selector in `UserStatusActions` so it is available in the public shell, admin shell, and Canvas toolbar.
- Keep shared locale JSON files serially owned to avoid Subagent write conflicts.

## Resource Keys

- Use semantic namespaces such as `common`, `navigation`, `auth`, `home`, `account`, `assets`, `workbench`, `admin`, `canvas`, `errors`, and `seo`.
- Visible invariant names such as Canvan, OpenAI, Gemini, and WebDAV still come from resources or runtime data when rendered as UI copy.
- Machine values, protocol identifiers, model IDs, MIME types, URLs, and user content are not translated.
- AI system prompts, tool schema descriptions, and raw Agent/server messages remain stable machine-facing content; translated labels, confirmations, statuses, and frontend fallbacks are layered on top.
- Persisted and cross-module states use locale-neutral machine values. WebDAV stages and generation log statuses are translated only when rendered.
- High-precision credit values stay as normalized decimal strings; locale separators and digit glyphs are derived from `Intl.NumberFormat.formatToParts()` without converting the value to a lossy JavaScript number.
