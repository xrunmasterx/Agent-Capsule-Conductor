# Layering Contract

## Import boundaries

Codex must implement tests that fail if forbidden imports appear.

Suggested test approach:

- Use `ast` to scan Python files.
- Enforce import allowlists per package.
- Do not add a heavy dependency just for import validation unless already present.

## Package rules

### domain

Allowed imports:

```text
__future__
typing
dataclasses
enum
pydantic or standard model library if already used
json-compatible primitive typing only
```

Forbidden examples:

```text
os
subprocess
pathlib.Path.write_text
open
click
typer
fastapi
asyncio.create_subprocess_exec
```

### engine

Allowed:

```text
acc.domain
standard algorithms
```

Forbidden:

```text
acc.store
acc.runtime
acc.cli
subprocess
filesystem writes
os.environ
```

### store

Allowed:

```text
acc.domain
acc.ports
pathlib
json
shutil
```

Forbidden:

```text
subprocess
agent runner logic
CLI printing
```

### runtime

Allowed:

```text
acc.domain
acc.ports
subprocess only inside runner implementations
```

Forbidden:

```text
workflow graph mutation
engine validation ownership
CLI printing
full os.environ inheritance
```

### app

Allowed to coordinate all lower layers.

### cli

Allowed to call app and handle presentation.

## Public stdout rule

Any command with `--emit-json` or `--emit-conductor-json` must reserve stdout exclusively for one machine-readable JSON object. Human logs go to stderr or files.
