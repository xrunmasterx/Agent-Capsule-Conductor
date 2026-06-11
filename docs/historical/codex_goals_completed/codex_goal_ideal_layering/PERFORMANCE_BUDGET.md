# Performance Budget

## Principle

Layering must not introduce obvious algorithmic regressions.

## Expected complexity

- Graph validation: O(V + E) where practical.
- Topological level computation: O(V + E).
- Data materialization planning: O(E_data).
- Scheduling loop: proportional to nodes and dependency edges, not repeated full-tree filesystem scans.

## Sanity benchmarks

Add non-brittle tests or scripts for:

```text
1000 nodes / 2000 edges validate under reasonable local time.
1000 nodes level computation under reasonable local time.
```

Avoid strict CI-flaky thresholds. Prefer warnings in QUALITY_REPORT.md unless performance is catastrophically bad.

## Store performance

- Appending events should be append-only.
- Node scheduling should not scan entire runs/ recursively.
- Artifact viewers should stream or limit large files if implemented.
