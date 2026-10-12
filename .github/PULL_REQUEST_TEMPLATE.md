## What changes

<!-- One or two sentences. Link the issue it closes. -->

## Evidence

<!-- For protocol changes: the source of every new command (capture, fixture, official driver,
public project with its licence) and whether it was run on hardware. See docs/ADAPTER_GUIDE.md. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] New writes are behind the experimental opt-in unless verified on hardware
- [ ] No typing data, macro contents or personal configuration in fixtures
- [ ] User-facing text added to `apps/web/src/i18n/locales/en.ts`
- [ ] CHANGELOG.md updated
