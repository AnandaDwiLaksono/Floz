import { BadRequestException } from '@nestjs/common';
import { createTaskAssigneesTx as createTaskAssigneesCoreTx, createTaskRecordTx as createTaskRecordCoreTx, validateTaskTemplateReferences as validateTaskTemplateReferencesCore, writeTaskHistoryTx as writeTaskHistoryCoreTx } from '@floz/database';
export type { TaskAssigneeInput, TaskCreationInput, TaskTemplateReferences } from '@floz/database';

function wrap(error: unknown): never {
  if (error instanceof BadRequestException) throw error;
  if (error instanceof Error && ['VALIDATION_ERROR', 'WORKFLOW_SCOPE_MISMATCH', 'STATUS_SCOPE_MISMATCH', 'TEAM_SCOPE_MISMATCH', 'CROSS_WORKSPACE_REFERENCE'].includes(error.message)) {
    throw new BadRequestException(error.message);
  }
  throw error;
}

export async function validateTaskTemplateReferences(...args: Parameters<typeof validateTaskTemplateReferencesCore>) {
  try { return await validateTaskTemplateReferencesCore(...args); } catch (error) { wrap(error); }
}

export async function createTaskRecordTx(...args: Parameters<typeof createTaskRecordCoreTx>) {
  try { return await createTaskRecordCoreTx(...args); } catch (error) { wrap(error); }
}

export async function createTaskAssigneesTx(...args: Parameters<typeof createTaskAssigneesCoreTx>) {
  try { return await createTaskAssigneesCoreTx(...args); } catch (error) { wrap(error); }
}

export async function writeTaskHistoryTx(...args: Parameters<typeof writeTaskHistoryCoreTx>) {
  try { return await writeTaskHistoryCoreTx(...args); } catch (error) { wrap(error); }
}
