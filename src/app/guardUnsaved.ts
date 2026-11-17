import { useProjectStore } from '@/app/store/useProjectStore';
import { askChoice } from '@/shared/ui/ChoiceDialog';

/**
 * Before replacing the open project (new / open file), offer to save unsaved
 * work. Resolves `true` when it is OK to continue.
 */
export async function confirmLeaveUnsaved(actionLabel: string): Promise<boolean> {
  const store = useProjectStore.getState();
  if (!store.dirty) return true;
  const pick = await askChoice({
    title: '저장하지 않은 변경 사항이 있습니다',
    message: `${actionLabel} 전에 지금 프로젝트를 저장할까요?`,
    options: [
      { value: 'save', primary: true, label: '저장하고 계속' },
      { value: 'discard', label: '저장하지 않고 계속', hint: '마지막으로 저장한 뒤의 변경 내용은 사라집니다.' },
    ],
  });
  if (pick === null) return false;
  if (pick === 'save') {
    await useProjectStore.getState().saveProject();
    // The save dialog may have been cancelled: don't throw the work away.
    return !useProjectStore.getState().dirty;
  }
  return true;
}

export async function newProjectSafely(): Promise<void> {
  if (await confirmLeaveUnsaved('새 프로젝트를 만들기')) useProjectStore.getState().newProject();
}

export async function openProjectSafely(): Promise<void> {
  if (await confirmLeaveUnsaved('다른 파일을 열기')) await useProjectStore.getState().shareImport();
}
