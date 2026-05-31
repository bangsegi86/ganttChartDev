import { nanoid } from 'nanoid';
import type {
  Baseline,
  Dependency,
  Project,
  Resource,
  Task,
} from '@/entities';
import { DEFAULT_CALENDAR } from '@/entities';
import { generateKoreanHolidays } from '@/services/holiday/koreanHolidays';
import { scheduleProject } from '@/services/scheduler/scheduleEngine';

/** Stable id helper for seeded demo content. */
const newId = (): string => nanoid(10);

const RESOURCES: Resource[] = [
  { id: 'r-pm', name: '김지훈', role: 'PM', color: '#6366f1', capacityHoursPerDay: 8 },
  { id: 'r-be', name: '이서연', role: 'Backend', color: '#10b981', capacityHoursPerDay: 8 },
  { id: 'r-fe', name: '박민준', role: 'Frontend', color: '#f59e0b', capacityHoursPerDay: 8 },
  { id: 'r-qa', name: '최유나', role: 'QA', color: '#ef4444', capacityHoursPerDay: 8 },
  { id: 'r-design', name: '정도윤', role: 'Design', color: '#ec4899', capacityHoursPerDay: 8 },
];

function task(partial: Partial<Task> & Pick<Task, 'id' | 'name'>): Task {
  return {
    parentId: null,
    start: '2026-06-01',
    end: '2026-06-01',
    durationDays: 1,
    progress: 0,
    priority: 'medium',
    assigneeIds: [],
    notes: '',
    isMilestone: false,
    collapsed: false,
    constraint: 'asap',
    constraintDate: null,
    manuallyScheduled: false,
    order: 0,
    color: null,
    ...partial,
  };
}

/**
 * A small, realistic software-delivery project used as the default document.
 * Dates are computed by running the scheduler so the demo opens fully solved.
 */
export function createDemoProject(): Project {
  const planId = 'plan';
  const designId = 'design';
  const devId = 'dev';
  const qaId = 'qa';

  const tasks: Task[] = [
    task({ id: planId, name: '기획 및 요구사항', priority: 'high', order: 0 }),
    task({
      id: 'plan-1',
      name: '요구사항 정의',
      parentId: planId,
      durationDays: 4,
      progress: 100,
      assigneeIds: ['r-pm'],
      order: 0,
    }),
    task({
      id: 'plan-2',
      name: '범위 확정',
      parentId: planId,
      durationDays: 2,
      progress: 100,
      assigneeIds: ['r-pm'],
      priority: 'high',
      order: 1,
    }),
    task({ id: 'm-kickoff', name: '킥오프', isMilestone: true, order: 1, priority: 'high' }),

    task({ id: designId, name: '설계', order: 2 }),
    task({
      id: 'design-1',
      name: 'UX 와이어프레임',
      parentId: designId,
      durationDays: 5,
      progress: 80,
      assigneeIds: ['r-design'],
      order: 0,
    }),
    task({
      id: 'design-2',
      name: 'UI 디자인',
      parentId: designId,
      durationDays: 6,
      progress: 40,
      assigneeIds: ['r-design'],
      order: 1,
    }),
    task({
      id: 'design-3',
      name: 'API 설계',
      parentId: designId,
      durationDays: 4,
      progress: 50,
      assigneeIds: ['r-be'],
      order: 2,
    }),

    task({ id: devId, name: '개발', priority: 'high', order: 3 }),
    task({
      id: 'dev-1',
      name: '백엔드 API',
      parentId: devId,
      durationDays: 12,
      progress: 20,
      assigneeIds: ['r-be'],
      priority: 'high',
      order: 0,
    }),
    task({
      id: 'dev-2',
      name: '프론트엔드 화면',
      parentId: devId,
      durationDays: 14,
      progress: 10,
      assigneeIds: ['r-fe'],
      priority: 'high',
      order: 1,
    }),
    task({
      id: 'dev-3',
      name: '통합',
      parentId: devId,
      durationDays: 4,
      assigneeIds: ['r-be', 'r-fe'],
      priority: 'critical',
      order: 2,
    }),

    task({ id: qaId, name: '품질 보증', order: 4 }),
    task({
      id: 'qa-1',
      name: '테스트 케이스 작성',
      parentId: qaId,
      durationDays: 3,
      assigneeIds: ['r-qa'],
      order: 0,
    }),
    task({
      id: 'qa-2',
      name: '시스템 테스트',
      parentId: qaId,
      durationDays: 6,
      assigneeIds: ['r-qa'],
      priority: 'high',
      order: 1,
    }),
    task({ id: 'm-release', name: '릴리스', isMilestone: true, priority: 'critical', order: 5 }),
  ];

  const dependencies: Dependency[] = [
    dep('plan-1', 'plan-2', 'FS'),
    dep('plan-2', 'm-kickoff', 'FS'),
    dep('m-kickoff', 'design-1', 'FS'),
    dep('design-1', 'design-2', 'FS'),
    dep('design-1', 'design-3', 'FS'),
    dep('design-2', 'dev-2', 'FS'),
    dep('design-3', 'dev-1', 'FS'),
    dep('dev-1', 'dev-3', 'FS'),
    dep('dev-2', 'dev-3', 'FS'),
    dep('design-1', 'qa-1', 'SS', 5),
    dep('dev-3', 'qa-2', 'FS'),
    dep('qa-1', 'qa-2', 'FS'),
    dep('qa-2', 'm-release', 'FS'),
  ];

  const base: Project = {
    schemaVersion: 1,
    id: 'demo',
    name: '신제품 출시 프로젝트',
    startDate: '2026-06-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    calendar: DEFAULT_CALENDAR,
    tasks,
    dependencies,
    resources: RESOURCES,
    holidays: generateKoreanHolidays(2025, 2027),
    baselines: [],
    activeBaselineId: null,
    viewGroups: [
      { id: 'vg-dev', name: '개발 작업', color: '#10b981', taskIds: ['dev-1', 'dev-2', 'dev-3'] },
      { id: 'vg-milestones', name: '주요 마일스톤', color: '#8b5cf6', taskIds: ['m-kickoff', 'm-release'] },
    ],
  };

  const { tasks: scheduled } = scheduleProject(base);
  return { ...base, tasks: scheduled };
}

function dep(
  fromId: string,
  toId: string,
  type: Dependency['type'],
  lagDays = 0,
): Dependency {
  return { id: newId(), fromId, toId, type, lagDays };
}

/**
 * Synthetic large project for performance/virtualisation testing. Produces
 * `phaseCount * tasksPerPhase` leaf tasks plus phase summaries, chained FS.
 */
export function createLargeProject(phaseCount = 200, tasksPerPhase = 50): Project {
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];

  for (let p = 0; p < phaseCount; p++) {
    const phaseId = `phase-${p}`;
    tasks.push(task({ id: phaseId, name: `Phase ${p + 1}`, order: p }));
    let prev: string | null = null;
    for (let i = 0; i < tasksPerPhase; i++) {
      const id = `t-${p}-${i}`;
      tasks.push(
        task({
          id,
          name: `작업 ${p + 1}.${i + 1}`,
          parentId: phaseId,
          durationDays: 1 + ((i * 7 + p) % 6),
          progress: (i * 13 + p * 7) % 101,
          assigneeIds: [RESOURCES[(i + p) % RESOURCES.length]!.id],
          priority: (['low', 'medium', 'high', 'critical'] as const)[(i + p) % 4]!,
          order: i,
        }),
      );
      if (prev) dependencies.push(dep(prev, id, 'FS'));
      prev = id;
    }
  }

  const base: Project = {
    schemaVersion: 1,
    id: 'large',
    name: `대규모 테스트 (${phaseCount * tasksPerPhase} tasks)`,
    startDate: '2026-01-05',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    calendar: DEFAULT_CALENDAR,
    tasks,
    dependencies,
    resources: RESOURCES,
    holidays: generateKoreanHolidays(2025, 2030),
    baselines: [] as Baseline[],
    activeBaselineId: null,
    viewGroups: [],
  };
  const { tasks: scheduled } = scheduleProject(base);
  return { ...base, tasks: scheduled };
}
