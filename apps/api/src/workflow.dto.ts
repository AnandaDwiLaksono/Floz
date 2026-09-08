export interface StatusInput {
  name: string;
  code: string;
  category: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  is_initial: boolean;
}

export interface TransitionInput {
  from_status_code: string;
  to_status_code: string;
}

export interface CreateWorkflowDto {
  name: string;
  code: string;
  description?: string | null;
  team_id?: string | null;
  statuses: StatusInput[];
  transitions: TransitionInput[];
}

export interface UpdateWorkflowDto {
  name?: string;
  description?: string | null;
  version: number;
}

export interface SetWorkflowDefaultDto {
  version: number;
}

export interface ArchiveWorkflowDto {
  version: number;
}

export interface RestoreWorkflowDto {
  version: number;
}

export interface CreateStatusDto {
  name: string;
  code: string;
  category: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  version: number;
}

export interface UpdateStatusDto {
  name?: string;
  category?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  version: number;
}

export interface SetStatusInitialDto {
  version: number;
}

export interface ArchiveStatusDto {
  version: number;
}

export interface RestoreStatusDto {
  version: number;
}

export interface ReorderStatusesDto {
  status_ids: string[];
  version: number;
}

export interface BulkTransitionInput {
  from_status_id: string;
  to_status_id: string;
  requires_permission?: boolean;
}

export interface ReplaceTransitionsDto {
  transitions: BulkTransitionInput[];
  version: number;
}
