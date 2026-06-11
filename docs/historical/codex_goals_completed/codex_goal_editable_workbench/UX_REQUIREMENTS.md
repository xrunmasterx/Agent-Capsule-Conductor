# UX Requirements: Minimal, Useful, Clean

## 1. UX principle

The workbench must reduce friction, not become a fancy product.

Primary user problem:

```text
Creating custom nodes is too tedious because it requires writing multiple files manually.
Connecting nodes is too manual because workflow structure is text-only.
Inspecting results is too slow because outputs are scattered across files.
```

## 2. Required first-run experience

A user should be able to do this within minutes:

```text
1. Open local workbench.
2. Click "Create Capsule".
3. Fill id, runtime, prompt, input fields, output fields.
4. Click "Create".
5. Click "Validate".
6. Click "Add to Workflow".
7. Add another capsule node.
8. Connect them.
9. Click "Run".
10. Open Run Inspector and read output.
```

## 3. Layout

Recommended layout:

```text
+--------------------------------------------------+
| Top bar: project / run / save / validate / run    |
+-----------+----------------------+---------------+
| Left      | Center               | Right         |
| Capsule   | Graph / Editor       | Inspector     |
| Palette   |                      |               |
+-----------+----------------------+---------------+
| Bottom: status / logs / validation messages       |
+--------------------------------------------------+
```

## 4. Pages

### Capsules

- list capsules;
- create capsule;
- validate;
- test;
- edit prompt/schema/artifacts.

### Workflows

- list workflow graphs;
- create graph;
- add nodes;
- connect nodes;
- edit node input;
- save;
- validate;
- run.

### Runs

- list runs;
- inspect workflow run;
- inspect node run;
- open artifacts.

## 5. Design constraints

- Plain UI is acceptable.
- Avoid advanced styling.
- Avoid modal-heavy workflows.
- Prefer one clear page over many nested pages.
- Use textarea for JSON/YAML editing if Monaco is too much.
- Use React Flow only for the graph canvas.

## 6. Error messages

Errors must be actionable.

Bad:

```text
Validation failed.
```

Good:

```text
output_schema.json is invalid JSON: line 12, column 3.
```

Bad:

```text
Workflow invalid.
```

Good:

```text
Edge edge_2 points to missing node 'review'.
```
