from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python market_demo_agents.py <research|analysis>")
    mode = sys.argv[1]
    input_payload = read_json_env("ACC_INPUT_PATH")
    output_path = Path(required_env("ACC_OUTPUT_JSON"))
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    if mode == "research":
        output = run_research(input_payload, artifact_dir)
    elif mode == "analysis":
        output = run_analysis(input_payload, artifact_dir)
    else:
        raise SystemExit(f"Unknown market demo mode: {mode}")

    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(json.dumps({"event": "market_demo_completed", "mode": mode}, sort_keys=True))
    print(f"market demo {mode} completed", file=sys.stderr)


def read_json_env(name: str) -> dict[str, Any]:
    path = Path(required_env(name))
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"{name} must point to a JSON object")
    return payload


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def run_research(input_payload: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    sector = input_payload["sector"]
    tickers = input_payload["tickers"]
    horizon = input_payload["horizon"]
    as_of_date = input_payload["as_of_date"]
    focus = input_payload.get("focus", [])
    if not isinstance(tickers, list) or not all(isinstance(item, str) for item in tickers):
        raise SystemExit("tickers must be a list of strings")
    if not isinstance(focus, list) or not all(isinstance(item, str) for item in focus):
        raise SystemExit("focus must be a list of strings")

    catalyst_rows = [
        {
            "ticker": ticker,
            "signal": "盈利预期修正",
            "direction": "偏正面" if index % 2 == 0 else "分歧",
            "confidence": "中等",
        }
        for index, ticker in enumerate(tickers)
    ]
    write_json(
        artifact_dir / "catalysts.json",
        {
            "as_of_date": as_of_date,
            "sector": sector,
            "horizon": horizon,
            "items": catalyst_rows,
        },
    )
    write_markdown(
        artifact_dir / "market_brief.md",
        [
            "# 市场调研简报",
            "",
            f"日期：{as_of_date}",
            f"板块：{sector}",
            f"观察周期：{horizon}",
            f"覆盖标的：{', '.join(tickers)}",
            "",
            "## 核心结论",
            "",
            "这个确定性演示 capsule 会把输入的观察列表整理成主题、催化因素和风险信号。",
            "它不会抓取实时市场数据，主要用于验证工作流、artifact handoff 和可视化展示。",
            "",
            "## 关注方向",
            "",
            *[f"- {item}" for item in focus],
        ],
    )
    write_markdown(
        artifact_dir / "news_dossier.md",
        [
            "# 消息面资料包",
            "",
            "## 主题地图",
            "",
            f"- {sector} 的需求主要从资本开支、利润率和产品周期节奏观察。",
            "- 宏观敏感度主要跟踪利率、美元强弱和终端订单变化。",
            "- 公司层面的催化因素会被整理成可比较的信号。",
            "",
            "## 观察列表笔记",
            "",
            *[
                f"- {ticker}：重点观察业绩指引、库存变化和订单积压质量。"
                for ticker in tickers
            ],
        ],
    )
    write_markdown(
        artifact_dir / "risk_signals.md",
        [
            "# 风险信号",
            "",
            "- 如果长期成长估值倍数重估，可能出现估值压缩。",
            "- 如果客户消化前期提前备货，可能出现需求透支风险。",
            "- 政策和出口管制变化会影响可服务市场假设。",
            "- 持仓过度拥挤时，业绩指引不及预期会放大下行波动。",
        ],
    )
    return {
        "status": "success",
        "summary": f"已生成 {sector} 的演示调研资料：{', '.join(tickers)}",
        "artifacts": [
            "market_brief.md",
            "news_dossier.md",
            "catalysts.json",
            "risk_signals.md",
        ],
    }


def run_analysis(input_payload: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    research_artifact_dir = Path(input_payload["research_artifact_dir"])
    risk_tolerance = input_payload["risk_tolerance"]
    objective = input_payload["objective"]
    required_files = ["market_brief.md", "news_dossier.md", "catalysts.json", "risk_signals.md"]
    missing = [name for name in required_files if not (research_artifact_dir / name).exists()]
    if missing:
        raise SystemExit(f"Missing research artifacts: {', '.join(missing)}")

    catalysts = json.loads((research_artifact_dir / "catalysts.json").read_text(encoding="utf-8"))
    tickers = [item["ticker"] for item in catalysts["items"]]
    ranked = [
        {
            "rank": index + 1,
            "ticker": ticker,
            "score": 82 - index * 6,
            "stance": "逐步配置" if index == 0 else "观察",
        }
        for index, ticker in enumerate(tickers)
    ]
    write_json(
        artifact_dir / "decision_matrix.json",
        {
            "objective": objective,
            "risk_tolerance": risk_tolerance,
            "research_artifact_dir": str(research_artifact_dir),
            "ranked_candidates": ranked,
        },
    )
    top = ranked[0]
    write_markdown(
        artifact_dir / "recommendation.md",
        [
            "# 投资建议",
            "",
            f"演示场景下的最佳候选：**{top['ticker']}**",
            "",
            f"观点：{top['stance']}",
            f"评分：{top['score']}",
            "",
            "这是确定性框架演示，不构成金融建议。",
        ],
    )
    write_markdown(
        artifact_dir / "investment_memo.md",
        [
            "# 投资分析备忘录",
            "",
            f"目标：{objective}",
            f"风险偏好：{risk_tolerance}",
            f"调研来源：{research_artifact_dir}",
            "",
            "## 推理过程",
            "",
            "分析 capsule 会读取调研 Artifact Bundle，把催化因素转换成简单决策矩阵，",
            "并把候选排序和风险复核分开呈现。",
            "",
            "## 候选排序",
            "",
            *[
                f"- #{item['rank']} {item['ticker']}: {item['stance']} ({item['score']})"
                for item in ranked
            ],
        ],
    )
    write_markdown(
        artifact_dir / "risks.md",
        [
            "# 分析风险",
            "",
            "- 演示数据是确定性生成的，不是实时市场数据。",
            "- 评分模型刻意保持简单，用于检查 UI 和 workflow 链路。",
            "- 真实部署应增加来源引用、价格数据和人工复核。",
        ],
    )
    return {
        "status": "success",
        "summary": f"已生成演示投资分析；最高排序候选为 {top['ticker']}",
        "recommendation": top["ticker"],
        "artifacts": [
            "investment_memo.md",
            "recommendation.md",
            "decision_matrix.json",
            "risks.md",
        ],
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def write_markdown(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
