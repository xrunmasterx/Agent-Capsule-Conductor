# Execution Boundaries

## Must preserve

- `uv run pytest -q` passes.
- `uv run ruff check .` passes.
- `acc run ... --emit-conductor-json` stdout remains exactly one JSON object.
- `acc workflow run ... --emit-json` stdout remains exactly one JSON object.
- Default tests remain hermetic.
- Default tests do not require real Codex, Claude, Cursor, Gemini, Hermes, Conductor, network, or paid services.
- Existing capsule runner compatibility paths remain supported.
- Existing `.accflow.json` examples continue to validate/run through normalization or have explicit migration notes.
- Existing legacy `.graph.json` behavior remains compatible or has explicit migration notes and tests.
- GraphOps remains proposal -> validation -> dry-run -> human approval -> apply.

## Forbidden

- Do not implement a custom LLM agent loop.
- Do not rewrite mature agent adapters.
- Do not introduce a database, cloud backend, Kubernetes, distributed workers, or SaaS features.
- Do not copy Microsoft Conductor's full DSL.
- Do not allow GraphOps or LLM-generated changes to auto-apply destructive mutations.
- Do not store local absolute workspace paths in workflow templates.
- Do not write session state back into class templates or workflow function templates.
- Do not let sender nodes write directly into receiver workspaces or inboxes.
- Do not weaken stdout JSON contracts.
- Do not pass the full host environment to real or fake runners by default.

## Allowed

- Add domain types.
- Add schemas.
- Add manifests.
- Refactor `acc.app` into smaller coordination modules.
- Map `CapsuleSpec` to new class template compatibility views.
- Add `.accflow.json` normalization for legacy node fields.
- Add migration notes.
- Keep legacy fields as compatibility fields while marking their preferred replacements.

