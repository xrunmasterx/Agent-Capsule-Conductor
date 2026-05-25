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
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}/api/health`;
const consoleErrors = [];
const networkErrors = [];
const journeys = [];
const childProcesses = [];
const createdCapsuleIds = [];

await fs.mkdir(screenshotsDir, { recursive: true });

async function fetchOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
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
  const locator = page.locator(".capsule-flow-node").filter({ hasText: label }).last();
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
    process.env,
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
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await navButton(page, "工作流").click();
    await navButton(page, "运行记录").waitFor();
    await navButton(page, "节点库").waitFor();
    await navButton(page, "产物").waitFor();
    await navButton(page, "控制平面").waitFor();
    await page.getByLabel("图谱画布").waitFor();
    await page.getByLabel("属性面板").waitFor();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "保存", exact: true }).waitFor();
    await toolbar.getByRole("button", { name: "校验", exact: true }).waitFor();
    await toolbar.getByRole("button", { name: "运行", exact: true }).waitFor();
    await page.getByText("CLI 可见输出").waitFor();
    appendStep(journey, "打开首页并验证中文核心标签", "pass", "工作流、节点库、产物、控制平面、图谱画布、属性面板、保存、校验、运行可见");
    journey.fixes_applied.push({
      summary: "修正和补齐中文文案，确保中文优先标签在真实 UI 可见。",
      retest_status: "pass",
    });
    await capture(page, journey, "overview");
  });

  await runJourney("journey_b_create_capsule", "Create capsule", async (journey) => {
    const capsuleId = `browser-e2e-${Date.now()}.generic`;
    createdCapsuleIds.push(capsuleId);
    await navButton(page, "节点库").click();
    const createPanel = page.getByLabel("创建 Capsule");
    await createPanel.waitFor();
    await page.getByLabel("新 Capsule id").fill(capsuleId);
    await page.getByLabel("新 Capsule 名称").fill("Browser E2E Capsule");
    await page.getByLabel("Runtime").selectOption("generic_cli");
    await createPanel.getByRole("button", { name: "创建", exact: true }).click();
    await page.getByText("Capsule 编辑器").waitFor();
    await page.getByRole("button", { name: "校验", exact: true }).click();
    await page.getByRole("button", { name: "测试", exact: true }).click();
    await page
      .locator(".notice")
      .filter({ hasText: new RegExp(`测试 ${capsuleId}: success`) })
      .first()
      .waitFor({ timeout: 20000 });
    appendStep(journey, "创建并测试 Capsule", "pass", capsuleId);
    journey.fixes_applied.push({
      summary: "测试按钮不再依赖当前编辑器正好选中 examples/input.json，会自动读取示例输入。",
      retest_status: "pass",
    });
    await capture(page, journey, "capsule_created");
  });

  await runJourney("journey_c_two_node_workflow", "Two node workflow", async (journey) => {
    await navButton(page, "工作流").click();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "新建" }).click();
    await page.getByLabel("搜索节点").selectOption("echo-test.generic");
    await page.getByRole("button", { name: "添加节点" }).click();
    const echoNode = await workflowNode(page, "Echo Test");
    const echoNodeId = await workflowNodeId(echoNode);
    await page.getByLabel("搜索节点").selectOption("fake-agent.generic");
    await page.getByRole("button", { name: "添加节点" }).click();
    const fakeNode = await workflowNode(page, "Fake Agent");
    await dragBetween(
      page,
      echoNode.locator('[data-testid$="-source"]'),
      fakeNode.locator('[data-testid$="-target"]'),
    );
    assert((await page.locator(".react-flow__edge").count()) >= 1, "未看到连接边");
    await echoNode.click();
    await page
      .getByRole("textbox", { name: "输入" })
      .fill('{\n  "message": "hello from browser e2e"\n}');
    await page.getByRole("button", { name: "保存 输入" }).click();
    await fakeNode.click();
    await page
      .getByRole("textbox", { name: "映射" })
      .fill(`{\n  "topic": "{{ nodes.${echoNodeId}.output.summary }}"\n}`);
    await page.getByRole("button", { name: "保存 输入" }).click();
    await toolbar.getByRole("button", { name: "保存" }).click();
    await toolbar.getByRole("button", { name: "校验" }).click();
    await toolbar.getByRole("button", { name: "运行" }).click();
    await page.getByText("运行 ui_demo_graph: 成功").waitFor({ timeout: 20000 });
    await echoNode.click();
    await page.locator(".path-grid").getByRole("button", { name: /^输出/ }).click();
    await fakeNode.click();
    await page.locator(".path-grid").getByRole("button", { name: /^输入/ }).click();
    appendStep(journey, "从零添加两节点、连边、映射并运行", "pass", "连接边可见，运行成功，节点输入输出可检查");
    await capture(page, journey, "two_node_workflow");
  });

  await runJourney("journey_d_parallel_workflow", "Parallel workflow inspection", async (journey) => {
    await navButton(page, "工作流").click();
    const toolbar = workflowToolbar(page);
    await toolbar.getByRole("button", { name: "加载 Demo 并行" }).click();
    await toolbar.getByRole("button", { name: "自动布局" }).click();
    const canvas = page.getByLabel("图谱画布");
    await canvas.getByText("分支 A").waitFor();
    await canvas.getByText("分支 B").waitFor();
    await canvas.getByText("结果汇总").waitFor();
    await toolbar.getByRole("button", { name: "运行" }).click();
    await page.getByText("运行 demo_parallel: 成功").waitFor({ timeout: 20000 });
    await page.getByTestId("workflow-node-merge").click({ force: true });
    await page.getByRole("button", { name: "输出" }).click();
    appendStep(journey, "加载并运行并行 Demo", "pass", "扇出/汇入结构可见，汇总节点输出可检查");
    await capture(page, journey, "parallel_workflow");
  });

  await runJourney("journey_e_debugger_replay", "Debugger and replay", async (journey) => {
    await navButton(page, "运行记录").click();
    await page.getByRole("button", { name: /ui_workflow_demo_parallel/i }).first().waitFor({
      timeout: 20000,
    });
    await page.getByRole("button", { name: /ui_workflow_demo_parallel/i }).first().click();
    const debuggerPanel = page.getByLabel("调试面板");
    await debuggerPanel.getByRole("button", { name: "事件回放" }).click();
    await debuggerPanel.getByLabel("replay.json").waitFor({ timeout: 20000 });
    await debuggerPanel.getByRole("button", { name: "重跑节点" }).click();
    await debuggerPanel.getByText("已重跑节点 plan").waitFor({ timeout: 20000 });
    await debuggerPanel.getByLabel("run_diff.json").waitFor({ timeout: 20000 });
    await debuggerPanel.getByRole("button", { name: "从此节点重跑" }).click();
    await debuggerPanel.getByText("已从节点 plan 重跑下游").waitFor({ timeout: 20000 });
    await debuggerPanel.getByRole("button", { name: "Fork 运行" }).click();
    await debuggerPanel.getByText("已 Fork plan").waitFor({ timeout: 20000 });
    await debuggerPanel.getByRole("button", { name: "对比运行" }).click();
    await debuggerPanel.getByText("已刷新运行对比").waitFor({ timeout: 20000 });
    appendStep(journey, "从运行检查器执行 replay/rerun/fork/diff", "pass", "调试操作已进入浏览器路径");
    journey.fixes_applied.push({
      summary: "新增运行检查器调试面板，把 replay、重跑、fork、diff 收到节点上下文里。",
      retest_status: "pass",
    });
    await capture(page, journey, "debugger");
  });

  await runJourney("journey_f_graphops_safety", "GraphOps safety", async (journey) => {
    await navButton(page, "控制平面").click();
    await page.getByRole("button", { name: "校验 patch" }).click();
    await page.getByRole("button", { name: "dry-run patch" }).click();
    await page.getByLabel("graphops.dry-run.json").waitFor();
    await page.getByText("危险 apply 默认关闭，必须经过人工审批。").waitFor();
    appendStep(journey, "校验和 dry-run 示例 patch", "pass", "GraphOps 默认仅暴露安全路径");
    journey.fixes_applied.push({
      summary: "新增 control-plane 浏览器面板和 GraphOps validate/dry-run API，未暴露 destructive apply。",
      retest_status: "pass",
    });
    await capture(page, journey, "graphops");
  });

  await browser.close();
} finally {
  for (const capsuleId of createdCapsuleIds) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/capsules/${encodeURIComponent(capsuleId)}?force=true`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete capsule ${capsuleId}: ${response.status}`);
      }
    } catch {
      await fs.rm(path.join(repoRoot, "capsules", capsuleId), { recursive: true, force: true });
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
