import type { Project } from '@/entities';
import { PROJECT_SCHEMA_VERSION } from '@/entities';
import { bridge } from '@/shared/bridge';

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
