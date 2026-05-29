/**
 * A resource is a person or team that work can be assigned to. Workload and
 * over-allocation are computed against `capacityHoursPerDay`.
 */
export type ResourceId = string;

export interface Resource {
  id: ResourceId;
  name: string;
  /** Short role/label, e.g. "Backend". */
  role: string;
  /** Hex colour used in the resource view. */
  color: string;
  /** Daily working capacity in hours; default 8. */
  capacityHoursPerDay: number;
}
