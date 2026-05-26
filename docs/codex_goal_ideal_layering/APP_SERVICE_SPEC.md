# Application Service Spec

`acc.app` coordinates the system.

## Responsibilities

- Load workflow templates.
- Apply environment binding.
- Create run/environment frames.
- Call engine validation.
- Ask engine for schedule plan.
- Ask store to materialize inbox.
- Call runtime runner.
- Persist result through store.
- Feed result back to engine.
- Emit stable JSON output for CLI/API.

## App service is the only layer that may know engine + store + runtime together.

This prevents engine from knowing store/runtime, and prevents runtime from knowing graph scheduling.

## Must test

- End-to-end fake workflow execution.
- Nested workflow execution if supported.
- Failure mode aggregation.
- Clean stdout through CLI wrapper.
