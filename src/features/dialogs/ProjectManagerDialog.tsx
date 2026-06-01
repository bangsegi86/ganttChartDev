import { useEffect, useState } from 'react';
import { FilePlus2, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';
import { projectRepository } from '@/services/persistence/projectRepository';

interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  taskCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Lists all saved projects so the user can load, delete, or create a new one.
 * Uses the same persistence layer as Ctrl+S (projectRepository).
 */
export function ProjectManagerDialog({ open, onClose }: Props) {
  const loadProject = useProjectStore((s) => s.loadProject);
  const newProject = useProjectStore((s) => s.newProject);
  const currentId = useProjectStore((s) => s.derived.project.id);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const ids = await projectRepository.list();
      const metas = await Promise.all(
        ids.map(async (id) => {
          const p = await projectRepository.load(id);
          if (!p) return null;
          return {
            id,
            name: p.name || '(이름 없음)',
            updatedAt: p.updatedAt?.slice(0, 10) ?? '—',
            taskCount: p.tasks.length,
          } satisfies ProjectMeta;
        }),
      );
      setProjects(metas.filter((m): m is ProjectMeta => m !== null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const handleLoad = (id: string) => {
    void projectRepository.load(id).then((p) => {
      if (p) { loadProject(p); onClose(); }
    });
  };

  const handleDelete = async (id: string) => {
    await projectRepository.remove(id);
    setConfirmDeleteId(null);
    await refresh();
  };

  const handleNew = () => {
    newProject();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="프로젝트 열기" width={600}>
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-content-muted">
          저장된 프로젝트 {projects.length}개
        </span>
        <Button size="sm" variant="accent" onClick={handleNew}>
          <FilePlus2 size={14} /> 새 프로젝트
        </Button>
      </div>

      {/* Inline delete confirmation */}
      {confirmDeleteId && (
        <div className="mb-3 flex items-center gap-3 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-content">
          <span className="flex-1">
            「{projects.find((p) => p.id === confirmDeleteId)?.name}」을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
          </span>
          <Button size="sm" variant="danger" onClick={() => void handleDelete(confirmDeleteId)}>예, 삭제</Button>
          <Button size="sm" onClick={() => setConfirmDeleteId(null)}>아니오</Button>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-xs text-content-muted">불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div className="rounded border border-border py-10 text-center text-xs text-content-muted">
          <div className="mb-1 font-medium">저장된 프로젝트가 없습니다</div>
          <div>현재 프로젝트를 저장하려면 <kbd className="rounded border border-border px-1 py-0.5">Ctrl+S</kbd> 를 누르세요.</div>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2 text-2xs text-content-muted">
              <tr>
                <th className="p-2 text-left">프로젝트 이름</th>
                <th className="p-2 text-left">마지막 저장</th>
                <th className="p-2 text-right">작업 수</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-border ${p.id === currentId ? 'bg-accent/10' : 'hover:bg-surface-2'}`}
                >
                  <td className="p-2">
                    <span className="font-medium text-content">{p.name}</span>
                    {p.id === currentId && (
                      <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-2xs text-accent">현재</span>
                    )}
                  </td>
                  <td className="p-2 text-content-muted">{p.updatedAt}</td>
                  <td className="p-2 text-right text-content-muted">{p.taskCount}개</td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1">
                      {p.id !== currentId && (
                        <Button size="sm" onClick={() => handleLoad(p.id)}>
                          불러오기
                        </Button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="rounded p-1 text-content-muted hover:text-critical"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-2xs text-content-muted">
        프로젝트를 저장하면 이 목록에 나타납니다. 삭제한 프로젝트는 복구할 수 없습니다.
      </p>
    </Modal>
  );
}
