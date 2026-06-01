// Barrel for the domain model. Importing from `@/entities` keeps feature code
// decoupled from the physical file layout.
export type { Task, TaskId, TaskSchedule, Priority, ConstraintType } from './task/types';
export type { Dependency, DependencyId, DependencyType } from './dependency/types';
export type { Resource, ResourceId } from './resource/types';
export type { Holiday } from './holiday/types';
export type { WorkCalendar } from './calendar/types';
export { DEFAULT_CALENDAR } from './calendar/types';
export type { Baseline, BaselineEntry } from './baseline/types';
export type { ViewGroup, ViewGroupId } from './viewGroup/types';
export type { ChartMarker } from './chartMarker/types';
export type { Project } from './project/types';
export { PROJECT_SCHEMA_VERSION } from './project/types';
