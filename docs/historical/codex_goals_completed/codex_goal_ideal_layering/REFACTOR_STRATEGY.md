# Refactor Strategy

## Recommended approach

Use a strangler refactor only if it reduces risk:

1. Build new domain models.
2. Build pure engine functions and tests.
3. Build store around existing run layout or a documented new layout.
4. Build fake runtime runners.
5. Build app service orchestration.
6. Point CLI to app service.
7. Delete or shrink old `acc.clean_workflow`.

## Do not do

- Do not first move files without tests.
- Do not preserve old design if it conflicts with the new model.
- Do not keep compatibility wrappers that hide broken contracts.
- Do not refactor UI/server before core acceptance passes.

## Handling legacy commands

If old commands are kept, they must delegate to the new app service.

If old commands are removed, document replacements in MIGRATION_NOTES.md.
