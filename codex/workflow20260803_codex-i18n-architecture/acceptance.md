# Internationalization Acceptance

## Required Checks

- [x] `cd web && bun run build`
- [x] `zh-CN` is the default for unsupported browser locales.
- [ ] Browser `zh-*` and `en-*` locales are detected.
- [ ] Manual language selection persists across reloads.
- [ ] Language switching does not reload or change the current route.
- [ ] Ant Design controls switch locale.
- [x] Date, time, number, high-precision decimal, and pluralized copy use locale-aware formatters/resources.
- [ ] `<html lang>` updates with the active locale.
- [ ] Page title and meta description update with the active locale.
- [x] No known frontend-owned user-visible Chinese or English copy remains hardcoded.
- [x] Existing covered application behavior remains unchanged.

## Notes

- The repository has no ESLint dependency or lint script. Acceptance uses TypeScript checking through the existing build command plus browser smoke tests.
- Automated verification completed with 52 passing tests, symmetric 2,029-key locale files, 0 missing static translation keys, passing Prettier checks, and a successful production build.
- Browser-only checks remain unchecked because the user chose to perform the real-browser acceptance manually.
