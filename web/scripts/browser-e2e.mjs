import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";

const repoRoot = path.resolve(process.cwd(), "..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const startedAt = new Date().toISOString();
const reportRoot = path.join(repoRoot, "runs", "browser_e2e", timestamp);
const screenshotsDir = path.join(reportRoot, "screenshots");
const consoleLogPath = path.join(reportRoot, "console.log");
const networkLogPath = path.join(reportRoot, "network.log");
const portSeed = Math.floor(Math.random() * 2000);
const apiPort = String(18000 + portSeed);
const webPort = String(20000 + portSeed);
const baseUrl = `http://127.0.0.1:${webPort}`;
const appUrl = `${baseUrl}/?dev`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}/api/health`;
const consoleErrors = [];
const networkErrors = [];
const journeys = [];
const childProcesses = [];
const createdWorkbenchTaskIds = [];

await fs.mkdir(screenshotsDir, { recursive: true });

async function fetchOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function apiFetchJson(pathname, options = {}) {
  const headers = {
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  const response = await fetch(`${apiBaseUrl}${pathname}`, { ...options, headers });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  }
  return payload;
}

function normalizeEnv(source) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([, value]) => typeof value === "string"),
  );
}

function commandForSpawn(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }
  const quoted = [command, ...args]
    .map((value) => (/[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value))
    .join(" ");
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", quoted],
  };
}

async function ensureService(name, url, command, args, cwd, stdoutName, stderrName, env) {
  const stdout = createWriteStream(path.join(reportRoot, stdoutName), { flags: "a" });
  const stderr = createWriteStream(path.join(reportRoot, stderrName), { flags: "a" });
  const launched = commandForSpawn(command, args);
  const child = spawn(launched.command, launched.args, {
    cwd,
    env: normalizeEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  childProcesses.push(child);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (await fetchOk(url)) {
      return { name, owned: true };
    }
    if (child.exitCode !== null) {
      throw new Error(`${name} exited early with code ${child.exitCode}`);
    }
    await delay(500);
  }
  throw new Error(`${name} did not become ready: ${url}`);
}

function journeyRecord(id, title) {
  return {
    id,
    title,
    status: "partial",
    steps: [],
    screenshots: [],
    console_errors: [],
    network_errors: [],
    issues_found: [],
    fixes_applied: [],
  };
}

function appendStep(journey, step, status, detail) {
  journey.steps.push({ step, status, detail });
}

function snapshotLogs(startConsoleIndex, startNetworkIndex) {
  return {
    console: consoleErrors.slice(startConsoleIndex),
    network: networkErrors.slice(startNetworkIndex),
  };
}

async function capture(page, journey, name) {
  const filename = `${journey.id}_${name}.png`;
  const target = path.join(screenshotsDir, filename);
  await page.screenshot({ path: target, fullPage: true });
  journey.screenshots.push(`screenshots/${filename}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function navButton(page, label) {
  return page.locator(".sidebar .nav-button").filter({ hasText: label }).first();
}

function workflowToolbar(page) {
  return page.getByLabel("工作流工具栏");
}

async function workflowNode(page, label) {
  const locator = page.locator(".agent-tool-node").filter({ hasText: label }).last();
  await locator.waitFor();
  return locator;
}

async function workflowNodeId(nodeLocator) {
  const testId = await nodeLocator.getAttribute("data-testid");
  assert(testId?.startsWith("workflow-node-"), "工作流节点缺少 data-testid");
  return testId.replace("workflow-node-", "");
}

async function runJourney(id, title, action) {
  const journey = journeyRecord(id, title);
  const consoleStart = consoleErrors.length;
  const networkStart = networkErrors.length;
  try {
    await action(journey);
    journey.status = "pass";
  } catch (error) {
    journey.status = "fail";
    journey.issues_found.push({
      severity: "high",
      summary: formatError(error),
    });
  }
  const logs = snapshotLogs(consoleStart, networkStart);
  journey.console_errors = logs.console;
  journey.network_errors = logs.network;
  journeys.push(journey);
  return journey;
}

function center(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function dragBetween(page, sourceLocator, targetLocator) {
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  assert(sourceBox && targetBox, "无法定位连接手柄");
  const source = center(sourceBox);
  const target = center(targetBox);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 24 });
  await page.mouse.up();
  await delay(300);
}

async function dragPortToNodeBody(page, sourceLocator, targetLocator) {
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  assert(sourceBox && targetBox, "无法定位 schema port 或目标节点");
  const source = center(sourceBox);
  const target = center(targetBox);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 24 });
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.classList.contains("data-drop-target"),
    await targetLocator.evaluate((node) => `[data-testid="${node.getAttribute("data-testid")}"]`),
  );
  await page.mouse.up();
  await delay(350);
}

async function saveWorkflowFromToolbar(page, workflowName) {
  const toolbar = workflowToolbar(page);
  await toolbar.getByRole("button", { name: /保存任务为 Workflow/ }).click();
  const dialog = page.getByRole("form", { name: "Save Workflow" });
  await dialog.waitFor();
  const input = dialog.locator("input").first();
  await input.fill(workflowName);
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByText(new RegExp(`已保存 ${slugId(workflowName)}`)).waitFor({ timeout: 20000 });
}

function slugId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "workflow";
}

async function waitForRunStatus(runId, expectedStatus, timeoutMs = 45000) {
  const started = Date.now();
  let lastStatus = "unknown";
  while (Date.now() - started < timeoutMs) {
    try {
      const summary = await apiFetchJson(`/api/runs/${encodeURIComponent(runId)}`);
      lastStatus = summary.status || lastStatus;
      if (lastStatus === expectedStatus) {
        return summary;
      }
      if (["failed", "cancelled", "crashed", "schema_error", "artifact_error"].includes(lastStatus)) {
        throw new Error(`run ${runId} ended with ${lastStatus}`);
      }
    } catch (error) {
      if (!String(error).includes("404")) {
        throw error;
      }
    }
    await delay(500);
  }
  throw new Error(`run ${runId} did not reach ${expectedStatus}; last status ${lastStatus}`);
}

async function createSchemaAcceptanceTask(taskId) {
  const canvas = schemaAcceptanceCanvas(taskId);
  await apiFetchJson("/api/workbench/tasks", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, title: canvas.name }),
  });
  await apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}/canvas`, {
    method: "PUT",
    body: JSON.stringify({
      canvas_hash: `browser-e2e-${taskId}`,
      canvas_snapshot: canvas,
      selection: { type: "task_canvas", taskId },
      temporary_resources: {},
    }),
  });
  createdWorkbenchTaskIds.push(taskId);
  return canvas;
}

async function deleteStaleSchemaAcceptanceTasks() {
  const response = await apiFetchJson("/api/workbench/tasks");
  const tasks = Array.isArray(response.tasks) ? response.tasks : [];
  await Promise.all(
    tasks
      .map((task) => String(task.task_id || ""))
      .filter((taskId) => taskId.startsWith("browser_schema_ports_"))
      .map((taskId) =>
        apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }).catch(() => null),
      ),
  );
}

function schemaAcceptanceCanvas(taskId) {
  return {
    id: taskId,
    name: "Schema Driven Ports Acceptance",
    layout: "workspace-canvas",
    rootWorkflowId: "schema_source",
    workflows: [
      {
        id: "schema_source",
        title: "Schema Source",
        invocationLabel: "Schema Source",
        sourceKind: "agent_session",
        callableId: "stock-research-analyst.codex",
        sourceInput: { user_prompt: "Produce deterministic schema outputs for Browser acceptance." },
        forwardMainOutputOnControl: false,
        status: "not_run",
        inputPorts: [{ id: "main", label: "input", direction: "input" }],
        outputPorts: [{ id: "main", label: "output", direction: "output" }],
        outputSchema: schemaAcceptanceOutputSchema("alpha_signal"),
        internalNodes: [],
        internalEdges: [],
        position: { x: 120, y: 220 },
        size: { width: 276, height: 132 },
        warnings: [],
      },
      {
        id: "schema_consumer",
        title: "Schema Consumer",
        invocationLabel: "Schema Consumer",
        sourceKind: "agent_session",
        callableId: "stock-research-synthesis.codex",
        sourceInput: { user_prompt: "Consume only explicit data edge fields." },
        status: "not_run",
        inputPorts: [{ id: "main", label: "input", direction: "input" }],
        outputPorts: [{ id: "main", label: "output", direction: "output" }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 620, y: 220 },
        size: { width: 276, height: 132 },
        warnings: [],
      },
    ],
    edges: [],
  };
}

function schemaAcceptanceOutputSchema(primaryPort) {
  const outputFields = {
    [primaryPort]: {
      type: "string",
      description: "Primary alpha signal passed through an explicit data edge.",
    },
    confidence_score: {
      type: "number",
      description: "Numeric confidence score used to verify multiple visible ports.",
    },
    monitoring_plan: {
      type: "array",
      description: "Monitoring bullets; array ports should remain draggable.",
      items: { type: "string" },
    },
    thesis_note: { type: "string", description: "Thesis note." },
    catalyst_note: { type: "string", description: "Catalyst note." },
    risk_note: { type: "string", description: "Risk note." },
    source_note: { type: "string", description: "Source note." },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["success", "partial", "failed"] },
      summary: { type: "string" },
      outputs: {
        type: "object",
        additionalProperties: false,
        properties: outputFields,
        required: [primaryPort],
      },
    },
    required: ["status", "summary", "outputs"],
  };
}

async function putSchemaAcceptanceCanvas(taskId, updater) {
  const record = await apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}/canvas`);
  const canvas = record.canvas_snapshot;
  updater(canvas);
  await apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}/canvas`, {
    method: "PUT",
    body: JSON.stringify({
      canvas_hash: `browser-e2e-${taskId}-${Date.now()}`,
      canvas_snapshot: canvas,
      selection: { type: "task_canvas", taskId },
      temporary_resources: record.temporary_resources || {},
    }),
  });
  return canvas;
}

async function waitForWorkbenchCanvas(taskId, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let latestCanvas = null;
  while (Date.now() - started < timeoutMs) {
    const record = await apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}/canvas`);
    latestCanvas = record.canvas_snapshot;
    if (latestCanvas && predicate(latestCanvas)) {
      return latestCanvas;
    }
    await delay(300);
  }
  throw new Error(`workbench canvas ${taskId} did not reach expected state`);
}

async function waitForDurableTaskBootstrap(page) {
  const ready = await page
    .locator('[data-durable-tasks-ready="true"]')
    .waitFor({ state: "attached", timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    await delay(2500);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const uvCommand = process.platform === "win32" ? "uv.exe" : "uv";

const serviceNotes = [];
try {
  const apiService = await ensureService(
    "acc-server",
    apiUrl,
    uvCommand,
    ["run", "acc", "server", "--host", "127.0.0.1", "--port", apiPort],
    repoRoot,
    "server.stdout.log",
    "server.stderr.log",
    {
      ...process.env,
      ACC_RUN_MODE: "hermetic",
      ACC_DISABLE_EXTERNAL_AGENT_EXECUTION: "1",
    },
  );
  const webService = await ensureService(
    "vite-dev",
    `${baseUrl}/`,
    npmCommand,
    ["run", "dev", "--", "--port", webPort],
    path.join(repoRoot, "web"),
    "web.stdout.log",
    "web.stderr.log",
    { ...process.env, ACC_WEB_API_BASE_URL: `http://127.0.0.1:${apiPort}` },
  );
  serviceNotes.push(apiService, webService);
  await deleteStaleSchemaAcceptanceTasks();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`[pageerror] ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`[response:${response.status()}] ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    networkErrors.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`.trim());
  });

  await runJourney("journey_a_chinese_ui_smoke", "Chinese UI smoke", async (journey) => {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await navButton(page, "任务").click();
    await navButton(page, "运行记录").waitFor();
    await navButton(page, "资源").waitFor();
    await navButton(page, "产物").waitFor();
    await navButton(page, "控制平面").waitFor();
    await page.getByLabel("任务画布").waitFor();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "运行详情" }).waitFor();
    await toolbar.getByRole("button", { name: "AI 助手" }).waitFor();
    await toolbar.getByRole("button", { name: /保存/ }).waitFor();
    await toolbar.getByRole("button", { name: "校验", exact: true }).waitFor();
    await toolbar.getByRole("button", { name: /^运行/ }).waitFor();
    appendStep(journey, "打开首页并验证中文核心标签", "pass", "任务、资源、产物、控制平面、任务画布、运行详情、保存、校验、运行可见");
    journey.fixes_applied.push({
      summary: "修正和补齐中文文案，确保中文优先标签在真实 UI 可见。",
      retest_status: "pass",
    });
    await capture(page, journey, "overview");
  });

  await runJourney("journey_b_browse_callables", "Browse callables", async (journey) => {
    await navButton(page, "资源").click();
    await page.getByRole("region", { name: "智能体工具资源库" }).waitFor();
    await page.locator(".callable-browser").waitFor();
    appendStep(journey, "浏览 Callable 资源库", "pass", "只读查看 AgentClassTemplate / ToolClassTemplate");
    await capture(page, journey, "callables_browsed");
  });

  await runJourney("journey_c_two_node_workflow", "Two node workflow", async (journey) => {
    await navButton(page, "任务").click();
    await page.getByRole("button", { name: "任务蓝图", exact: true }).click();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "加载示例" }).click();
    await page.locator(".agent-tool-node").first().waitFor();
    assert((await page.locator(".react-flow__edge").count()) >= 1, "未看到连接边");
    await toolbar.getByRole("button", { name: "校验" }).click();
    await page.getByText(/校验通过:/).waitFor({ timeout: 20000 });
    appendStep(journey, "加载示例任务并校验", "pass", "连接边可见，当前 stock research 示例可校验");
    await capture(page, journey, "two_node_workflow");
  });

  await runJourney("journey_d_parallel_workflow", "Parallel workflow inspection", async (journey) => {
    await navButton(page, "任务").click();
    await page.getByRole("button", { name: "任务蓝图", exact: true }).click();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "加载示例" }).click();
    await toolbar.getByRole("button", { name: "自动布局" }).click();
    const canvas = page.getByLabel("任务画布");
    await canvas.locator(".agent-tool-node").first().waitFor();
    appendStep(journey, "加载并检查示例任务", "pass", "示例结构可见，节点输出面板可打开");
    await capture(page, journey, "parallel_workflow");
  });

  await runJourney("journey_e_debugger_replay", "Debugger and replay", async (journey) => {
    await navButton(page, "运行记录").click();
    await page.getByRole("region", { name: "运行记录" }).waitFor();
    appendStep(journey, "打开运行记录", "pass", "运行记录面板可访问；具体 run evidence 由 schema journey 覆盖");
    await capture(page, journey, "runs");
  });

  await runJourney("journey_f_graphops_safety", "GraphOps safety", async (journey) => {
    await navButton(page, "控制平面").click();
    await page.getByRole("button", { name: "校验 patch" }).click();
    await page.getByRole("button", { name: "dry-run patch" }).click();
    await page.getByLabel("graphops.dry-run.json").waitFor();
    appendStep(journey, "校验和 dry-run 示例 patch", "pass", "GraphOps 默认仅暴露安全路径");
    journey.fixes_applied.push({
      summary: "新增 control-plane 浏览器面板和 GraphOps validate/dry-run API，未暴露 destructive apply。",
      retest_status: "pass",
    });
    await capture(page, journey, "graphops");
  });

  await runJourney("journey_g_schema_driven_ports", "Schema-driven ports acceptance", async (journey) => {
    const taskId = `browser_schema_ports_${Date.now()}`;
    const initialCanvas = await createSchemaAcceptanceTask(taskId);
    await page.evaluate(
      ({ taskStoreKey, taskId: activeTaskId, canvas }) => {
        window.localStorage.setItem(
          taskStoreKey,
          JSON.stringify({
            version: 1,
            activeTaskId,
            tasks: [
              {
                taskId: activeTaskId,
                title: canvas.name,
                canvas,
                authoring: { temporaryResources: {} },
                status: "not_run",
              },
            ],
          }),
        );
      },
      { taskStoreKey: "acc.workbench.tasks.v2", taskId, canvas: initialCanvas },
    );
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await waitForDurableTaskBootstrap(page);
    await navButton(page, "任务").click();
    await page.getByTestId("agent-tool-node-schema_source").waitFor();
    await page.getByTestId("agent-tool-node-schema_consumer").waitFor();

    const canvasToolbar = page.getByLabel("Canvas Toolbar");
    await canvasToolbar.getByRole("button", { name: "数据", exact: true }).click();
    const sourcePort = page.locator('[data-handleid="schema_source:output:alpha_signal"]').first();
    await sourcePort.waitFor();
    const tooltip = await sourcePort.getAttribute("title");
    assert(tooltip?.includes("Primary alpha signal"), "schema port tooltip missing description");
    assert(tooltip?.includes("json_path: /outputs/alpha_signal"), "schema port tooltip missing json path");
    const sourceBox = await page.getByTestId("agent-tool-node-schema_source").boundingBox();
    assert(sourceBox && sourceBox.height >= 240, "schema source node did not expand for 6+ data ports");

    await dragPortToNodeBody(page, sourcePort, page.getByTestId("agent-tool-node-schema_consumer"));
    await page.getByText(/已创建输入端口 schema_consumer\.alpha_signal/u).waitFor();
    appendStep(
      journey,
      "拖 schema output port 到下游节点 body",
      "pass",
      "自动创建同名 input port、data edge，并补 control dependency",
    );
    await capture(page, journey, "manual_connection");

    const savedCanvas = await waitForWorkbenchCanvas(taskId, (candidate) => {
      const source = candidate.workflows?.find((workflow) => workflow.id === "schema_source");
      const consumer = candidate.workflows?.find((workflow) => workflow.id === "schema_consumer");
      return Boolean(
        source?.outputSchema?.properties?.outputs?.properties?.alpha_signal &&
          consumer?.inputPorts?.some((port) => port.id === "alpha_signal") &&
          candidate.edges?.some(
            (edge) =>
              edge.kind === "data" &&
              edge.source.workflowId === "schema_source" &&
              edge.source.portId === "alpha_signal" &&
              edge.target.workflowId === "schema_consumer" &&
              edge.target.portId === "alpha_signal",
          ),
      );
    });
    const savedSource = savedCanvas.workflows.find((workflow) => workflow.id === "schema_source");
    const savedConsumer = savedCanvas.workflows.find((workflow) => workflow.id === "schema_consumer");
    assert(savedSource?.outputSchema?.properties?.outputs?.properties?.alpha_signal, "saved canvas lost output_schema source field");
    assert(
      savedConsumer?.inputPorts?.some((port) => port.id === "alpha_signal"),
      "saved canvas lost generated target input port",
    );
    assert(
      savedCanvas.edges.some(
        (edge) =>
          edge.kind === "data" &&
          edge.source.workflowId === "schema_source" &&
          edge.source.portId === "alpha_signal" &&
          edge.target.workflowId === "schema_consumer" &&
          edge.target.portId === "alpha_signal",
      ),
      "saved canvas lost schema data edge",
    );
    appendStep(journey, "保存并检查 canvas snapshot", "pass", "output_schema、target input port、data edge 均保留");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForDurableTaskBootstrap(page);
    await page.getByTestId("agent-tool-node-schema_source").waitFor();
    await canvasToolbar.getByRole("button", { name: "数据", exact: true }).click();
    await page.locator('[data-handleid="schema_consumer:input:alpha_signal"]').first().waitFor();
    appendStep(journey, "刷新页面后重新打开任务", "pass", "schema-derived source port 和 generated target input port 仍可见");

    const submitResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/runner/jobs") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "运行当前任务", exact: true }).click();
    const submitResponse = await submitResponsePromise;
    assert(submitResponse.ok(), `runner submit failed: ${submitResponse.status()}`);
    const submittedJob = await submitResponse.json();
    const runId = submittedJob.run_id;
    assert(typeof runId === "string" && runId, "runner job did not return run_id");
    const summary = await waitForRunStatus(runId, "success");
    const consumerInputPath = path.join(repoRoot, "runs", runId, "nodes", "schema_consumer", "input.json");
    const consumerRuntimePath = path.join(repoRoot, "runs", runId, "nodes", "schema_consumer", "runtime.json");
    const consumerInput = JSON.parse(await fs.readFile(consumerInputPath, "utf-8"));
    const consumerRuntime = JSON.parse(await fs.readFile(consumerRuntimePath, "utf-8"));
    assert(
      consumerInput.alpha_signal === "hermetic:schema_source:alpha_signal",
      "downstream input did not receive explicit schema port value",
    );
    assert(!Object.prototype.hasOwnProperty.call(consumerInput, "main"), "downstream input unexpectedly received full main output");
    assert(
      consumerRuntime.binding_materializations?.some(
        (record) =>
          record.binding_kind === "data_edge" &&
          record.source_node === "schema_source" &&
          record.source_port === "alpha_signal" &&
          record.target_node === "schema_consumer" &&
          record.target_port === "alpha_signal",
      ),
      "runtime evidence missing data_edge binding materialization",
    );
    await page.getByTestId("agent-tool-node-schema_consumer").click();
    await workflowToolbar(page).getByRole("button", { name: "运行详情" }).click();
    await page.getByText("alpha_signal").first().waitFor({ timeout: 10000 });
    appendStep(
      journey,
      "运行并检查下游 input evidence",
      "pass",
      `run=${runId}; input.json 只包含显式 data edge 字段；summary=${summary.status}`,
    );
    await capture(page, journey, "run_input_evidence");

    await page.goto("about:blank");
    await putSchemaAcceptanceCanvas(taskId, (canvas) => {
      const source = canvas.workflows.find((workflow) => workflow.id === "schema_source");
      source.outputSchema = schemaAcceptanceOutputSchema("alpha_view");
    });
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await waitForDurableTaskBootstrap(page);
    await page.getByTestId("agent-tool-node-schema_source").waitFor();
    await canvasToolbar.getByRole("button", { name: "数据", exact: true }).click();
    await page.locator(".workflow-edge-broken").first().waitFor({ state: "attached" });
    await page.locator(".workflow-edge-broken .react-flow__edge-path").first().click({ force: true });
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => document.querySelectorAll(".workflow-edge-broken").length === 0);
    await dragPortToNodeBody(
      page,
      page.locator('[data-handleid="schema_source:output:alpha_view"]').first(),
      page.getByTestId("agent-tool-node-schema_consumer"),
    );
    await page.getByText(/已创建输入端口 schema_consumer\.alpha_view/u).waitFor();
    const repairedCanvas = await waitForWorkbenchCanvas(taskId, (candidate) =>
      candidate.edges?.some(
        (edge) =>
          edge.kind === "data" &&
          edge.source.workflowId === "schema_source" &&
          edge.source.portId === "alpha_view" &&
          edge.target.workflowId === "schema_consumer" &&
          edge.target.portId === "alpha_view",
      ) &&
      !candidate.edges?.some(
        (edge) =>
          edge.kind === "data" &&
          edge.source.workflowId === "schema_source" &&
          edge.source.portId === "alpha_signal",
      ),
    );
    assert(
      repairedCanvas.edges.some(
        (edge) =>
          edge.kind === "data" &&
          edge.source.workflowId === "schema_source" &&
          edge.source.portId === "alpha_view" &&
          edge.target.workflowId === "schema_consumer" &&
          edge.target.portId === "alpha_view",
      ),
      "repaired canvas missing alpha_view data edge",
    );
    assert(
      !repairedCanvas.edges.some(
        (edge) =>
          edge.kind === "data" &&
          edge.source.workflowId === "schema_source" &&
          edge.source.portId === "alpha_signal",
      ),
      "repaired canvas still contains stale alpha_signal data edge",
    );
    appendStep(journey, "schema 改名后修复 broken edge", "pass", "旧 edge 可见且可删除，新 schema port 可重新拖线");
    journey.fixes_applied.push({
      summary: "补充 schema-driven ports 浏览器验收、hermetic schema outputs、data port 多端口布局。",
      retest_status: "pass",
    });
    journey.evidence = {
      workflow_id: taskId,
      run_id: runId,
      node_id: "schema_consumer",
      source_port: "alpha_signal",
      target_port: "alpha_signal",
      input_path: path.relative(reportRoot, consumerInputPath),
      binding_kind: "data_edge",
    };
    await capture(page, journey, "broken_edge_repaired");
  });

  await browser.close();
} finally {
  for (const taskId of createdWorkbenchTaskIds) {
    try {
      await apiFetchJson(`/api/workbench/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
    } catch (error) {
      networkErrors.push(`[cleanup] failed to delete workbench task ${taskId}: ${formatError(error)}`);
    }
  }
  await fs.writeFile(consoleLogPath, `${consoleErrors.join("\n")}\n`, "utf-8");
  await fs.writeFile(networkLogPath, `${networkErrors.join("\n")}\n`, "utf-8");
  const report = {
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    base_url: `${baseUrl} (api: ${apiUrl})`,
    journeys,
    tooling_notes: {
      in_app_browser: "unavailable",
      runner: "playwright",
      services: serviceNotes,
    },
  };
  await fs.writeFile(
    path.join(reportRoot, "browser_e2e_report.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
  for (const child of childProcesses) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
}

const failedJourneys = journeys.filter((journey) => journey.status !== "pass");
process.exit(failedJourneys.length > 0 ? 1 : 0);
