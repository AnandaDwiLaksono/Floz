import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CreateRecurringTaskDto, RecurrenceRuleQueryDto, UpdateRecurrenceRuleDto } from './recurrence.dto';

@Injectable()
export class RecurrenceService {
  create(workspaceId: string, actorId: string, input: CreateRecurringTaskDto): never { void workspaceId; void actorId; void input; throw new NotImplementedException('NOT_IMPLEMENTED'); }
  list(workspaceId: string, query: RecurrenceRuleQueryDto): never { void workspaceId; void query; throw new NotImplementedException('NOT_IMPLEMENTED'); }
  get(workspaceId: string, id: string): never { void workspaceId; void id; throw new NotImplementedException('NOT_IMPLEMENTED'); }
  update(workspaceId: string, id: string, input: UpdateRecurrenceRuleDto): never { void workspaceId; void id; void input; throw new NotImplementedException('NOT_IMPLEMENTED'); }
  stop(workspaceId: string, id: string): never { void workspaceId; void id; throw new NotImplementedException('NOT_IMPLEMENTED'); }
}
