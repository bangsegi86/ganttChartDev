import { useCallback } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Draggable vertical divider that resizes the grid pane. */
export function SplitDivider() {
  const gridWidth = useProjectStore((s) => s.view.gridWidth);
  const setGridWidth = useProjectStore((s) => s.setGridWidth);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = gridWidth;
      const move = (ev: MouseEvent) => setGridWidth(startW + (ev.clientX - startX));
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [gridWidth, setGridWidth],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="z-10 w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent"
      role="separator"
      aria-orientation="vertical"
      aria-label="패널 크기 조절"
    />
  );
}
