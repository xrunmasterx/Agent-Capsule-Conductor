# Goal 3: Visual Workbench Read-only MVP

## Objective

Build a read-only local web UI for inspecting Agent Capsule runs, capsules, artifacts, and workflows.

This UI is not a graph editor yet. It must not allow drag-and-drop editing, edge editing, or direct workflow saving.

## Precondition

Goal 2 Local Workbench Server should be complete.

## Recommended stack

- React
- TypeScript
- React Flow for DAG rendering
- Tailwind CSS
- shadcn/ui or equivalent lightweight components

## Required pages

1. Run List
   - list runs
   - show status, workflow, duration, failed node count

2. Run Inspector
   - show DAG or node list
   - click node to view details
   - show input, resolved prompt, output, logs, events, artifacts

3. Capsule Browser
   - list capsules
   - show metadata, runtime, workspace, permissions, schemas

4. Artifact Viewer
   - markdown viewer
   - JSON viewer
   - text/log viewer
   - patch/diff viewer if artifact type is patch

5. Workflow Viewer
   - read workflow YAML
   - render nodes/edges if parseable
   - link workflow node to capsule metadata
   - link run node to run artifact

## Explicit non-goals

- no workflow editing
- no node drag saving
- no edge editing
- no AI patch application
- no team collaboration
- no cloud deployment

## Completion condition

Complete only when the UI can inspect a real `runs/acceptance_fake` or equivalent fixture run via the server API.
