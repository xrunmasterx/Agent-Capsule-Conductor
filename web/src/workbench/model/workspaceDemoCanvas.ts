import { DEFAULT_CONTAINER_SIZE } from '../constants';
import type { InternalNodeView, WorkflowCanvasEdge, WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { controlEdgeWithId } from './canvasEdgeOps';
import { port } from './workflowGraphProjection';
import { workflowInputBoundaryId, workflowOutputBoundaryId } from './workflowNodeModel';

const DEMO_ANALYST_AGENT_ID = 'stock-research-analyst.codex';
const DEMO_DATA_AGENT_ID = 'stock-data-collector.codex';
const DEMO_REPORT_AGENT_ID = 'stock-report-writer.codex';
const DEMO_REVIEW_AGENT_ID = 'stock-publication-reviewer.codex';
const DEMO_SYNTHESIS_AGENT_ID = 'stock-research-synthesis.codex';

export function workspaceDemoCanvas(): WorkspaceCanvasModel {
  const nvidiaResearchPrompt =
    '请对 NVIDIA Corporation（ticker: NVDA，NASDAQ）进行单股深度调研分析。研究目标是形成可验证、可追踪的投资研究报告，覆盖业务模式、财务质量、行业位置、估值情景、主要风险、潜在催化剂和最终一致性评审。';
  const nvidiaResearchInput = {
    user_prompt: nvidiaResearchPrompt,
    target: {
      ticker: 'NVDA',
      company_name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      asset_type: 'common_stock',
      research_scope: 'single_stock_deep_research',
    },
    research_preferences: {
      focus: ['AI accelerators', 'data center revenue', 'gross margin quality', 'valuation sensitivity', 'supply chain and regulatory risks'],
      output_language: 'zh-CN',
    },
  };
  const agentNode = (
    id: string,
    title: string,
    task: string,
    inputPorts: WorkflowPortView[],
    outputPorts: WorkflowPortView[],
    outputSchema: Record<string, unknown>,
    position: { x: number; y: number },
    callableId = DEMO_ANALYST_AGENT_ID,
    sourceInput?: Record<string, unknown>,
  ): WorkflowContainerModel => ({
    id,
    title,
    sourceKind: 'agent_session',
    callableId,
    codexExecutionMode: 'default',
    directory: `workflows/demo/${id}`,
    status: 'not_run',
    sourceInput: sourceInput || { user_prompt: task },
    outputSchema,
    inputPorts,
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position,
    size: { width: 310, height: 150 },
    warnings: [],
  });

  const inlineWorkflow = (
    id: string,
    title: string,
    directory: string,
    inputPorts: WorkflowPortView[],
    outputPorts: WorkflowPortView[],
    internalNodes: InternalNodeView[],
    internalEdges: WorkflowCanvasEdge[],
    position: { x: number; y: number },
  ): WorkflowContainerModel => ({
    id,
    title,
    workflowBodyKind: 'inline_container',
    directory,
    status: 'not_run',
    inputPorts,
    outputPorts,
    internalNodes,
    internalEdges,
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  });

  const analysisSchema = (name: string) =>
    objectOutputSchema(['status', 'summary', 'findings', 'evidence'], {
      findings: stringArrayField(`${name} 的关键发现`),
      evidence: stringArrayField('证据、假设和需要后续验证的信息'),
    });
  const synthesisSchema = (name: string) =>
    objectOutputSchema(['status', 'summary', 'decision_factors', 'open_questions'], {
      decision_factors: stringArrayField(`${name} 输出给下游 workflow 的判断因子`),
      open_questions: stringArrayField('下游仍需处理的不确定性'),
    });
  const reportSchema = objectOutputSchema(['status', 'summary', 'report_sections', 'evidence_map'], {
    report_sections: stringArrayField('最终报告章节'),
    evidence_map: stringArrayField('章节到上游产物的追踪关系'),
    action_items: stringArrayField('发布前行动项'),
  });

  const sourceDataWorkflowId = 'Source_Data_Workflow';
  const fundamentalsWorkflowId = 'Fundamentals_Workflow';
  const valuationWorkflowId = 'Valuation_Workflow';
  const riskWorkflowId = 'Risk_Catalyst_Workflow';
  const reportWorkflowId = 'Report_Workflow';

  return {
    id: 'core_v2_stock_research_canvas',
    name: 'Core v2 股市调研分析示例',
    layout: 'workspace-canvas',
    rootWorkflowId: 'Final_Review_Agent',
    exposedOutputs: [
      port('main', '投资调研报告', 'output', true),
      port('review', '发布评审结论', 'output', true),
      port('action_items', '后续行动项', 'output', true),
      port('source_register', '来源登记表', 'output', true),
      port('valuation', '估值结论', 'output', true),
    ],
    workflowOutputBindings: [
      {
        source: { node: reportWorkflowId, port: 'report' },
        target_port: 'main',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: 'Final_Review_Agent', port: 'main' },
        target_port: 'review',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: 'Final_Review_Agent', port: 'action_items' },
        target_port: 'action_items',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: sourceDataWorkflowId, port: 'source_register' },
        target_port: 'source_register',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: valuationWorkflowId, port: 'main' },
        target_port: 'valuation',
        materialization: 'copy',
        required: true,
      },
    ],
    workflows: [
      agentNode(
        'Research_Brief_Agent',
        '研究简报确认',
        '确认 NVIDIA / NVDA 的研究对象、范围、约束和后续关注点；不要提前写投资结论、估值观点或未经核验的数据。',
        [port('main', '股票或公司输入', 'input')],
        [
          port('target_profile', '标的画像', 'output', true),
          port('research_scope', '研究范围', 'output', true),
          port('constraints', '研究约束', 'output', true),
          port('watchlist_seed', '候选关注点', 'output', true),
        ],
        objectOutputSchema(
          ['status', 'summary', 'target_profile', 'research_scope', 'constraints', 'watchlist_seed'],
          {
            target_profile: {
              type: 'object',
              description: 'ticker、公司名称、业务边界和研究对象定义',
              additionalProperties: true,
            },
            research_scope: stringField('本次单股深研的范围边界'),
            constraints: stringArrayField('研究范围、数据边界和下游限制条件'),
            watchlist_seed: stringArrayField('后续风险与催化剂 workflow 需要持续关注的事项'),
          },
        ),
        { x: 80, y: 260 },
        DEMO_ANALYST_AGENT_ID,
        nvidiaResearchInput,
      ),
      inlineWorkflow(
        sourceDataWorkflowId,
        '公开数据核验工作流',
        'workflows/demo/core_v2/source_data',
        [port('target', '标的画像', 'input', true)],
        [
          port('verified_data_pack', '核验数据包', 'output', true),
          port('source_register', '来源登记表', 'output', true),
          port('data_gaps', '数据缺口', 'output', true),
        ],
        [
          internalNode(
            'company_disclosure_agent',
            '公司披露采集',
            '联网读取 NVIDIA 10-K、10-Q、earnings release、investor presentation 和 transcript，提取可引用事实。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('公司披露采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'market_data_agent',
            '市场数据采集',
            '联网读取股价、市值、forward multiples、consensus estimates 和 peer multiples；无法取得时必须列入 data_gaps。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('市场数据采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'news_policy_agent',
            '新闻政策采集',
            '联网整理近 3-6 个月 export control、Blackwell/Rubin、hyperscaler capex 和 AI demand 相关新闻。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('新闻政策采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'peer_competition_agent',
            '同业竞争采集',
            '联网整理 AMD、Broadcom/custom ASIC、Google TPU、hyperscaler internal silicon 和推理替代方案。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('同业竞争采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'data_quality_synthesis_agent',
            '数据质量汇总',
            '从 main 控制聚合输入中读取四路公开数据采集结果，压缩为可供下游消费的核验数据包、来源登记表、数据缺口和 as_of_date；不要复制上游原文。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            verifiedDataPackOutputSchema(),
            [port('main', '四路采集结果聚合', 'input', true)],
            [
              port('verified_data_pack', '核验数据包', 'output', true),
              port('source_register', '来源登记表', 'output', true),
              port('data_gaps', '数据缺口', 'output', true),
            ],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'company_disclosure_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'market_data_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'news_policy_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'peer_competition_agent', 'target'),
          controlEdge('company_disclosure_agent', 'data_quality_synthesis_agent'),
          controlEdge('market_data_agent', 'data_quality_synthesis_agent'),
          controlEdge('news_policy_agent', 'data_quality_synthesis_agent'),
          controlEdge('peer_competition_agent', 'data_quality_synthesis_agent'),
          dataEdge('data_quality_synthesis_agent', 'verified_data_pack', workflowOutputBoundaryId(sourceDataWorkflowId), 'verified_data_pack'),
          dataEdge('data_quality_synthesis_agent', 'source_register', workflowOutputBoundaryId(sourceDataWorkflowId), 'source_register'),
          dataEdge('data_quality_synthesis_agent', 'data_gaps', workflowOutputBoundaryId(sourceDataWorkflowId), 'data_gaps'),
        ],
        { x: 470, y: 240 },
      ),
      inlineWorkflow(
        fundamentalsWorkflowId,
        '基本面工作流',
        'workflows/demo/core_v2/fundamentals',
        [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
        [
          port('main', '基本面结论', 'output', true),
          port('evidence_pack', '基本面证据包', 'output', true),
        ],
        [
          internalNode(
            'business_model_agent',
            '业务模式分析',
            '分析收入来源、客户、产品线和商业模式韧性。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('业务模式分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'financial_quality_agent',
            '财务质量分析',
            '分析收入质量、利润率、现金流、资产负债表和需验证的财报数据。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('财务质量分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'industry_position_agent',
            '行业位置分析',
            '分析行业结构、竞争对手、增长驱动和公司相对位置。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('行业位置分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'fundamentals_synthesis_agent',
            '基本面汇总',
            '从 main 控制聚合输入中读取业务、财务、行业三路结果，形成下游估值和风险可消费的结论。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            synthesisSchema('基本面汇总'),
            [port('main', '三路基本面分析聚合', 'input', true)],
          ),
          internalNode(
            'fundamentals_evidence_agent',
            '证据包整理',
            '从基本面汇总中整理证据、假设和验证缺口，供最终报告追踪。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            synthesisSchema('证据包整理'),
            [port('main', '基本面汇总', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'business_model_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'business_model_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'financial_quality_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'financial_quality_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'industry_position_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'industry_position_agent', 'verified_data'),
          controlEdge('business_model_agent', 'fundamentals_synthesis_agent'),
          controlEdge('financial_quality_agent', 'fundamentals_synthesis_agent'),
          controlEdge('industry_position_agent', 'fundamentals_synthesis_agent'),
          controlEdge('fundamentals_synthesis_agent', 'fundamentals_evidence_agent'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'fundamentals_evidence_agent', 'verified_data'),
          dataEdge('fundamentals_synthesis_agent', 'main', workflowOutputBoundaryId(fundamentalsWorkflowId), 'main'),
          dataEdge('fundamentals_evidence_agent', 'main', workflowOutputBoundaryId(fundamentalsWorkflowId), 'evidence_pack'),
        ],
        { x: 860, y: 80 },
      ),
      inlineWorkflow(
        valuationWorkflowId,
        '估值与情景工作流',
        'workflows/demo/core_v2/valuation',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('constraints', '研究约束', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
        ],
        [port('main', '估值结论', 'output', true)],
        [
          internalNode(
            'operating_model_agent',
            '经营模型假设',
            '基于核验数据和基本面结论建立 revenue、gross margin、operating margin、FCF、share count、net cash 的建模假设。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            operatingModelOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'scenario_valuation_agent',
            '情景估值',
            '构造 bull/base/bear 情景，输出关键变量、成立条件、估值结果或无法估值的具体缺失原因。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            scenarioValuationOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('constraints', '研究约束', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
            ],
          ),
          internalNode(
            'comparables_agent',
            '可比公司估值',
            '基于核验市场数据整理 peers、multiples、premium/discount rationale；缺少共识或行情数据时必须显式说明。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            comparablesOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'valuation_synthesis_agent',
            '估值汇总',
            '从 main 控制聚合输入中整合经营模型、情景估值和可比公司估值，输出结论型估值判断；禁止只输出估值方法论。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            valuationSynthesisOutputSchema(),
            [port('main', '三路估值分析聚合', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'operating_model_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'operating_model_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'scenario_valuation_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'constraints', 'scenario_valuation_agent', 'constraints'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'scenario_valuation_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'comparables_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'comparables_agent', 'verified_data'),
          controlEdge('operating_model_agent', 'valuation_synthesis_agent'),
          controlEdge('scenario_valuation_agent', 'valuation_synthesis_agent'),
          controlEdge('comparables_agent', 'valuation_synthesis_agent'),
          dataEdge('valuation_synthesis_agent', 'main', workflowOutputBoundaryId(valuationWorkflowId), 'main'),
        ],
        { x: 1360, y: 40 },
      ),
      inlineWorkflow(
        riskWorkflowId,
        '风险与催化剂工作流',
        'workflows/demo/core_v2/risk_catalyst',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('watchlist', '候选关注点', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
        ],
        [
          port('main', '风险结论', 'output', true),
          port('watchlist', '催化剂跟踪清单', 'output', true),
        ],
        [
          internalNode(
            'macro_risk_agent',
            '宏观与监管风险',
            '并行识别利率、监管、汇率、政策和周期风险。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            riskComponentOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'company_risk_agent',
            '公司特有风险',
            '并行识别竞争、执行、客户集中度、管理层和资本配置风险。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            riskComponentOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'catalyst_agent',
            '催化剂扫描',
            '并行识别未来 6-12 个月可能改变预期的正负催化剂。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            catalystOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('watchlist', '候选关注点', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
            ],
          ),
          internalNode(
            'risk_synthesis_agent',
            '风险催化剂汇总',
            '从 main 控制聚合输入中汇总风险与催化剂，形成最终报告需要的风险矩阵。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            riskSynthesisOutputSchema(),
            [port('main', '三路风险与催化剂分析聚合', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'macro_risk_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'macro_risk_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'company_risk_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'company_risk_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'catalyst_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'watchlist', 'catalyst_agent', 'watchlist'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'catalyst_agent', 'verified_data'),
          controlEdge('macro_risk_agent', 'risk_synthesis_agent'),
          controlEdge('company_risk_agent', 'risk_synthesis_agent'),
          controlEdge('catalyst_agent', 'risk_synthesis_agent'),
          dataEdge('risk_synthesis_agent', 'main', workflowOutputBoundaryId(riskWorkflowId), 'main'),
          dataEdge('catalyst_agent', 'main', workflowOutputBoundaryId(riskWorkflowId), 'watchlist'),
        ],
        { x: 1360, y: 480 },
      ),
      inlineWorkflow(
        reportWorkflowId,
        '报告生成工作流',
        'workflows/demo/core_v2/report',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('valuation', '估值结论', 'input', true),
          port('risk', '风险结论', 'input', true),
          port('evidence_pack', '证据包', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
          port('source_register', '来源登记表', 'input', true),
        ],
        [
          port('report', '投资调研报告', 'output', true),
          port('appendix', '证据附录', 'output', true),
        ],
        [
          internalNode(
            'investment_thesis_agent',
            '投资论点撰写',
            '整合基本面、估值和风险，输出投资观点、置信度和关键论点；不得只输出报告写作框架。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            investmentThesisOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('valuation', '估值结论', 'input', true),
              port('risk', '风险结论', 'input', true),
            ],
          ),
          internalNode(
            'evidence_mapper_agent',
            '证据追踪整理',
            '从 main 控制输入读取投资论点，并结合证据包、估值结论和来源登记表整理证据映射；不要生成报告章节正文。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            evidenceMapOnlyOutputSchema(),
            [
              port('main', '投资论点', 'input', true),
              port('evidence_pack', '证据包', 'input', true),
              port('valuation', '估值结论', 'input', true),
              port('source_register', '来源登记表', 'input', true),
            ],
          ),
          internalNode(
            'report_compiler_agent',
            '报告合成',
            '合成完整 NVIDIA 单股深研报告，必须输出 executive summary、investment stance、估值结论、风险收益和监控计划；不得只输出方法论或待办清单。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            finalInvestmentReportOutputSchema(),
            [
              port('main', '证据追踪', 'input', true),
              port('thesis', '投资论点', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
              port('source_register', '来源登记表', 'input', true),
            ],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'fundamentals', 'investment_thesis_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'valuation', 'investment_thesis_agent', 'valuation'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'risk', 'investment_thesis_agent', 'risk'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'evidence_pack', 'evidence_mapper_agent', 'evidence_pack'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'valuation', 'evidence_mapper_agent', 'valuation'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'source_register', 'evidence_mapper_agent', 'source_register'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'verified_data', 'report_compiler_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'source_register', 'report_compiler_agent', 'source_register'),
          controlEdge('investment_thesis_agent', 'evidence_mapper_agent'),
          controlEdge('evidence_mapper_agent', 'report_compiler_agent'),
          dataEdge('investment_thesis_agent', 'main', 'report_compiler_agent', 'thesis'),
          dataEdge('report_compiler_agent', 'main', workflowOutputBoundaryId(reportWorkflowId), 'report'),
          dataEdge('evidence_mapper_agent', 'main', workflowOutputBoundaryId(reportWorkflowId), 'appendix'),
        ],
        { x: 1860, y: 260 },
      ),
      agentNode(
        'Final_Review_Agent',
        '最终发布评审',
        '接收多个 workflow 输出，检查报告、估值、风险和证据链是否一致。',
        [
          port('report', '投资调研报告', 'input', true),
          port('valuation', '估值结论', 'input', true),
          port('risk_watchlist', '风险催化剂清单', 'input', true),
          port('evidence_appendix', '证据附录', 'input', true),
        ],
        [
          port('main', '发布评审结论', 'output', true),
          port('action_items', '后续行动项', 'output', true),
        ],
        reportPublishOutputSchema(),
        { x: 2360, y: 300 },
        DEMO_REVIEW_AGENT_ID,
      ),
    ],
    edges: [
      controlEdge('Research_Brief_Agent', sourceDataWorkflowId),
      dataEdge('Research_Brief_Agent', 'target_profile', sourceDataWorkflowId, 'target'),
      controlEdge(sourceDataWorkflowId, fundamentalsWorkflowId),
      dataEdge('Research_Brief_Agent', 'target_profile', fundamentalsWorkflowId, 'target'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', fundamentalsWorkflowId, 'verified_data'),
      controlEdge(fundamentalsWorkflowId, valuationWorkflowId),
      controlEdge(fundamentalsWorkflowId, riskWorkflowId),
      dataEdge(fundamentalsWorkflowId, 'main', valuationWorkflowId, 'fundamentals'),
      dataEdge('Research_Brief_Agent', 'constraints', valuationWorkflowId, 'constraints'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', valuationWorkflowId, 'verified_data'),
      dataEdge(fundamentalsWorkflowId, 'main', riskWorkflowId, 'fundamentals'),
      dataEdge('Research_Brief_Agent', 'watchlist_seed', riskWorkflowId, 'watchlist'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', riskWorkflowId, 'verified_data'),
      controlEdge(valuationWorkflowId, reportWorkflowId),
      controlEdge(riskWorkflowId, reportWorkflowId),
      dataEdge(fundamentalsWorkflowId, 'main', reportWorkflowId, 'fundamentals'),
      dataEdge(fundamentalsWorkflowId, 'evidence_pack', reportWorkflowId, 'evidence_pack'),
      dataEdge(valuationWorkflowId, 'main', reportWorkflowId, 'valuation'),
      dataEdge(riskWorkflowId, 'main', reportWorkflowId, 'risk'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', reportWorkflowId, 'verified_data'),
      dataEdge(sourceDataWorkflowId, 'source_register', reportWorkflowId, 'source_register'),
      controlEdge(reportWorkflowId, 'Final_Review_Agent'),
      dataEdge(reportWorkflowId, 'report', 'Final_Review_Agent', 'report'),
      dataEdge(valuationWorkflowId, 'main', 'Final_Review_Agent', 'valuation'),
      dataEdge(riskWorkflowId, 'watchlist', 'Final_Review_Agent', 'risk_watchlist'),
      dataEdge(reportWorkflowId, 'appendix', 'Final_Review_Agent', 'evidence_appendix'),
    ],
  };
}

function stringField(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function stringArrayField(description: string): Record<string, unknown> {
  return {
    type: 'array',
    description,
    items: { type: 'string' },
  };
}

function objectOutputSchema(
  required: string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      status: stringField('success 或 failed'),
      summary: stringField('面向下游节点的简明结论'),
      ...properties,
    },
  };
}

function fundamentalsComponentOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'findings', 'evidence'], {
    findings: stringArrayField('关键发现'),
    evidence: stringArrayField('引用的文件、数据或需外部验证的信息'),
    assumptions: stringArrayField('需要在后续节点显式保留的不确定性'),
  });
}

function fundamentalsSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'business_quality', 'financial_quality', 'industry_position'], {
    business_quality: stringField('业务模式质量判断'),
    financial_quality: stringField('财务质量判断'),
    industry_position: stringField('行业位置判断'),
    open_questions: stringArrayField('后续估值和风险分析需要验证的问题'),
  });
}

function sourceDataComponentOutputSchema(name: string): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'facts', 'sources', 'data_gaps'], {
    facts: stringArrayField(`${name} 提取出的可引用事实`),
    sources: stringArrayField('来源标题、URL、发布日期或访问日期'),
    data_gaps: stringArrayField('未取得或仍需复核的数据'),
    as_of_date: stringField('数据采集日期'),
  });
}

function verifiedDataPackOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'verified_data_pack', 'source_register', 'data_gaps', 'as_of_date'], {
    verified_data_pack: {
      type: 'object',
      description: '下游节点可直接消费的核验事实、市场数据、新闻政策和同业竞争数据',
      additionalProperties: true,
    },
    source_register: stringArrayField('可追踪来源清单'),
    data_gaps: stringArrayField('影响报告或估值发布质量的数据缺口'),
    as_of_date: stringField('数据包截至日期'),
  });
}

function operatingModelOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'revenue_model', 'margin_model', 'cash_flow_model'], {
    revenue_model: stringField('收入驱动、分部增长和关键假设'),
    margin_model: stringField('gross margin、operating margin 和正常化假设'),
    cash_flow_model: stringField('FCF、capex、working capital、share count、net cash 等假设'),
    missing_inputs: stringArrayField('无法建模或需要补充的数据'),
  });
}

function scenarioValuationOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'base_case', 'bull_case', 'bear_case'], {
    base_case: stringField('base case 关键变量、成立条件和估值结果或缺失原因'),
    bull_case: stringField('bull case 关键变量、成立条件和估值结果或缺失原因'),
    bear_case: stringField('bear case 关键变量、成立条件和估值结果或缺失原因'),
    valuation_status: stringField('complete 或 insufficient_data'),
    missing_inputs: stringArrayField('阻止输出数值估值区间的数据缺口'),
  });
}

function comparablesOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'peers', 'multiples_view', 'premium_discount_rationale'], {
    peers: stringArrayField('可比公司或替代资产'),
    multiples_view: stringField('EV/Revenue、EV/EBIT、P/E 等可比估值判断'),
    premium_discount_rationale: stringField('相对 peers 应享有溢价或折价的理由'),
    missing_inputs: stringArrayField('缺失的市场数据、共识或 peer multiple'),
  });
}

function valuationSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(
    ['status', 'summary', 'valuation_conclusion', 'base_case', 'bull_case', 'bear_case', 'risk_reward_view', 'missing_inputs'],
    {
      valuation_conclusion: stringField('结论型估值判断；不能只描述估值方法'),
      base_case: stringField('base case 结论'),
      bull_case: stringField('bull case 结论'),
      bear_case: stringField('bear case 结论'),
      risk_reward_view: stringField('风险收益判断'),
      valuation_status: stringField('complete 或 insufficient_data'),
      missing_inputs: stringArrayField('缺失数据和对结论的影响'),
    },
  );
}

function investmentThesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'investment_stance', 'confidence', 'key_thesis'], {
    investment_stance: stringField('研究建议口径的投资观点，例如偏正面/中性/偏谨慎及原因'),
    confidence: stringField('高/中/低置信度及原因'),
    key_thesis: stringArrayField('支撑投资观点的核心论点'),
    thesis_risks: stringArrayField('可能推翻投资观点的关键风险'),
  });
}

function evidenceMapOnlyOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'evidence_map', 'source_coverage', 'evidence_gaps'], {
    evidence_map: stringArrayField('报告结论到上游证据和来源的映射'),
    source_coverage: stringArrayField('披露、市场、新闻政策和同业数据的覆盖情况'),
    evidence_gaps: stringArrayField('发布前必须补齐或在报告中披露的证据缺口'),
    action_items: stringArrayField('补充证据的行动项'),
  });
}

function finalInvestmentReportOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'report'], {
    report: {
      type: 'object',
      additionalProperties: false,
      required: [
        'executive_summary',
        'investment_stance',
        'business_quality',
        'financial_quality',
        'industry_position',
        'valuation_conclusion',
        'risk_reward',
        'key_risks',
        'catalysts',
        'monitoring_plan',
        'source_notes',
        'limitations',
      ],
      properties: {
        executive_summary: stringField('一页式核心摘要'),
        investment_stance: stringField('研究建议口径投资观点，不输出绝对化买卖指令'),
        business_quality: stringField('业务质量结论'),
        financial_quality: stringField('财务质量结论'),
        industry_position: stringField('行业位置结论'),
        valuation_conclusion: stringField('估值结论'),
        risk_reward: stringField('风险收益判断'),
        key_risks: stringArrayField('关键风险'),
        catalysts: stringArrayField('正负催化剂'),
        monitoring_plan: stringArrayField('后续跟踪指标'),
        source_notes: stringArrayField('关键来源说明'),
        limitations: stringArrayField('限制、免责声明和不可发布条件'),
      },
    },
    action_items: stringArrayField('后续行动项'),
  });
}

function riskComponentOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'risks'], {
    risks: stringArrayField('风险项'),
    severity_notes: stringArrayField('风险严重程度或触发条件'),
  });
}

function catalystOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'positive_catalysts', 'negative_catalysts'], {
    positive_catalysts: stringArrayField('正向催化剂'),
    negative_catalysts: stringArrayField('负向催化剂'),
    watchlist: stringArrayField('需要持续跟踪的事件'),
  });
}

function riskSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'risk_matrix', 'catalyst_watchlist'], {
    risk_matrix: stringArrayField('整合后的风险矩阵'),
    catalyst_watchlist: stringArrayField('催化剂跟踪清单'),
    mitigation_notes: stringArrayField('风险缓释或验证方式'),
  });
}

function reportPublishOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'readiness', 'required_followups'], {
    readiness: stringField('报告是否可发布，以及原因'),
    required_followups: stringArrayField('发布前仍需补充的检查项'),
    action_items: stringArrayField('发布前后需要执行的行动项'),
  });
}


function internalNode(
  id: string,
  name: string,
  task: string,
  kind: 'Agent' | 'Tool',
  callableId?: string,
  outputSchema?: Record<string, unknown>,
  inputPorts?: WorkflowPortView[],
  outputPorts?: WorkflowPortView[],
): InternalNodeView {
  return {
    id,
    name,
    task,
    kind,
    status: 'not_run',
    callableId: callableId || (kind === 'Tool' ? 'merge' : 'fake-agent.generic'),
    input: { user_prompt: task || name },
    outputSchema,
    inputPorts: inputPorts || [port('main', '输入材料', 'input')],
    outputPorts: outputPorts || [port('main', '输出产物', 'output', true)],
  };
}

function dataEdge(
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return dataEdgeWithId(
    `data_${sourceWorkflowId}_${sourcePortId}_${targetWorkflowId}_${targetPortId}`,
    sourceWorkflowId,
    sourcePortId,
    targetWorkflowId,
    targetPortId,
  );
}

function controlEdge(sourceWorkflowId: string, targetWorkflowId: string): WorkflowCanvasEdge {
  return controlEdgeWithId(`control_${sourceWorkflowId}_${targetWorkflowId}`, sourceWorkflowId, targetWorkflowId);
}

function dataEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'data',
    source: { workflowId: sourceWorkflowId, portId: sourcePortId },
    target: { workflowId: targetWorkflowId, portId: targetPortId },
    materialization: 'copy',
  };
}
