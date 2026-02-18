import { computed, ref, type Ref } from 'vue';
import type { ProjectState, SelectionKey } from '../types/worker-state';

type CreateSessionFn = (projectId: string) => Promise<{ id: string; projectId: string }>;

function getProjectSessionIds(project: ProjectState): string[] {
  const ids: string[] = [];
  Object.values(project.sandboxes).forEach((sandbox) => {
    ids.push(...sandbox.rootSessions);
  });
  return Array.from(new Set(ids));
}

function firstProjectId(projects: Record<string, ProjectState>) {
  const ids = Object.keys(projects);
  if (ids.length === 0) return '';
  if (projects.global) return 'global';
  return ids[0] ?? '';
}

export function useSessionSelection(
  projects: Ref<Record<string, ProjectState>>,
  createSessionFn: CreateSessionFn,
) {
  const selectedKey = ref<SelectionKey>({ projectId: '', sessionId: '' });

  const projectMap = computed(() => projects.value);

  const selectedProjectId = computed(() => selectedKey.value.projectId);
  const selectedSessionId = computed(() => selectedKey.value.sessionId);
  const project = computed(() => projectMap.value[selectedProjectId.value]);

  const activeDirectory = computed(() => {
    const currentProject = project.value;
    const sessionId = selectedSessionId.value;
    if (!currentProject || !sessionId) return currentProject?.worktree ?? '';
    for (const sandbox of Object.values(currentProject.sandboxes)) {
      if (sandbox.sessions[sessionId]) return sandbox.directory;
    }
    return currentProject.worktree;
  });

  const projectDirectory = computed(() => project.value?.worktree ?? '');

  async function ensureSession(projectIdHint?: string): Promise<SelectionKey> {
    const map = projectMap.value;
    let projectId = projectIdHint?.trim() || selectedKey.value.projectId;
    if (!projectId || !map[projectId]) {
      projectId = firstProjectId(map);
    }
    if (!projectId) {
      throw new Error('No available project for selection.');
    }

    const targetProject = map[projectId];
    const ids = getProjectSessionIds(targetProject);
    if (ids.length > 0) {
      const key: SelectionKey = { projectId, sessionId: ids[0] };
      selectedKey.value = key;
      return key;
    }

    const created = await createSessionFn(projectId);
    const key: SelectionKey = {
      projectId: created.projectId || projectId,
      sessionId: created.id,
    };
    selectedKey.value = key;
    return key;
  }

  async function switchSession(projectId: string, sessionId: string) {
    const nextProjectId = projectId.trim();
    const nextSessionId = sessionId.trim();
    if (!nextProjectId || !nextSessionId) {
      await ensureSession(nextProjectId);
      return;
    }

    const nextProject = projectMap.value[nextProjectId];
    if (!nextProject) {
      await ensureSession();
      return;
    }

    const exists = Object.values(nextProject.sandboxes).some((sandbox) =>
      Boolean(sandbox.sessions[nextSessionId]),
    );
    if (!exists) {
      await ensureSession(nextProjectId);
      return;
    }

    selectedKey.value = {
      projectId: nextProjectId,
      sessionId: nextSessionId,
    };
  }

  async function initialize() {
    if (selectedKey.value.projectId && selectedKey.value.sessionId) return selectedKey.value;
    return ensureSession();
  }

  return {
    selectedKey,
    selectedProjectId,
    selectedSessionId,
    project,
    activeDirectory,
    projectDirectory,
    switchSession,
    ensureSession,
    initialize,
  };
}
