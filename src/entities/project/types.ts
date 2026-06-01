import type { Task } from '../task/types';
import type { Dependency } from '../dependency/types';
import type { Resource } from '../resource/types';
import type { Holiday } from '../holiday/types';
import type { WorkCalendar } from '../calendar/types';
import type { Baseline } from '../baseline/types';
import type { ViewGroup } from '../viewGroup/types';
import type { ChartMarker } from '../chartMarker/types';

/** Schema version enables forward-compatible migrations of saved files. */
export const PROJECT_SCHEMA_VERSION = 1;

/**
 * The complete, serialisable project document. This is the single unit that is
 * persisted, autosaved, undone/redone, and exported.
 */
export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  /** Project start anchor; ASAP tasks with no predecessors begin here. */
  startDate: string;
  createdAt: string;
  updatedAt: string;
  calendar: WorkCalendar;
  tasks: Task[];
  dependencies: Dependency[];
  resources: Resource[];
  holidays: Holiday[];
  baselines: Baseline[];
  /** Id of the baseline currently overlaid in the gantt, if any. */
  activeBaselineId: string | null;
  /** User-defined view groups (보기 그룹) for focused viewing. */
  viewGroups: ViewGroup[];
  /** Vertical marker lines drawn on the gantt chart. */
  markers: ChartMarker[];
}
