# 中文市场调研与分析示例

这个目录保存一个隔离的两节点 demo。它不会进入默认 `capsules/` 或 `workflows/`
目录，主要用于验证 capsule handoff、run inspection 和 Workbench artifact 展示。

## 运行调研节点

```powershell
uv run acc run market-news-research.generic `
  --capsules-dir examples/market_research_analysis/capsules `
  --input examples/market_research_analysis/capsules/market-news-research.generic/examples/input.json `
  --run-dir runs/market_research_demo `
  --emit-conductor-json
```

## 运行分析节点

```powershell
uv run acc run market-investment-analysis.generic `
  --capsules-dir examples/market_research_analysis/capsules `
  --input examples/market_research_analysis/capsules/market-investment-analysis.generic/examples/input.json `
  --run-dir runs/market_analysis_demo `
  --emit-conductor-json
```

## 让 Workbench 指向这个示例目录

如果需要让 Workbench 的 capsule/workflow 列表指向这个示例目录，可以在启动 server
前设置：

```powershell
$env:ACC_CAPSULES_DIR = "examples/market_research_analysis/capsules"
$env:ACC_WORKFLOWS_DIR = "examples/market_research_analysis/workflows"
uv run acc server --host 127.0.0.1 --port 8765
```

这个示例使用确定性数据，不抓取实时市场信息，也不构成金融建议。
