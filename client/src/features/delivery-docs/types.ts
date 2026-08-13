import type { OutlineData } from '../../shared/types/outline';

export type DeliveryDocumentType =
  | 'overview-design'
  | 'detail-design'
  | 'database-design'
  | 'api-docs'
  | 'deployment-topology'
  | 'user-manual'
  | 'ops-manual'
  | 'backup-recovery';

export type DeliveryDocumentStatus =
  | 'idle'
  | 'skipped'
  | 'outline-generating'
  | 'outline-error'
  | 'outline-ready'
  | 'content-generating'
  | 'content-error'
  | 'exporting'
  | 'success';

export type DeliveryContextStatus = 'idle' | 'running' | 'success' | 'error';

export interface DeliveryDocumentTypeMeta {
  id: DeliveryDocumentType;
  label: string;
  description: string;
  filename: string;
}

export const DELIVERY_DOCUMENT_TYPES: DeliveryDocumentTypeMeta[] = [
  {
    id: 'overview-design',
    label: '系统概要设计说明书',
    description: '系统定位、总体架构、模块划分、技术路线与部署形态',
    filename: '系统概要设计说明书',
  },
  {
    id: 'detail-design',
    label: '系统详细设计说明书',
    description: '模块详细设计、核心流程、数据结构与交互设计',
    filename: '系统详细设计说明书',
  },
  {
    id: 'database-design',
    label: '数据库ER图与表结构文档',
    description: 'ER 图、表清单、字段说明、索引与约束',
    filename: '数据库ER图与表结构文档',
  },
  {
    id: 'api-docs',
    label: '全系统接口API文档',
    description: '接口清单、请求响应、鉴权方式与错误码',
    filename: '全系统接口API文档',
  },
  {
    id: 'deployment-topology',
    label: '私有化部署拓扑图与网络架构图',
    description: '部署架构、网络拓扑、服务器规划、端口与域名',
    filename: '私有化部署拓扑图与网络架构图',
  },
  {
    id: 'user-manual',
    label: '分角色用户操作手册',
    description: '按系统角色编写的操作流程与功能说明',
    filename: '分角色用户操作手册',
  },
  {
    id: 'ops-manual',
    label: '运维管理手册',
    description: '日常巡检、监控告警、版本升级与故障处理',
    filename: '运维管理手册',
  },
  {
    id: 'backup-recovery',
    label: '数据备份恢复操作文档',
    description: '备份策略、恢复流程、演练与应急预案',
    filename: '数据备份恢复操作文档',
  },
];

export interface DeliveryProjectContext {
  project_name: string;
  system_name: string;
  system_summary: string;
  business_modules: string[];
  user_roles: string[];
  tech_stack: string[];
  data_domains: string[];
  deployment_scale: string;
  third_party_integrations: string[];
  compliance_notes: string;
  raw_analysis: string;
}

export interface DeliveryDocumentState {
  status: DeliveryDocumentStatus;
  outline: string;
  outline_data?: OutlineData | null;
  outline_generated_at?: string;
  content_path?: string;
  content_generated_at?: string;
  exported_path?: string;
  exported_at?: string;
  error?: string;
  progress: number;
  message: string;
  logs: string[];
  started_at?: string;
}

export interface DeliveryProjectState {
  project_id: string;
  project_name: string;
  source_file_name: string;
  source_markdown_path?: string;
  imported_at: string;
  context_status: DeliveryContextStatus;
  context: DeliveryProjectContext | null;
  context_confirmed: boolean;
  output_dir?: string;
  documents: Record<DeliveryDocumentType, DeliveryDocumentState>;
}

export interface DeliveryDocsState {
  projects: DeliveryProjectState[];
  active_project_id: string;
  active_doc_type: DeliveryDocumentType;
}

export interface DeliveryDocsImportResult {
  state: DeliveryDocsState;
  message: string;
  errors: string[];
}
