const DELIVERY_DOC_TYPES = [
  {
    id: 'overview-design',
    label: '系统概要设计说明书',
    filename: '系统概要设计说明书',
    guidance: '围绕系统定位、建设目标、总体架构、模块划分、技术路线、部署形态和关键非功能设计展开，给出清晰的架构层次和模块边界。',
  },
  {
    id: 'detail-design',
    label: '系统详细设计说明书',
    filename: '系统详细设计说明书',
    guidance: '按模块展开详细设计，覆盖核心业务流程图、关键类/对象/组件设计、数据结构、状态流转、接口调用关系和页面交互设计。',
  },
  {
    id: 'database-design',
    label: '数据库ER图与表结构文档',
    filename: '数据库ER图与表结构文档',
    guidance: '提供实体关系 ER 图（使用 mermaid erDiagram 代码块）、表清单、每个表的字段说明、主外键、索引、约束和常用查询场景说明。',
  },
  {
    id: 'api-docs',
    label: '全系统接口API文档',
    filename: '全系统接口API文档',
    guidance: '按业务域组织接口清单，每个接口包含用途、URL、请求方法、请求头/参数、响应结构、鉴权要求和错误码，尽量使用表格表达。',
  },
  {
    id: 'deployment-topology',
    label: '私有化部署拓扑图与网络架构图',
    filename: '私有化部署拓扑图与网络架构图',
    guidance: '提供私有化部署架构图、网络拓扑图（使用 mermaid flowchart/graph 代码块）、服务器与中间件规划、端口/域名清单、安全边界和部署步骤。',
  },
  {
    id: 'user-manual',
    label: '分角色用户操作手册',
    filename: '分角色用户操作手册',
    guidance: '按系统角色分别编写操作手册，覆盖登录、首页、各功能模块的进入路径、操作步骤、注意事项和常见问题。',
  },
  {
    id: 'ops-manual',
    label: '运维管理手册',
    filename: '运维管理手册',
    guidance: '覆盖日常巡检、监控与告警、日志管理、版本升级、配置管理、常见故障排查与应急预案。',
  },
  {
    id: 'backup-recovery',
    label: '数据备份恢复操作文档',
    filename: '数据备份恢复操作文档',
    guidance: '覆盖备份策略、备份方式与周期、备份执行步骤、恢复流程、演练要求、灾难场景和应急预案。',
  },
];

const MAX_SOURCE_CHARS = 90000;

function truncateSource(markdown) {
  const text = String(markdown || '').trim();
  if (text.length <= MAX_SOURCE_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_SOURCE_CHARS)}\n\n[项目清单后续内容已截断，请基于以上内容完成文档]`;
}

function buildProjectContextPrompt(sourceMarkdown, projectName) {
  const systemPrompt = [
    '你是资深软件交付顾问，负责从项目清单中提取可指导整套交付文档编写的项目上下文。',
    '只根据提供的项目清单内容归纳，不要虚构清单中不存在的具体功能；无法确定的内容留空或标注“未明确”。',
    '输出必须是合法 JSON，字段如下：',
    '{',
    '  "project_name": "项目名称，取清单标题或文件名；如果清单内容能更准确表达项目名称则使用清单名称",',
    '  "system_name": "系统/平台名称，能概括交付物名称",',
    '  "system_summary": "300-600字系统建设背景、目标和总体说明",',
    '  "business_modules": ["系统包含的业务功能模块名称，逐项列出"],',
    '  "user_roles": ["使用系统的角色，如管理员、财务、运维、监管等"],',
    '  "tech_stack": ["从清单推断或明确的技术栈、架构关键词，如微服务、容器化、国产化、AI推理等"],',
    '  "data_domains": ["系统涉及的数据域，如项目、财务、设备、用户、监管等"],',
    '  "deployment_scale": "部署规模与形态描述，如私有化、多租户、高峰期并发等",',
    '  "third_party_integrations": ["清单中提到的外部系统或第三方对接"],',
    '  "compliance_notes": "合规要求，如等保、信创、数据安全等；没有则填空字符串",',
    '  "raw_analysis": "你对项目范围、建设内容和交付重点的简要分析，200-400字"',
    '}',
  ].join('\n');
  const userPrompt = `项目文件名：${projectName}\n\n项目清单内容：\n\n${truncateSource(sourceMarkdown)}`;
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    schemaName: 'delivery_project_context',
    logTitle: '交付文档-项目上下文',
  };
}

function buildOutlinePrompt(docTypeMeta, context, sourceMarkdown) {
  const systemPrompt = [
    '你是资深软件文档架构师，负责为交付文档生成目录。',
    `当前文档类型：${docTypeMeta.label}。`,
    docTypeMeta.guidance,
    '目录应覆盖该类型文档的常规章节，并紧密结合项目实际情况调整，不要堆砌与项目无关的通用章节。',
    '输出必须是合法 JSON：{"title": "文档标题", "sections": [{"title": "章节标题", "level": 1, "children": [{"title": "小节标题", "level": 2, "children": []}]}]}。',
    'level 取值 1-3，children 可嵌套；总章节数量适中，保证文档内容充实但不冗余。',
  ].join('\n');
  const userPrompt = [
    `项目名称：${context?.project_name || ''}`,
    `系统名称：${context?.system_name || ''}`,
    `系统说明：${context?.system_summary || ''}`,
    `业务模块：${(context?.business_modules || []).join('、')}`,
    `用户角色：${(context?.user_roles || []).join('、')}`,
    `技术栈：${(context?.tech_stack || []).join('、')}`,
    `数据域：${(context?.data_domains || []).join('、')}`,
    `部署规模：${context?.deployment_scale || ''}`,
    `第三方对接：${(context?.third_party_integrations || []).join('、')}`,
    `合规要求：${context?.compliance_notes || ''}`,
    `项目分析：${context?.raw_analysis || ''}`,
    '',
    '项目清单内容：',
    truncateSource(sourceMarkdown),
  ].join('\n');
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    schemaName: 'delivery_document_outline',
    logTitle: `交付文档-目录-${docTypeMeta.label}`,
  };
}

function buildDocumentPrompt(docTypeMeta, outline, context, sourceMarkdown) {
  const systemPrompt = [
    '你是资深软件交付文档编写专家。请严格按照用户提供的目录编写完整文档正文。',
    `当前文档类型：${docTypeMeta.label}。`,
    docTypeMeta.guidance,
    '写作要求：',
    '1. 使用 Markdown 输出，中文，专业、完整、可直接交付；',
    '2. 严格按照目录结构组织标题层级，正文覆盖每个章节；',
    '3. 涉及图表/拓扑/ER 图时使用 mermaid 代码块（如 erDiagram、flowchart、graph），并配简要说明；',
    '4. 字段、接口、端口、角色等适合表格表达的内容尽量使用 Markdown 表格；',
    '5. 只依据提供的项目上下文和清单编写，清单未明确的内容用合理通用方案补全并在需要处标注“根据实际环境确认”；',
    '6. 不输出“请补充”之类的占位请求，文档本身要完整可读。',
  ].join('\n');
  const userPrompt = [
    '【已确认目录】',
    outline,
    '',
    '【项目上下文】',
    `项目名称：${context?.project_name || ''}`,
    `系统名称：${context?.system_name || ''}`,
    `系统说明：${context?.system_summary || ''}`,
    `业务模块：${(context?.business_modules || []).join('、')}`,
    `用户角色：${(context?.user_roles || []).join('、')}`,
    `技术栈：${(context?.tech_stack || []).join('、')}`,
    `数据域：${(context?.data_domains || []).join('、')}`,
    `部署规模：${context?.deployment_scale || ''}`,
    `第三方对接：${(context?.third_party_integrations || []).join('、')}`,
    `合规要求：${context?.compliance_notes || ''}`,
    `项目分析：${context?.raw_analysis || ''}`,
    '',
    '【项目清单内容】',
    truncateSource(sourceMarkdown),
  ].join('\n');
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    logTitle: `交付文档-正文-${docTypeMeta.label}`,
  };
}

module.exports = {
  DELIVERY_DOC_TYPES,
  buildProjectContextPrompt,
  buildOutlinePrompt,
  buildDocumentPrompt,
};
