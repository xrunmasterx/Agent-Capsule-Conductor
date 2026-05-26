# Integration Gaps

Record missing external tools or browser automation gaps here.

## Template

```text
Tool or capability:
Expected command or action:
Observed issue:
Affected goal:
Fallback/mock used:
What user needs to provide:
```

## MCP server

```text
Tool or capability: MCP server for the Goal 3 control plane
Expected command or action: uv run acc control serve --mcp --port 8765
Observed issue: The repository already has a local FastAPI server, but it does not include a committed MCP transport/runtime dependency or a stable MCP tool exposure layer. Adding one in Goal 3 would introduce a new dependency surface and maintenance path beyond the hermetic JSON CLI requirement.
Affected goal: Goal 3 Agent-callable ACC Control Plane
Fallback/mock used: stable JSON CLI commands plus the existing local FastAPI server (uv run acc server --host 127.0.0.1 --port 8765)
What user needs to provide: an explicit MCP runtime/library choice and acceptance scope if MCP support must become a required deliverable instead of an optional integration
```

## Browser automation

```text
Tool or capability: Codex in-app browser control (`iab`)
Expected command or action: use the built-in browser-control path for Goal 4 journeys
Observed issue: the bundled browser-control setup reported `Browser is not available: iab`, so the in-app browser transport was not callable in this environment
Affected goal: Goal 4 Browser E2E UX Optimization
Fallback/mock used: local Playwright runner (`web/scripts/browser-e2e.mjs`) against `uv run acc server` + `npm run dev`
What user needs to provide: no action required for acceptance; only needed if future work must prefer the in-app browser over Playwright
```
