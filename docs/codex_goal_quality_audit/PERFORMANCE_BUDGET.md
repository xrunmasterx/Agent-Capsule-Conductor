# Performance Budget and Optimization Guide

## Goal

Keep ACC lightweight and responsive without overengineering.

## Required complexity targets

| Area | Target |
|---|---|
| Graph validation | O(V + E) |
| Cycle detection | O(V + E) |
| Topological levels | O(V + E) |
| Ready-node scheduling | O(V + E) plus node execution time |
| Event replay | Streaming or bounded-memory |
| Artifact preview | Bounded-memory for large files |
| Registry lookup | Avoid repeated full scans in hot paths |

## Optimization principles

1. Prefer simple data structures.
2. Avoid global caches unless there is a measured problem.
3. Avoid loading full artifact files into memory for preview.
4. Do not parse every event log repeatedly on every UI refresh.
5. Separate metadata summary from large artifact content.
6. Use indexes for runs/capsules only when needed.
7. Avoid unnecessary async complexity for code that is naturally synchronous.
8. Avoid blocking calls inside async event loops.

## Suggested lightweight benchmarks

If benchmark infra exists, add or run:

```bash
uv run pytest -q tests/perf -m perf
```

Otherwise add small tests or scripts that validate:

- 100-node graph validation succeeds quickly;
- 1000-node synthetic graph validation does not explode;
- large event replay can stream without reading full file at once;
- artifact preview uses truncation/pagination for large files.

## What not to do

Do not add:

- Redis;
- Celery;
- PostgreSQL;
- distributed worker pools;
- caching layers;
- complex scheduling frameworks;

unless there is a real measured bottleneck and a documented reason.
