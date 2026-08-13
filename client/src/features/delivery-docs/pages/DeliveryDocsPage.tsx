import * as Dialog from '@radix-ui/react-dialog';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { trackPageView } from '../../../shared/analytics/analytics';
import {
  FloatingToolbar,
  MarkdownRenderer,
  ToolbarArrowLeftIcon,
  ToolbarArrowRightIcon,
  ToolbarDocumentIcon,
  useToast,
} from '../../../shared/ui';
import type { FloatingToolbarGroup } from '../../../shared/ui';
import { TemplatePreview } from '../../export-format/pages/ExportFormatPage';
import type { ExportFormatConfig, ExportTemplateRecord } from '../../../shared/types/exportFormat';
import { DEFAULT_EXPORT_FORMAT } from '../../../shared/types/exportFormat';
import { buildExportFormatCssVars } from '../../../shared/utils/exportFormatCss';
import OutlineEditPage from '../../technical-plan/pages/OutlineEditPage';
import type { BackgroundTaskState, SaveOutlineRequest } from '../../technical-plan/types';
import { DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types';
import type { SectionId } from '../../../shared/types/navigation';
import { DELIVERY_DOCUMENT_TYPES } from '../types';
import type {
  DeliveryDocumentState,
  DeliveryDocumentType,
  DeliveryDocsState,
  DeliveryProjectContext,
  DeliveryProjectState,
} from '../types';

interface DeliveryDocsPageProps {
  onSectionChange?: (section: SectionId) => void;
}

const statusLabels: Record<string, string> = {
  idle: '待生成',
  skipped: '已跳过',
  'outline-generating': '目录生成中',
  'outline-error': '目录生成失败',
  'outline-ready': '目录待确认',
  'content-generating': '正文生成中',
  'content-error': '正文生成失败',
  exporting: '导出中',
  success: '已完成',
};

function emptyContext(projectName: string): DeliveryProjectContext {
  return {
    project_name: projectName,
    system_name: '',
    system_summary: '',
    business_modules: [],
    user_roles: [],
    tech_stack: [],
    data_domains: [],
    deployment_scale: '',
    third_party_integrations: [],
    compliance_notes: '',
    raw_analysis: '',
  };
}

function splitLines(value: string): string[] {
  return String(value || '')
    .split(/\n|[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: string[] | undefined): string {
  return Array.isArray(items) ? items.join('\n') : '';
}

function getDocumentCounts(project: DeliveryProjectState) {
  const documents = Object.values(project.documents || {});
  return {
    total: documents.length,
    success: documents.filter((item) => item.status === 'success').length,
    skipped: documents.filter((item) => item.status === 'skipped').length,
  };
}

function toOutlineTask(document: DeliveryDocumentState | undefined): BackgroundTaskState | undefined {
  if (!document || !['outline-generating', 'outline-error', 'outline-ready'].includes(document.status)) {
    return undefined;
  }
  const status = document.status === 'outline-generating'
    ? 'running'
    : document.status === 'outline-error'
      ? 'error'
      : 'success';
  return {
    task_id: 'delivery-outline',
    type: 'outline-generation',
    status,
    progress: document.progress || 0,
    logs: Array.isArray(document.logs) ? document.logs : [],
    started_at: document.started_at || '',
    updated_at: document.outline_generated_at || document.started_at || '',
    error: document.error,
  };
}

function DeliveryDocsPage({ onSectionChange }: DeliveryDocsPageProps) {
  const [deliveryState, setDeliveryState] = useState<DeliveryDocsState | null>(null);
  const [contextDraft, setContextDraft] = useState<DeliveryProjectContext | null>(null);
  const [contentText, setContentText] = useState('');
  const [contentLoadedKey, setContentLoadedKey] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [exportTemplateDialogOpen, setExportTemplateDialogOpen] = useState(false);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplateRecord[]>([]);
  const [exportTemplatesLoading, setExportTemplatesLoading] = useState(false);
  const [exportTemplateSearch, setExportTemplateSearch] = useState('');
  const [selectedExportTemplateId, setSelectedExportTemplateId] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormatConfig>(DEFAULT_EXPORT_FORMAT);
  const [projectListWidth, setProjectListWidth] = useState(300);
  const [outlineLeftWidth, setOutlineLeftWidth] = useState(300);
  const [outlineRightWidth, setOutlineRightWidth] = useState(340);
  const contextDirtyRef = useRef(false);
  const autoOpenExportTemplateRef = useRef(false);
  const splitterRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const outlineResizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);
  const { showToast } = useToast();

  const activeProject = deliveryState?.projects.find((item) => item.project_id === deliveryState.active_project_id) || null;
  const activeDocType = deliveryState?.active_doc_type || 'overview-design';
  const activeDocument = activeProject?.documents?.[activeDocType] || null;
  const activeDocMeta = DELIVERY_DOCUMENT_TYPES.find((item) => item.id === activeDocType) || DELIVERY_DOCUMENT_TYPES[0];
  const docTypeIndex = DELIVERY_DOCUMENT_TYPES.findIndex((item) => item.id === activeDocType);
  const nextDocType = docTypeIndex >= 0 && docTypeIndex < DELIVERY_DOCUMENT_TYPES.length - 1
    ? DELIVERY_DOCUMENT_TYPES[docTypeIndex + 1].id
    : null;
  const prevDocType = docTypeIndex > 0 ? DELIVERY_DOCUMENT_TYPES[docTypeIndex - 1].id : null;
  const filteredExportTemplates = useMemo(() => {
    const keyword = exportTemplateSearch.trim().toLowerCase();
    if (!keyword) return exportTemplates;
    return exportTemplates.filter((template) => template.template_name.toLowerCase().includes(keyword));
  }, [exportTemplateSearch, exportTemplates]);
  const selectedExportTemplate = filteredExportTemplates.find((template) => template.template_id === selectedExportTemplateId)
    || filteredExportTemplates[0]
    || null;
  const exportTemplatePreviewStyle = useMemo(
    () => buildExportFormatCssVars(selectedExportTemplate?.config || exportFormat),
    [exportFormat, selectedExportTemplate],
  );

  const loadContent = useCallback(async (projectId: string, docType: DeliveryDocumentType) => {
    const key = `${projectId}:${docType}`;
    if (contentLoadedKey === key) {
      return;
    }
    setContentLoadedKey(key);
    const text = await window.yibiao?.deliveryDocs.readContent(projectId, docType);
    setContentText(text || '');
  }, [contentLoadedKey]);

  const loadExportTemplates = useCallback(async () => {
    setExportTemplatesLoading(true);
    try {
      const templates = await window.yibiao?.templates.list();
      const nextTemplates = templates || [];
      setExportTemplates(nextTemplates);
      setSelectedExportTemplateId((prev) => (
        nextTemplates.some((template) => template.template_id === prev)
          ? prev
          : nextTemplates[0]?.template_id || ''
      ));
    } catch (error) {
      setExportTemplates([]);
      setSelectedExportTemplateId('');
      showToast(error instanceof Error ? error.message : '读取导出模板失败', 'error');
    } finally {
      setExportTemplatesLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    trackPageView('delivery-docs');
    void window.yibiao?.deliveryDocs.loadState().then(setDeliveryState);
    const unsubscribe = window.yibiao?.deliveryDocs.onEvent((event) => {
      setDeliveryState(event.state);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setContextDraft(null);
      return;
    }
    contextDirtyRef.current = false;
    setContextDraft((prev) => prev?.project_name === activeProject.project_name
      ? prev
      : activeProject.context || emptyContext(activeProject.project_name));
  }, [activeProject?.project_id, activeProject?.project_name]);

  useEffect(() => {
    if (!contextDirtyRef.current && activeProject?.context) {
      setContextDraft(activeProject.context);
    }
  }, [activeProject?.context, activeProject?.project_id]);

  useEffect(() => {
    setContentText('');
    setContentLoadedKey('');
  }, [activeProject?.project_id, activeDocType]);

  useEffect(() => {
    if (activeProject && activeDocument?.status === 'success' && activeDocument.content_path) {
      void loadContent(activeProject.project_id, activeDocType);
    }
  }, [activeProject?.project_id, activeDocType, activeDocument?.status, activeDocument?.content_path, loadContent]);

  useEffect(() => {
    if (autoOpenExportTemplateRef.current && activeProject && activeDocument?.status === 'success' && !activeDocument.exported_path) {
      autoOpenExportTemplateRef.current = false;
      void openExportTemplateDialog();
    }
  }, [activeDocument?.status, activeDocument?.exported_path, activeProject?.project_id]);

  const runAction = async (key: string, action: () => Promise<DeliveryDocsState | void>) => {
    if (busyKey) {
      return;
    }
    setBusyKey(key);
    try {
      const next = await action();
      if (next && typeof next === 'object' && 'projects' in next) {
        setDeliveryState(next as DeliveryDocsState);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    } finally {
      setBusyKey('');
    }
  };

  const handleImport = () => {
    void runAction('import', async () => {
      const result = await window.yibiao?.deliveryDocs.importProjects();
      if (!result) return;
      setDeliveryState(result.state);
      showToast(result.message || '项目导入完成', result.errors.length ? 'info' : 'success');
    });
  };

  const handleGenerateContext = () => {
    if (!activeProject) return;
    contextDirtyRef.current = false;
    void runAction('generate-context', () => window.yibiao?.deliveryDocs.generateContext(activeProject.project_id) || Promise.resolve());
  };

  const handleSaveContextAndConfirm = () => {
    if (!activeProject || !contextDraft) return;
    void runAction('confirm-context', async () => {
      await window.yibiao?.deliveryDocs.saveContext(activeProject.project_id, contextDraft);
      return window.yibiao?.deliveryDocs.confirmContext(activeProject.project_id);
    });
  };

  const handleGenerateOutline = () => {
    if (!activeProject) return;
    return window.yibiao?.deliveryDocs.generateOutline(activeProject.project_id, activeDocType) || Promise.resolve();
  };

  const handleOutlineConfigChange = async () => {};

  const handleOutlineSaved = async (request: SaveOutlineRequest) => {
    if (!activeProject) return;
    await window.yibiao?.deliveryDocs.saveOutline(activeProject.project_id, activeDocType, {
      outline_data: request.outlineData,
    });
  };

  const handleGenerateDocument = () => {
    if (!activeProject) return;
    autoOpenExportTemplateRef.current = true;
    void runAction('generate-document', () => window.yibiao?.deliveryDocs.generateDocument(activeProject.project_id, activeDocType) || Promise.resolve());
  };

  const handleSkip = () => {
    if (!activeProject) return;
    void runAction('skip', () => window.yibiao?.deliveryDocs.skipDocument(activeProject.project_id, activeDocType) || Promise.resolve());
  };

  const handleNextStep = () => {
    if (!activeProject || !nextDocType) return;
    void window.yibiao?.deliveryDocs.setActive(activeProject.project_id, nextDocType).then(setDeliveryState);
  };

  const handlePrevStep = () => {
    if (!activeProject || !prevDocType) return;
    void window.yibiao?.deliveryDocs.setActive(activeProject.project_id, prevDocType).then(setDeliveryState);
  };

  const handleOpenExportTemplateDialog = () => {
    if (!activeProject || !activeDocument || activeDocument.status !== 'success') return;
    void openExportTemplateDialog();
  };

  const openExportTemplateDialog = async () => {
    setExportTemplateDialogOpen(true);
    setExportTemplateSearch('');
    await loadExportTemplates();
  };

  const handleConfirmExportTemplate = () => {
    if (!activeProject || !selectedExportTemplate) {
      showToast('请先选择导出模板', 'info');
      return;
    }
    setExportTemplateDialogOpen(false);
    void runAction('export', () => window.yibiao?.deliveryDocs.exportDocument(activeProject.project_id, activeDocType, {
      export_format: selectedExportTemplate.config,
    }) || Promise.resolve());
  };

  const handleCreateExportTemplate = () => {
    setExportTemplateDialogOpen(false);
    if (onSectionChange) {
      onSectionChange('new-template');
    } else {
      showToast('请从左侧菜单进入模板设置新建模板', 'info');
    }
  };

  const handleSelectOutputDir = () => {
    if (!activeProject) return;
    void runAction('select-dir', () => window.yibiao?.deliveryDocs.selectOutputDir(activeProject.project_id) || Promise.resolve());
  };

  const handleOpenOutputFolder = () => {
    if (!activeProject) return;
    void runAction('open-folder', async () => {
      const result = await window.yibiao?.deliveryDocs.openOutputFolder(activeProject.project_id);
      if (!result?.success) {
        showToast(result?.message || '打开文件夹失败', 'error');
      }
    });
  };

  const handleClear = () => {
    if (!deliveryState?.projects.length) return;
    void runAction('clear', async () => {
      const next = await window.yibiao?.deliveryDocs.clear();
      showToast('已清空全部交付文档进度', 'info');
      return next;
    });
  };

  const handleSelectProject = (projectId: string) => {
    if (!activeProject || activeProject.project_id !== projectId) {
      void window.yibiao?.deliveryDocs.setActive(projectId, activeDocType).then(setDeliveryState);
    }
  };

  const handleSelectDocType = (docType: DeliveryDocumentType) => {
    if (!activeProject) return;
    void window.yibiao?.deliveryDocs.setActive(activeProject.project_id, docType).then(setDeliveryState);
  };

  const handleSplitterPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    splitterRef.current = { startX: event.clientX, startWidth: projectListWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSplitterPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitterRef.current) return;
    const delta = event.clientX - splitterRef.current.startX;
    setProjectListWidth(Math.min(480, Math.max(220, splitterRef.current.startWidth + delta)));
  };

  const handleSplitterPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    splitterRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleOutlineResizePointerDown = (side: 'left' | 'right') => (event: ReactPointerEvent<HTMLDivElement>) => {
    outlineResizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? outlineLeftWidth : outlineRightWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleOutlineResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = outlineResizeRef.current;
    if (!resize) return;
    const delta = event.clientX - resize.startX;
    if (resize.side === 'left') {
      setOutlineLeftWidth(Math.min(480, Math.max(220, resize.startWidth + delta)));
    } else {
      setOutlineRightWidth(Math.min(560, Math.max(260, resize.startWidth - delta)));
    }
  };

  const handleOutlineResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    outlineResizeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const renderContextForm = () => {
    if (!contextDraft) return null;
    const update = (partial: Partial<DeliveryProjectContext>) => {
      contextDirtyRef.current = true;
      setContextDraft((prev) => (prev ? { ...prev, ...partial } : prev));
    };
    return (
      <div className="delivery-context-form">
        <div className="delivery-context-grid">
          <label className="delivery-context-field">
            <span>项目名称</span>
            <input value={contextDraft.project_name} onChange={(event) => update({ project_name: event.target.value })} placeholder="请输入项目名称" />
          </label>
          <label className="delivery-context-field">
            <span>系统名称</span>
            <input value={contextDraft.system_name} onChange={(event) => update({ system_name: event.target.value })} placeholder="请输入交付系统名称" />
          </label>
        </div>
        <label className="delivery-context-field">
          <span>系统建设说明</span>
          <textarea rows={4} value={contextDraft.system_summary} onChange={(event) => update({ system_summary: event.target.value })} placeholder="系统建设背景、目标和总体说明" />
        </label>
        <div className="delivery-context-grid">
          <label className="delivery-context-field">
            <span>业务模块（每行一个）</span>
            <textarea rows={4} value={joinLines(contextDraft.business_modules)} onChange={(event) => update({ business_modules: splitLines(event.target.value) })} placeholder="如：租户管理、报餐结算、监管上报" />
          </label>
          <label className="delivery-context-field">
            <span>用户角色（每行一个）</span>
            <textarea rows={4} value={joinLines(contextDraft.user_roles)} onChange={(event) => update({ user_roles: splitLines(event.target.value) })} placeholder="如：系统管理员、财务、运维、监管" />
          </label>
          <label className="delivery-context-field">
            <span>技术栈（每行一个）</span>
            <textarea rows={4} value={joinLines(contextDraft.tech_stack)} onChange={(event) => update({ tech_stack: splitLines(event.target.value) })} placeholder="如：微服务、K8s、达梦数据库" />
          </label>
          <label className="delivery-context-field">
            <span>数据域（每行一个）</span>
            <textarea rows={4} value={joinLines(contextDraft.data_domains)} onChange={(event) => update({ data_domains: splitLines(event.target.value) })} placeholder="如：项目、财务、设备、用户" />
          </label>
          <label className="delivery-context-field">
            <span>部署规模</span>
            <textarea rows={3} value={contextDraft.deployment_scale} onChange={(event) => update({ deployment_scale: event.target.value })} placeholder="如：私有化部署、多租户、高峰期并发" />
          </label>
          <label className="delivery-context-field">
            <span>第三方对接（每行一个）</span>
            <textarea rows={3} value={joinLines(contextDraft.third_party_integrations)} onChange={(event) => update({ third_party_integrations: splitLines(event.target.value) })} placeholder="如：教育局、财务系统、IoT平台" />
          </label>
          <label className="delivery-context-field">
            <span>合规要求</span>
            <textarea rows={3} value={contextDraft.compliance_notes} onChange={(event) => update({ compliance_notes: event.target.value })} placeholder="如：等保三级、信创、数据安全法" />
          </label>
          <label className="delivery-context-field">
            <span>项目分析</span>
            <textarea rows={3} value={contextDraft.raw_analysis} onChange={(event) => update({ raw_analysis: event.target.value })} placeholder="项目范围与交付重点分析" />
          </label>
        </div>
        <div className="delivery-actions">
          <button type="button" className="secondary-action" onClick={handleGenerateContext} disabled={busyKey === 'generate-context'}>
            {busyKey === 'generate-context' ? '生成中...' : 'AI 生成项目上下文'}
          </button>
          <button type="button" className="primary-action" onClick={handleSaveContextAndConfirm} disabled={busyKey === 'confirm-context'}>
            {busyKey === 'confirm-context' ? '保存中...' : '保存并进入文档生成'}
          </button>
        </div>
      </div>
    );
  };

  const renderProgress = (document: DeliveryDocumentState) => (
    <div className="delivery-progress">
      <div className="content-generation-progress-track" aria-label={`进度 ${document.progress}%`}>
        <span style={{ width: `${Math.min(100, Math.max(0, document.progress || 0))}%` }} />
      </div>
      <p>{document.message || '正在处理，请稍候。'}</p>
      {Array.isArray(document.logs) && document.logs.length > 0 && (
        <div className="delivery-progress-logs">
          {document.logs.map((log, index) => (
            <p className={index === document.logs.length - 1 ? 'is-latest' : ''} key={`${log}-${index}`}>{log}</p>
          ))}
        </div>
      )}
    </div>
  );

  const renderOutlineStage = () => {
    if (!activeDocument) return null;
    return (
      <div
        className="delivery-outline-reuse"
        style={{
          '--delivery-outline-left': `${outlineLeftWidth}px`,
          '--delivery-outline-right': `${outlineRightWidth}px`,
        } as CSSProperties}
      >
        <div
          className="delivery-pane-resizer is-left"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整目录生成进度栏宽度"
          onPointerDown={handleOutlineResizePointerDown('left')}
          onPointerMove={handleOutlineResizePointerMove}
          onPointerUp={handleOutlineResizePointerUp}
        />
        <div
          className="delivery-pane-resizer is-right"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整目录详情栏宽度"
          onPointerDown={handleOutlineResizePointerDown('right')}
          onPointerMove={handleOutlineResizePointerMove}
          onPointerUp={handleOutlineResizePointerUp}
        />
        <OutlineEditPage
          workflowKind="technical-plan"
          projectOverview={activeProject?.context?.system_summary || activeProject?.project_name || '项目交付文档'}
          techRequirements={activeProject?.context?.raw_analysis || activeProject?.context?.system_summary || '依据项目清单生成交付文档'}
          outlineExpansionMode="ai-complement"
          outlineWordControlOptions={DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS}
          outlineWordControlSnapshot={undefined}
          referenceKnowledgeDocumentIds={[]}
          outlineData={activeDocument.outline_data || null}
          task={toOutlineTask(activeDocument)}
          contentTaskStatus={undefined}
          onOutlineConfigChange={handleOutlineConfigChange}
          onOutlineSaved={handleOutlineSaved}
          onGenerateOutline={handleGenerateOutline}
        />
        {activeDocument.status === 'outline-ready' && (
          <div className="delivery-actions delivery-outline-actions">
            <button type="button" className="primary-action" onClick={handleGenerateDocument} disabled={busyKey === 'generate-document'}>
              {busyKey === 'generate-document' ? '生成中...' : '生成正文'}
            </button>
            <button type="button" className="secondary-action" onClick={handleSkip} disabled={Boolean(busyKey)}>跳到下一类</button>
          </div>
        )}
      </div>
    );
  };

  const renderDocumentWorkflow = () => {
    if (!activeDocument) return null;
    const isBusy = Boolean(busyKey);
    return (
      <div className="delivery-doc-panel">
        <div className="delivery-doc-head">
          <div>
            <span className="section-kicker">{docTypeIndex + 1} / {DELIVERY_DOCUMENT_TYPES.length}</span>
            <strong>{activeDocMeta.label}</strong>
            <p>{activeDocMeta.description}</p>
          </div>
          <em className={`delivery-status is-${activeDocument.status}`}>{statusLabels[activeDocument.status] || activeDocument.status}</em>
        </div>

        {['idle', 'skipped', 'outline-generating', 'outline-error', 'outline-ready'].includes(activeDocument.status) && renderOutlineStage()}

        {(activeDocument.status === 'content-generating' || activeDocument.status === 'exporting') && renderProgress(activeDocument)}

        {activeDocument.status === 'content-error' && (
          <div className="delivery-error">
            <strong>生成失败</strong>
            <span>{activeDocument.error || activeDocument.message}</span>
            <div className="delivery-actions">
              <button type="button" className="primary-action" onClick={handleGenerateDocument} disabled={isBusy}>重试生成正文</button>
              <button type="button" className="secondary-action" onClick={handleSkip} disabled={isBusy}>跳到下一类</button>
            </div>
          </div>
        )}

        {activeDocument.status === 'success' && (
          <div className="delivery-content">
            <div className="delivery-section-title">
              <strong>文档预览</strong>
              <span>{activeDocument.exported_path ? '正文已生成并导出 Word。' : '正文已生成，选择模板后导出 Word。'}</span>
            </div>
            <div className="delivery-content-preview">
              {contentText ? (
                <MarkdownRenderer allowRawHtml={false}>{contentText}</MarkdownRenderer>
              ) : (
                <div className="delivery-content-loading">正在读取文档内容...</div>
              )}
            </div>
            <div className="delivery-actions">
              <button type="button" className="primary-action" onClick={handleOpenExportTemplateDialog} disabled={busyKey === 'export'}>
                {busyKey === 'export' ? '导出中...' : activeDocument.exported_path ? '选择模板重新导出' : '选择模板并导出 Word'}
              </button>
              <button type="button" className="secondary-action" onClick={handleOpenOutputFolder} disabled={!activeProject?.output_dir}>
                {activeProject?.output_dir ? '打开输出文件夹' : '请先选择输出文件夹'}
              </button>
              {!activeProject?.output_dir && (
                <button type="button" className="secondary-action" onClick={handleSelectOutputDir}>选择输出文件夹</button>
              )}
              {nextDocType && (
                <button type="button" className="secondary-action" onClick={handleNextStep} disabled={isBusy}>
                  下一类（{DELIVERY_DOCUMENT_TYPES.find((item) => item.id === nextDocType)?.label}）
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const toolbarGroups: FloatingToolbarGroup[] = [
    {
      id: 'delivery-docs-navigation',
      actions: [
        {
          id: 'previous-step',
          label: '上一步',
          icon: <ToolbarArrowLeftIcon />,
          disabled: Boolean(busyKey) || !prevDocType,
          tooltip: prevDocType ? `切换到${DELIVERY_DOCUMENT_TYPES.find((item) => item.id === prevDocType)?.label || '上一类'}` : '已经是第一类文档',
          onClick: handlePrevStep,
        },
        {
          id: 'next-step',
          label: '下一步',
          icon: <ToolbarArrowRightIcon />,
          variant: 'primary',
          disabled: Boolean(busyKey) || !nextDocType,
          tooltip: nextDocType ? `切换到${DELIVERY_DOCUMENT_TYPES.find((item) => item.id === nextDocType)?.label || '下一类'}` : '已经是最后一类文档',
          onClick: handleNextStep,
        },
      ],
    },
    {
      id: 'delivery-docs-actions',
      actions: [
        {
          id: 'import',
          label: '批量导入项目',
          icon: <ToolbarDocumentIcon />,
          onClick: handleImport,
          disabled: Boolean(busyKey),
        },
        {
          id: 'clear',
          label: '清空全部',
          variant: 'danger',
          disabled: !deliveryState?.projects.length || Boolean(busyKey),
          onClick: handleClear,
        },
      ],
    },
  ];

  if (!deliveryState) {
    return (
      <div className="page-stack delivery-docs-page">
        <div className="delivery-loading">正在读取交付文档工作区...</div>
      </div>
    );
  }

  return (
    <div className="page-stack delivery-docs-page">
      {deliveryState.projects.length === 0 ? (
        <div className="delivery-empty-workspace">
          <span className="section-kicker">交付文档</span>
          <strong>批量生成项目交付文档</strong>
          <p>导入项目清单（Excel、Word、PDF），每个文件作为一个项目，逐类生成 8 份交付文档。</p>
          <button type="button" className="primary-action" onClick={handleImport} disabled={Boolean(busyKey)}>批量导入项目清单</button>
        </div>
      ) : (
        <div className="delivery-workspace" style={{ gridTemplateColumns: `${projectListWidth}px 8px minmax(0, 1fr)` }}>
          <aside className="delivery-project-list">
            <div className="delivery-project-list-head">
              <strong>项目列表</strong>
              <span>{deliveryState.projects.length} 个</span>
            </div>
            <div className="delivery-project-items">
              {deliveryState.projects.map((project) => {
                const counts = getDocumentCounts(project);
                const active = project.project_id === activeProject?.project_id;
                return (
                  <button
                    type="button"
                    className={`delivery-project-item${active ? ' is-active' : ''}`}
                    key={project.project_id}
                    onClick={() => handleSelectProject(project.project_id)}
                  >
                    <strong>{project.project_name}</strong>
                    <span>已完成 {counts.success}/{counts.total}，跳过 {counts.skipped}</span>
                  </button>
                );
              })}
            </div>
          </aside>
          <div
            className="delivery-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整项目列表宽度"
            onPointerDown={handleSplitterPointerDown}
            onPointerMove={handleSplitterPointerMove}
            onPointerUp={handleSplitterPointerUp}
          />
          <main className="delivery-workflow">
            {activeProject && !activeProject.context_confirmed && (
              <div className="delivery-context-panel">
                <div className="delivery-workflow-head">
                  <span className="section-kicker">项目上下文</span>
                  <strong>{activeProject.project_name}</strong>
                  <p>先让 AI 从清单提取系统范围，或直接编辑下列信息，确认后开始逐类生成交付文档。</p>
                </div>
                {activeProject.context_status === 'running' ? (
                  <div className="delivery-progress">
                    <div className="content-generation-progress-track"><span style={{ width: '45%' }} /></div>
                    <p>正在分析项目清单并提取项目上下文...</p>
                  </div>
                ) : (
                  renderContextForm()
                )}
              </div>
            )}
            {activeProject && activeProject.context_confirmed && (
              <div className="delivery-doc-workflow">
                <div className="delivery-doc-chips">
                  {DELIVERY_DOCUMENT_TYPES.map((meta) => {
                    const document = activeProject.documents[meta.id];
                    return (
                      <button
                        type="button"
                        className={`delivery-doc-chip${meta.id === activeDocType ? ' is-active' : ''} is-${document?.status || 'idle'}`}
                        key={meta.id}
                        onClick={() => handleSelectDocType(meta.id)}
                      >
                        <span>{meta.label}</span>
                        <em>{statusLabels[document?.status || 'idle']}</em>
                      </button>
                    );
                  })}
                </div>
                {renderDocumentWorkflow()}
              </div>
            )}
          </main>
        </div>
      )}

      <Dialog.Root open={exportTemplateDialogOpen} onOpenChange={(open) => !open && setExportTemplateDialogOpen(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-template-select-dialog">
            <div className="export-template-select-head">
              <div>
                <span className="section-kicker">Word 导出</span>
                <Dialog.Title>选择导出模板</Dialog.Title>
                <Dialog.Description>选择一个已保存模板后继续导出。模板样式应用范围保持现有导出逻辑。</Dialog.Description>
              </div>
              <Dialog.Close className="detail-help-close" type="button" aria-label="关闭模板选择" disabled={busyKey === 'export'}>×</Dialog.Close>
            </div>

            <div className="export-template-select-body">
              <section className="export-template-select-list-panel" aria-label="模板列表">
                <input
                  className="export-template-select-search"
                  type="text"
                  value={exportTemplateSearch}
                  onChange={(event) => setExportTemplateSearch(event.target.value)}
                  placeholder="搜索模板名称"
                />
                <div className="export-template-select-list">
                  {exportTemplatesLoading ? (
                    <div className="export-template-select-empty"><strong>正在读取模板</strong><span>请稍候...</span></div>
                  ) : null}
                  {!exportTemplatesLoading && filteredExportTemplates.length === 0 ? (
                    <div className="export-template-select-empty">
                      <strong>{exportTemplates.length ? '没有匹配模板' : '暂无可用模板'}</strong>
                      <span>{exportTemplates.length ? '请换个关键词搜索，或新建一个模板。' : '请先新建并保存模板，保存后再返回导出。'}</span>
                      <button type="button" className="secondary-action" onClick={handleCreateExportTemplate} disabled={busyKey === 'export'}>新建模板</button>
                    </div>
                  ) : null}
                  {!exportTemplatesLoading && filteredExportTemplates.map((template) => {
                    const selected = selectedExportTemplate?.template_id === template.template_id;
                    return (
                      <button
                        type="button"
                        className={`export-template-select-row${selected ? ' is-active' : ''}`}
                        key={template.template_id}
                        onClick={() => setSelectedExportTemplateId(template.template_id)}
                      >
                        <strong>{template.template_name}</strong>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="export-template-select-preview" aria-label="模板预览">
                {selectedExportTemplate ? (
                  <>
                    <div className="export-template-select-preview-head">
                      <span className="section-kicker">预览</span>
                      <strong>{selectedExportTemplate.template_name}</strong>
                    </div>
                    <TemplatePreview config={selectedExportTemplate.config} previewStyle={exportTemplatePreviewStyle} />
                  </>
                ) : (
                  <div className="export-template-select-preview-empty">
                    <strong>暂无模板预览</strong>
                    <span>选择模板后会在这里显示预览。</span>
                  </div>
                )}
              </section>
            </div>

            <div className="content-regenerate-actions export-template-select-actions">
              <button type="button" className="secondary-action" onClick={handleCreateExportTemplate} disabled={busyKey === 'export'}>新建模板</button>
              <Dialog.Close className="secondary-action" type="button" disabled={busyKey === 'export'}>取消</Dialog.Close>
              <button type="button" className="primary-action" onClick={handleConfirmExportTemplate} disabled={exportTemplatesLoading || !selectedExportTemplate || busyKey === 'export'}>
                继续导出
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <FloatingToolbar groups={toolbarGroups} label="交付文档工具条" />
    </div>
  );
}

export default DeliveryDocsPage;
