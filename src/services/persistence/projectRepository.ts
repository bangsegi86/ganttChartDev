import type { Project } from '@/entities';
import { PROJECT_SCHEMA_VERSION } from '@/entities';
import { bridge } from '@/shared/bridge';

/**
 * Repository abstraction over project persistence. The concrete storage (JSON
 * files via Electron IPC, or localStorage in the browser) is hidden behind the
 * `bridge()`. Swapping in SQLite would only require a new bridge implementation
 * — no caller changes.
 */
export const projectRepository = {
  async save(project: Project): Promise<void> {
    const payload: Project = { ...project, updatedAt: new Date().toISOString() };
    await bridge().persistence.save(project.id, JSON.stringify(payload));
  },

  async load(id: string): Promise<Project | null> {
    const res = await bridge().persistence.load(id);
    if (!res.ok || !res.json) return null;
    return migrate(JSON.parse(res.json) as Project);
  },

  async list(): Promise<string[]> {
    return bridge().persistence.list();
  },

  async remove(id: string): Promise<void> {
    await bridge().persistence.delete(id);
  },
};

/** Autosave + crash-recovery helpers. */
export const autosaveRepository = {
  async write(project: Project): Promise<void> {
    await bridge().autosave.write(JSON.stringify(project));
  },
  async read(): Promise<Project | null> {
    const res = await bridge().autosave.read();
    if (!res.ok || !res.json) return null;
    try {
      return migrate(JSON.parse(res.json) as Project);
    } catch {
      return null;
    }
  },
  async clear(): Promise<void> {
    await bridge().autosave.clear();
  },
};

/**
 * Forward-compatible migration hook. Older documents are upgraded to the
 * current schema version here; for now we only stamp the version.
 */
function migrate(project: Project): Project {
  if (!project.schemaVersion || project.schemaVersion < PROJECT_SCHEMA_VERSION) {
    return { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
  }
  return project;
}
