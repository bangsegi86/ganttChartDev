import { useState } from 'react';
import { Eye, FolderPlus, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';

/**
 * Manage 보기 그룹 (view groups): named collections of tasks gathered for
 * focused viewing. Create a group from the current selection, add/remove the
 * selection to/from a group, recolour, rename, and activate a group as the
 * active display filter.
 */
export function ViewGroupManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useProjectStore((s) => s.derived.project.viewGroups);
  const selectedIds = useProjectStore((s) => s.selectedTaskIds);
  const filterMode = useProjectStore((s) => s.view.filterMode);
  const filterGroupId = useProjectStore((s) => s.view.filterGroupId);

  const createViewGroup = useProjectStore((s) => s.createViewGroup);
  const renameViewGroup = useProjectStore((s) => s.renameViewGroup);
  const setViewGroupColor = useProjectStore((s) => s.setViewGroupColor);
  const removeViewGroup = useProjectStore((s) => s.removeViewGroup);
  const addTasksToGroup = useProjectStore((s) => s.addTasksToGroup);
  const removeTasksFromGroup = useProjectStore((s) => s.removeTasksFromGroup);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);

  const [name, setName] = useState('');
  const selCount = selectedIds.size;

  const create = () => {
    createViewGroup(name.trim(), [...selectedIds]);
    setName('');
  };

  return (
    <Modal open={open} onClose={onClose} title="보기 그룹" width={560}>
      <p className="mb-3 text-2xs text-content-muted">
        그리드에서 작업을 선택한 뒤 그룹에 담아두면, 그 그룹만 따로 모아 볼 수 있습니다.
      </p>

      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col text-2xs text-content-muted">
          새 그룹 이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="예: 1차 릴리스"
            className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
          />
        </label>
        <Button size="sm" variant="accent" onClick={create}>
          <FolderPlus size={14} /> 그룹 만들기{selCount > 0 ? ` (선택 ${selCount}개 포함)` : ''}
        </Button>
      </div>

      <div className="max-h-72 space-y-2 overflow-auto">
        {groups.map((g) => {
          const isActive = filterMode === 'group' && filterGroupId === g.id;
          return (
            <div key={g.id} className="rounded-lg border border-border bg-surface-2 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={g.color}
                  onChange={(e) => setViewGroupColor(g.id, e.target.value)}
                  className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                  aria-label="그룹 색상"
                  title="색상 변경"
                />
                <input
                  value={g.name}
                  onChange={(e) => renameViewGroup(g.id, e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium text-content hover:border-border focus:border-accent focus:outline-none"
                  aria-label="그룹 이름"
                />
                <span className="shrink-0 text-2xs text-content-muted">{g.taskIds.length}개 작업</span>
                <Button
                  size="sm"
                  active={isActive}
                  onClick={() => setViewFilter(isActive ? 'all' : 'group', g.id)}
                  title="이 그룹만 보기"
                >
                  <Eye size={13} /> {isActive ? '보는 중' : '보기'}
                </Button>
                <button
                  onClick={() => removeViewGroup(g.id)}
                  aria-label="그룹 삭제"
                  className="shrink-0 text-content-muted hover:text-critical"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 pl-8">
                <Button
                  size="sm"
                  disabled={selCount === 0}
                  onClick={() => addTasksToGroup(g.id, [...selectedIds])}
                  title="선택한 작업을 이 그룹에 추가"
                >
                  <Plus size={13} /> 선택 추가{selCount > 0 ? ` (${selCount})` : ''}
                </Button>
                <Button
                  size="sm"
                  disabled={selCount === 0}
                  onClick={() => removeTasksFromGroup(g.id, [...selectedIds])}
                  title="선택한 작업을 이 그룹에서 제외"
                >
                  선택 제외
                </Button>
              </div>
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="rounded border border-dashed border-border p-6 text-center text-xs text-content-muted">
            아직 보기 그룹이 없습니다. 위에서 새 그룹을 만들어 보세요.
          </div>
        )}
      </div>
    </Modal>
  );
}
