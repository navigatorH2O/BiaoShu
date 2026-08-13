const crypto = require('node:crypto');
const path = require('node:path');
const { dialog, shell } = require('electron');
const { parseDocumentWithConfig } = require('./fileService.cjs');
const {
  DELIVERY_DOC_TYPES,
  buildProjectContextPrompt,
  buildOutlinePrompt,
  buildDocumentPrompt,
} = require('./deliveryDocsPrompts.cjs');

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.docx', '.doc', '.pdf', '.md', '.markdown', '.txt', '.wps']);

function now() {
  return new Date().toISOString();
}

function sanitizeFilename(value) {
  return String(value || '未命名')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名';
}

function buildOutlineItem(section, parentId, index) {
  const id = `${parentId}-${index + 1}`;
  return {
    id,
    title: String(section?.title || '').trim() || '未命名章节',
    description: String(section?.description || '').trim(),
    children: Array.isArray(section?.children)
      ? section.children.map((child, childIndex) => buildOutlineItem(child, id, childIndex))
      : [],
  };
}

function renderOutlineDataToMarkdown(outlineData) {
  const lines = [];
  const visit = (items, numbers) => {
    for (const [index, item] of (items || []).entries()) {
      const numberParts = [...numbers, index + 1];
      const heading = `${numberParts.join('.')} ${item.title || '未命名章节'}`.trim();
      lines.push(`${'#'.repeat(Math.min(numberParts.length + 1, 6))} ${heading}`);
      if (item.description) {
        lines.push('');
        lines.push(item.description);
      }
      lines.push('');
      if (Array.isArray(item.children) && item.children.length) {
        visit(item.children, numberParts);
      }
    }
  };
  lines.push(`# ${outlineData?.project_name || '交付文档'}`);
  lines.push('');
  visit(outlineData?.outline || [], []);
  return lines.join('\n').trim();
}

function buildOutlineDataAndMarkdown(parsed, projectName) {
  const outline = (Array.isArray(parsed?.sections) ? parsed.sections : []).map((section, index) => buildOutlineItem(section, 'root', index));
  const outlineData = {
    project_name: String(parsed?.title || projectName || '交付文档').trim(),
    outline,
  };
  return {
    outline_data: outlineData,
    outline: renderOutlineDataToMarkdown(outlineData),
  };
}

function normalizeContext(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const list = (field) => Array.isArray(raw[field]) ? raw[field].map((item) => String(item || '').trim()).filter(Boolean) : [];
  return {
    project_name: String(raw.project_name || '').trim(),
    system_name: String(raw.system_name || '').trim(),
    system_summary: String(raw.system_summary || '').trim(),
    business_modules: list('business_modules'),
    user_roles: list('user_roles'),
    tech_stack: list('tech_stack'),
    data_domains: list('data_domains'),
    deployment_scale: String(raw.deployment_scale || '').trim(),
    third_party_integrations: list('third_party_integrations'),
    compliance_notes: String(raw.compliance_notes || '').trim(),
    raw_analysis: String(raw.raw_analysis || '').trim(),
  };
}

function normalizeUserContext(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const list = (field) => Array.isArray(raw[field])
    ? raw[field].map((item) => String(item || '').trim()).filter(Boolean)
    : String(raw[field] || '')
      .split(/[,，、\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  return {
    project_name: String(raw.project_name || '').trim(),
    system_name: String(raw.system_name || '').trim(),
    system_summary: String(raw.system_summary || '').trim(),
    business_modules: list('business_modules'),
    user_roles: list('user_roles'),
    tech_stack: list('tech_stack'),
    data_domains: list('data_domains'),
    deployment_scale: String(raw.deployment_scale || '').trim(),
    third_party_integrations: list('third_party_integrations'),
    compliance_notes: String(raw.compliance_notes || '').trim(),
    raw_analysis: String(raw.raw_analysis || '').trim(),
  };
}

function createDeliveryDocsService({ app, configStore, aiService, fileService, exportService, deliveryDocsStore }) {
  const subscribers = new Set();
  let taskQueue = Promise.resolve();

  function enqueue(taskFn) {
    const next = taskQueue.then(() => taskFn());
    taskQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  function emitState() {
    const state = deliveryDocsStore.getState();
    const payload = { state };
    for (const webContents of subscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send('delivery-docs:event', payload);
      }
    }
    return state;
  }

  function updateProject(projectId, partial) {
    deliveryDocsStore.updateProject(projectId, partial);
    return emitState();
  }

  function updateDocument(projectId, docType, partial) {
    deliveryDocsStore.updateDocument(projectId, docType, partial);
    return emitState();
  }

  function pushDocumentLog(projectId, docType, message, progress) {
    const state = deliveryDocsStore.getState();
    const project = state.projects.find((item) => item.project_id === projectId);
    const document = project?.documents?.[docType];
    const logs = Array.isArray(document?.logs) ? document.logs.slice(-29) : [];
    logs.push(message);
    return updateDocument(projectId, docType, { message, progress, logs });
  }

  function getDocTypeMeta(docType) {
    return DELIVERY_DOC_TYPES.find((item) => item.id === docType) || DELIVERY_DOC_TYPES[0];
  }

  function getNextDocType(docType) {
    const index = DELIVERY_DOC_TYPES.findIndex((item) => item.id === docType);
    const nextIndex = index === -1 ? 0 : (index + 1) % DELIVERY_DOC_TYPES.length;
    return DELIVERY_DOC_TYPES[nextIndex].id;
  }

  async function importProjects(webContents) {
    const result = await dialog.showOpenDialog({
      title: '批量导入项目清单',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '项目清单与文档', extensions: ['xlsx', 'xls', 'docx', 'doc', 'pdf', 'md', 'txt', 'wps'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { state: emitState(), message: '已取消选择', errors: [] };
    }

    const config = configStore.load();
    const errors = [];
    let created = 0;
    let state = deliveryDocsStore.getState();
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        errors.push(`${path.basename(filePath)}：不支持该文件格式`);
        continue;
      }
      try {
        const assetHash = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 12);
        const markdown = (await parseDocumentWithConfig(app, filePath, config, {
          assetScope: `delivery-docs-${assetHash}`,
          preserveImages: false,
        })).trim();
        if (!markdown) {
          errors.push(`${path.basename(filePath)}：未提取到有效内容`);
          continue;
        }
        const projectName = path.basename(filePath, ext);
        state = deliveryDocsStore.createProject({
          projectName,
          sourceFileName: path.basename(filePath),
          sourceMarkdown: markdown,
        });
        created += 1;
      } catch (error) {
        errors.push(`${path.basename(filePath)}：${error?.message || String(error)}`);
      }
    }
    subscribers.add(webContents);
    state = emitState();
    const messageParts = [`成功导入 ${created} 个项目`];
    if (errors.length) messageParts.push(`${errors.length} 个失败`);
    return { state, message: messageParts.join('，'), errors };
  }

  async function generateProjectContext(projectId, webContents) {
    subscribers.add(webContents);
    return enqueue(async () => {
      const project = deliveryDocsStore.getState().projects.find((item) => item.project_id === projectId);
      if (!project) {
        throw new Error('项目不存在');
      }
      updateProject(projectId, { context_status: 'running', context: project.context });
      try {
        const sourceMarkdown = deliveryDocsStore.getSourceMarkdown(projectId);
        const scopedAi = aiService.withQueueScope(`delivery-docs-context:${projectId}`);
        const prompt = buildProjectContextPrompt(sourceMarkdown, project.project_name);
        const parsed = await scopedAi.requestJson(prompt);
        const context = normalizeContext(parsed);
        context.project_name = context.project_name || project.project_name;
        return updateProject(projectId, {
          context_status: 'success',
          context,
        });
      } catch (error) {
        updateProject(projectId, { context_status: 'error' });
        throw error;
      }
    });
  }

  async function generateOutline(projectId, docType, webContents) {
    subscribers.add(webContents);
    return enqueue(async () => {
      const state = deliveryDocsStore.getState();
      const project = state.projects.find((item) => item.project_id === projectId);
      if (!project) {
        throw new Error('项目不存在');
      }
      if (!project.context_confirmed || !project.context) {
        throw new Error('请先确认项目上下文');
      }
      updateDocument(projectId, docType, {
        status: 'outline-generating',
        progress: 5,
        message: '正在根据项目清单生成目录',
        error: undefined,
        started_at: now(),
        logs: ['正在根据项目清单生成目录'],
      });
      try {
        pushDocumentLog(projectId, docType, 'AI 正在分析项目清单并规划目录结构', 35);
        const sourceMarkdown = deliveryDocsStore.getSourceMarkdown(projectId);
        const docTypeMeta = getDocTypeMeta(docType);
        const scopedAi = aiService.withQueueScope(`delivery-docs-outline:${projectId}:${docType}`);
        const prompt = buildOutlinePrompt(docTypeMeta, project.context, sourceMarkdown);
        const parsed = await scopedAi.requestJson(prompt);
        const { outline_data, outline } = buildOutlineDataAndMarkdown(parsed, project.project_name);
        if (!outline || !outline_data.outline.length) {
          throw new Error('目录生成为空，请重试');
        }
        pushDocumentLog(projectId, docType, '目录已生成，请编辑并确认', 100);
        return updateDocument(projectId, docType, {
          status: 'outline-ready',
          outline_data,
          outline,
          outline_generated_at: now(),
          progress: 100,
          message: '目录已生成，请编辑并确认',
          error: undefined,
        });
      } catch (error) {
        updateDocument(projectId, docType, {
          status: 'outline-error',
          progress: 0,
          message: error?.message || '目录生成失败',
          error: error?.message || String(error),
        });
        throw error;
      }
    });
  }

  async function generateDocument(projectId, docType, webContents, options = {}) {
    subscribers.add(webContents);
    return enqueue(async () => {
      const state = deliveryDocsStore.getState();
      const project = state.projects.find((item) => item.project_id === projectId);
      const document = project?.documents?.[docType];
      if (!project) {
        throw new Error('项目不存在');
      }
      if (!project.context_confirmed || !project.context) {
        throw new Error('请先确认项目上下文');
      }
      if (!document?.outline.trim()) {
        throw new Error('请先生成并确认目录');
      }
      updateDocument(projectId, docType, {
        status: 'content-generating',
        progress: 10,
        message: '正在按目录生成文档正文',
        error: undefined,
        started_at: now(),
        logs: ['正在按目录生成文档正文'],
      });
      try {
        pushDocumentLog(projectId, docType, 'AI 正在按目录编写文档正文，内容较多可能需要较长时间', 30);
        const sourceMarkdown = deliveryDocsStore.getSourceMarkdown(projectId);
        const docTypeMeta = getDocTypeMeta(docType);
        const scopedAi = aiService.withQueueScope(`delivery-docs-content:${projectId}:${docType}`);
        const prompt = buildDocumentPrompt(docTypeMeta, document.outline, project.context, sourceMarkdown);
        const content = String(await scopedAi.chat(prompt)).trim();
        if (!content) {
          throw new Error('文档正文生成为空，请重试');
        }
        pushDocumentLog(projectId, docType, '文档正文已生成，正在保存', 90);
        const contentPath = deliveryDocsStore.saveContent(projectId, docType, content);
        updateDocument(projectId, docType, {
          status: 'success',
          content_path: contentPath,
          content_generated_at: now(),
          progress: 100,
          message: '文档正文已生成',
          error: undefined,
        });
        if (options.autoExport === true) {
          return await runExportDocument(projectId, docType, webContents, { export_format: options?.export_format });
        }
        return emitState();
      } catch (error) {
        updateDocument(projectId, docType, {
          status: 'content-error',
          progress: 0,
          message: error?.message || '文档生成失败',
          error: error?.message || String(error),
        });
        throw error;
      }
    });
  }

  async function runExportDocument(projectId, docType, webContents, options = {}) {
    const state = deliveryDocsStore.getState();
    const project = state.projects.find((item) => item.project_id === projectId);
    if (!project) {
      throw new Error('项目不存在');
    }
    const content = deliveryDocsStore.getContent(projectId, docType);
    if (!content.trim()) {
      throw new Error('当前文档还没有可导出的正文');
    }
    let outputDir = project.output_dir;
    if (!outputDir) {
      const selected = await dialog.showOpenDialog({
        title: '选择交付文档输出文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (selected.canceled || selected.filePaths.length === 0) {
        return emitState();
      }
      outputDir = selected.filePaths[0];
      updateProject(projectId, { output_dir: outputDir });
    }
    const docTypeMeta = getDocTypeMeta(docType);
    const targetPath = path.join(outputDir, `${sanitizeFilename(project.project_name)}-${sanitizeFilename(docTypeMeta.filename)}.docx`);
    updateDocument(projectId, docType, {
      status: 'exporting',
      progress: 2,
      message: '正在导出 Word 文档',
      error: undefined,
    });
    try {
      const payload = {
        project_name: `${project.project_name}-${docTypeMeta.label}`,
        export_format: options?.export_format || null,
        outline: [{
          id: docType,
          title: docTypeMeta.label,
          content,
        }],
      };
      const result = await exportService.exportWordToPath(payload, targetPath, (event) => {
        updateDocument(projectId, docType, {
          status: 'exporting',
          progress: Number.isFinite(Number(event?.progress)) ? Number(event.progress) : 0,
          message: event?.message || '正在导出 Word 文档',
          error: undefined,
        });
      });
      return updateDocument(projectId, docType, {
        status: 'success',
        progress: 100,
        message: 'Word 已导出',
        exported_path: result?.path || targetPath,
        exported_at: now(),
        error: undefined,
      });
    } catch (error) {
      updateDocument(projectId, docType, {
        status: 'content-error',
        progress: 0,
        message: error?.message || 'Word 导出失败',
        error: error?.message || String(error),
      });
      throw error;
    }
  }

  function exportDocument(projectId, docType, webContents, options = {}) {
    subscribers.add(webContents);
    return enqueue(() => runExportDocument(projectId, docType, webContents, options));
  }

  async function selectOutputDir(projectId, webContents) {
    subscribers.add(webContents);
    const selected = await dialog.showOpenDialog({
      title: '选择交付文档输出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selected.canceled || selected.filePaths.length === 0) {
      return emitState();
    }
    return updateProject(projectId, { output_dir: selected.filePaths[0] });
  }

  async function openOutputFolder(projectId) {
    const project = deliveryDocsStore.getState().projects.find((item) => item.project_id === projectId);
    if (!project?.output_dir) {
      return { success: false, message: '尚未选择输出文件夹' };
    }
    const error = await shell.openPath(project.output_dir);
    return error ? { success: false, message: error } : { success: true };
  }

  function skipDocument(projectId, docType) {
    const state = deliveryDocsStore.getState();
    const project = state.projects.find((item) => item.project_id === projectId);
    if (!project) {
      return emitState();
    }
    const document = project.documents[docType];
    if (!document || document.status === 'idle') {
      deliveryDocsStore.updateDocument(projectId, docType, {
        status: 'skipped',
        message: '已跳过',
        progress: 0,
        error: undefined,
      });
    }
    deliveryDocsStore.setActive(projectId, getNextDocType(docType));
    return emitState();
  }

  return {
    subscribe(webContents) {
      if (webContents) {
        subscribers.add(webContents);
      }
    },
    getState() {
      return deliveryDocsStore.getState();
    },
    importProjects,
    generateProjectContext,
    generateOutline,
    generateDocument,
    exportDocument,
    selectOutputDir,
    openOutputFolder,
    skipDocument,
    setActive(projectId, docType) {
      deliveryDocsStore.setActive(projectId, docType);
      return emitState();
    },
    saveContext(projectId, context) {
      deliveryDocsStore.updateProject(projectId, {
        context_status: 'success',
        context: normalizeUserContext(context),
      });
      return emitState();
    },
    confirmContext(projectId) {
      deliveryDocsStore.updateProject(projectId, { context_confirmed: true });
      return emitState();
    },
    saveOutline(projectId, docType, payload) {
      const outlineData = payload?.outline_data || null;
      const outline = typeof payload === 'string'
        ? payload
        : (payload?.outline || (outlineData ? renderOutlineDataToMarkdown(outlineData) : ''));
      deliveryDocsStore.updateDocument(projectId, docType, {
        status: 'outline-ready',
        outline_data: outlineData,
        outline: String(outline || ''),
        outline_generated_at: now(),
        progress: 100,
        message: '目录已确认',
        error: undefined,
      });
      return emitState();
    },
    readContent(projectId, docType) {
      return deliveryDocsStore.getContent(projectId, docType);
    },
    clear() {
      deliveryDocsStore.clear();
      return emitState();
    },
  };
}

module.exports = {
  createDeliveryDocsService,
};
