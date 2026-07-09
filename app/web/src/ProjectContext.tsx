import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { listProjects } from './api';
import type { ProjectRegistration } from './types';

const STORAGE_KEY = 'memorycastle.currentProjectId';

interface ProjectContextValue {
  projects: ProjectRegistration[];
  loading: boolean;
  error: Error | null;
  currentProjectId: string | null;
  currentProject: ProjectRegistration | null;
  setCurrentProjectId: (id: string | null) => void;
  refreshProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProjects()
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const setCurrentProjectId = useCallback((id: string | null) => {
    setCurrentProjectIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const value: ProjectContextValue = {
    projects,
    loading,
    error,
    currentProjectId: currentProject ? currentProjectId : null,
    currentProject,
    setCurrentProjectId,
    refreshProjects: () => setTick((t) => t + 1),
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
}
