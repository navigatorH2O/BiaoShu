const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getWorkspaceDir } = require('../utils/paths.cjs');

const DOC_TYPES = [
  'overview-design',
  'detail-design',
  'database-design',
  'api-docs',
  'deployment-topology',
  'user-manual',
  'ops-manual',
  'backup-recovery',
];

const RUNNING_STATUSES = new Set(['outline-generating', 'content-generating', 'exporting', 'running']);

function now() {
  return new Date().toISOString();
}

function createDefaultDocumentState() {
  return {
    status: 'idle',
    outline: '',
    outline_data: null,
    progress: 0,
    message: '',
    logs: [],
  };
}

function createDefaultProject(projectId, projectName, sourceFileName) {
  return {
    project_id: projectId,
    project_name: projectName,
    source_file_name: sourceFileName,
    imported_at: now(),
    context_status: 'idle',
    context: null,
    context_confirmed: false,
    documents: Object.fromEntries(DOC_TYPES.map((docType) => [docType, createDefaultDocumentState()])),
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const projects = Array.isArray(state.projects) ? state.projects : [];
  return {
    projects: projects.map((project) => {
      const documents = Object.fromEntries(DOC_TYPES.map((docType) => {
        const stored = project.documents?.[docType];
        const base = stored && typeof stored === 'object' ? stored : {};
        const documentState = {
          status: base.status || 'idle',
          outline: typeof base.outline === 'string' ? base.outline : '',
          outline_data: base.outline_data || null,
          outline_generated_at: base.outline_generated_at,
          content_path: base.content_path,
          content_generated_at: base.content_generated_at,
          exported_path: base.exported_path,
          exported_at: base.exported_at,
          error: base.error,
          progress: Number.isFinite(Number(base.progress)) ? Number(base.progress) : 0,
          message: typeof base.message === 'string' ? base.message : '',
          logs: Array.isArray(base.logs) ? base.logs : [],
          started_at: base.started_at,
        };
        return [docType, documentState];
      }));
      return {
        project_id: project.project_id,
        project_name: project.project_name,
        source_file_name: project.source_file_name,
        source_markdown_path: project.source_markdown_path,
        imported_at: project.imported_at || now(),
        context_status: project.context_status || 'idle',
        context: project.context || null,
        context_confirmed: Boolean(project.context_confirmed),
        output_dir: project.output_dir,
        documents,
      };
    }),
    active_project_id: state.active_project_id,
    active_doc_type: DOC_TYPES.includes(state.active_doc_type) ? state.active_doc_type : 'overview-design',
  };
}

function createDeliveryDocsStore({ app } = {}) {
  const storeCreatedAt = Date.parse(now());
  const rootDir = path.join(getWorkspaceDir(app), 'delivery-docs');
  const projectsDir = path.join(rootDir, 'projects');
  const statePath = path.join(rootDir, 'state.json');

  function ensureDirs() {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  function projectDir(projectId) {
    const safeId = String(projectId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(projectsDir, safeId);
  }

  function readState() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
      raw = null;
    }
    const savedAt = typeof raw?.saved_at === 'string' ? Date.parse(raw.saved_at) : 0;
    if (!raw || !Number.isFinite(savedAt) || savedAt < storeCreatedAt) {
      const state = recoverStaleRunning(normalizeState(raw || {}));
      return writeState(state);
    }
    return normalizeState(raw);
  }

  function recoverStaleRunning(state) {
    return {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        documents: Object.fromEntries(Object.entries(project.documents).map(([docType, document]) => {
          if (!RUNNING_STATUSES.has(document.status)) {
            return [docType, document];
          }
          return [docType, {
            ...document,
            status: document.status === 'outline-generating' ? 'outline-error' : 'content-error',
            error: '上次任务未完成，请重新执行。',
            progress: 0,
          }];
        })),
      })),
    };
  }

  function writeState(state) {
    ensureDirs();
    fs.writeFileSync(statePath, `${JSON.stringify({ ...normalizeState(state), saved_at: now() }, null, 2)}\n`, 'utf-8');
    return readState();
  }

  function updateProject(projectId, partial) {
    const state = readState();
    const index = state.projects.findIndex((project) => project.project_id === projectId);
    if (index === -1) {
      return state;
    }
    state.projects[index] = { ...state.projects[index], ...partial };
    if (!state.active_project_id) {
      state.active_project_id = projectId;
    }
    return writeState(state);
  }

  function updateDocument(projectId, docType, partial) {
    const state = readState();
    const project = state.projects.find((item) => item.project_id === projectId);
    if (!project || !DOC_TYPES.includes(docType)) {
      return state;
    }
    project.documents[docType] = { ...project.documents[docType], ...partial };
    return writeState(state);
  }

  return {
    getState: readState,
    getRootDir: () => rootDir,
    getProjectsDir: () => projectsDir,

    createProject({ projectName, sourceFileName, sourceMarkdown }) {
      const state = readState();
      const projectId = crypto.randomUUID();
      const dir = projectDir(projectId);
      const sourceMarkdownPath = path.join(dir, 'source.md');
      const project = createDefaultProject(projectId, projectName, sourceFileName);
      project.source_markdown_path = sourceMarkdownPath;
      ensureDirs();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(sourceMarkdownPath, String(sourceMarkdown || ''), 'utf-8');
      state.projects.push(project);
      state.active_project_id = projectId;
      return writeState(state);
    },

    updateProject,
    updateDocument,

    setActive(projectId, docType) {
      const state = readState();
      const project = state.projects.find((item) => item.project_id === projectId);
      if (!project) {
        return state;
      }
      state.active_project_id = projectId;
      if (DOC_TYPES.includes(docType)) {
        state.active_doc_type = docType;
      }
      return writeState(state);
    },

    getSourceMarkdown(projectId) {
      const project = readState().projects.find((item) => item.project_id === projectId);
      if (!project?.source_markdown_path) {
        return '';
      }
      try {
        return fs.readFileSync(project.source_markdown_path, 'utf-8');
      } catch {
        return '';
      }
    },

    saveContent(projectId, docType, content) {
      const project = readState().projects.find((item) => item.project_id === projectId);
      if (!project || !DOC_TYPES.includes(docType)) {
        return null;
      }
      const contentPath = path.join(projectDir(projectId), `${docType}.md`);
      fs.mkdirSync(path.dirname(contentPath), { recursive: true });
      fs.writeFileSync(contentPath, String(content || ''), 'utf-8');
      return contentPath;
    },

    getContent(projectId, docType) {
      const project = readState().projects.find((item) => item.project_id === projectId);
      const contentPath = project?.documents?.[docType]?.content_path;
      if (!contentPath) {
        return '';
      }
      try {
        return fs.readFileSync(contentPath, 'utf-8');
      } catch {
        return '';
      }
    },

    clear() {
      try {
        fs.rmSync(rootDir, { recursive: true, force: true });
      } catch {
        // 清空失败不阻塞流程
      }
      return { projects: [], active_project_id: '', active_doc_type: 'overview-design' };
    },
  };
}

module.exports = {
  createDeliveryDocsStore,
};
