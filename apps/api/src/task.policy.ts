export type TaskRole = 'ADMIN' | 'MANAGER' | 'MEMBER' | 'FIELD_WORKER';

export class TaskPolicy {
  static canMutate(role: TaskRole): boolean { return ['ADMIN', 'MANAGER', 'MEMBER', 'FIELD_WORKER'].includes(role); }
  static canAssign(role: TaskRole): boolean { return ['ADMIN', 'MANAGER', 'MEMBER'].includes(role); }
  static canDelete(role: TaskRole): boolean { return ['ADMIN', 'MANAGER'].includes(role); }
}
