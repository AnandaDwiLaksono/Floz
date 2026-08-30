import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  createTaskAssigneesTx as createTaskAssigneesCoreTx,
  createTaskRecordTx as createTaskRecordCoreTx,
  patchTaskAssigneesTx as patchTaskAssigneesCoreTx,
  patchTaskRecordTx as patchTaskRecordCoreTx,
  validateTaskTemplateReferences as validateTaskTemplateReferencesCore,
  writeTaskHistoryTx as writeTaskHistoryCoreTx
} from '@floz/database';
export type { TaskAssigneeInput, TaskCreationInput, TaskTemplateReferences, TaskPatchInput, TaskAssignPatchInput } from '@floz/database';

function wrap(error: unknown): never {
  if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
  if (error instanceof Error) {
    if (error.message === 'VERSION_CONFLICT') throw new ConflictException('VERSION_CONFLICT');
    if (['VALIDATION_ERROR', 'WORKFLOW_SCOPE_MISMATCH', 'STATUS_SCOPE_MISMATCH', 'TEAM_SCOPE_MISMATCH', 'CROSS_WORKSPACE_REFERENCE'].includes(error.message)) {
      throw new BadRequestException(error.message);
    }
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

export async function patchTaskRecordTx(...args: Parameters<typeof patchTaskRecordCoreTx>) {
  try { return await patchTaskRecordCoreTx(...args); } catch (error) { wrap(error); }
}

export async function patchTaskAssigneesTx(...args: Parameters<typeof patchTaskAssigneesCoreTx>) {
  try { return await patchTaskAssigneesCoreTx(...args); } catch (error) { wrap(error); }
}

export async function writeTaskHistoryTx(...args: Parameters<typeof writeTaskHistoryCoreTx>) {
  try { return await writeTaskHistoryCoreTx(...args); } catch (error) { wrap(error); }
}
