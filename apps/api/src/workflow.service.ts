import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Sql, TransactionSql } from 'postgres';
import { lockWorkspaceForWorkflowDefaultTx, lockWorkflowsDeterministicTx, lockWorkflowAggregateTx, bumpWorkflowVersionTx } from '@floz/database';
import { AuthService } from './auth';
import type {
  ArchiveStatusDto,
  ArchiveWorkflowDto,
  CreateStatusDto,
  CreateWorkflowDto,
  ReorderStatusesDto,
  ReplaceTransitionsDto,
  RestoreStatusDto,
  RestoreWorkflowDto,
  SetStatusInitialDto,
  SetWorkflowDefaultDto,
  UpdateStatusDto,
  UpdateWorkflowDto
} from './workflow.dto';

type RootSql = Sql;
type SqlClient = Sql | TransactionSql;

const codePattern = /^[A-Z0-9_]{2,64}$/;
const statusCodePattern = /^[A-Z0-9_]{2,32}$/;
const validCategories = new Set(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkflowService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql(): RootSql {
    return this.authService.database.sql;
  }

  private validateUuid(id: string) {
    if (!uuidPattern.test(id)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
  }

  private validateVersion(version: number | undefined) {
    if (version === undefined || !Number.isInteger(version) || version <= 0) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
  }

  private async lockWorkflowAggregate(tx: TransactionSql, workspaceId: string, workflowId: string, expectedVersion: number) {
    try {
      return await lockWorkflowAggregateTx(tx, workspaceId, workflowId, expectedVersion);
    } catch (err: any) {
      if (err?.message === 'NOT_FOUND') {
        throw new NotFoundException('NOT_FOUND');
      }
      if (err?.message === 'VERSION_CONFLICT') {
        throw new ConflictException('VERSION_CONFLICT');
      }
      throw err;
    }
  }

  private async bumpWorkflowVersion(tx: TransactionSql, workflowId: string, expectedVersion: number) {
    try {
      return await bumpWorkflowVersionTx(tx, workflowId, expectedVersion);
    } catch (err: any) {
      if (err?.message === 'VERSION_CONFLICT') {
        throw new ConflictException('VERSION_CONFLICT');
      }
      throw err;
    }
  }

  async list(workspaceId: string) {
    this.validateUuid(workspaceId);
    const workflows = await this.sql`
      SELECT
        w.id,
        w.workspace_id,
        w.team_id,
        w.code,
        w.name,
        w.description,
        w.is_default,
        w.is_active,
        w.version,
        w.created_at,
        w.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'code', s.code,
              'name', s.name,
              'category', s.category,
              'position', s.position,
              'is_initial', s.is_initial,
              'is_terminal', s.is_terminal,
              'is_active', s.is_active
            ) ORDER BY s.position ASC, s.id ASC
          ) FILTER (WHERE s.id IS NOT NULL AND s.is_active = true),
          '[]'
        ) AS statuses
      FROM workflows w
      LEFT JOIN task_statuses s ON s.workflow_id = w.id
      WHERE w.workspace_id = ${workspaceId} AND w.is_active = true
      GROUP BY w.id
      ORDER BY w.is_default DESC, w.name ASC
    `;
    return workflows;
  }

  async detail(workspaceId: string, workflowId: string) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);

    const workflow = (
      await this.sql`
        SELECT id, workspace_id, team_id, code, name, description, is_default, is_active, version, created_at, updated_at
        FROM workflows
        WHERE id = ${workflowId} AND workspace_id = ${workspaceId}
      `
    )[0];

    if (!workflow) {
      throw new NotFoundException('NOT_FOUND');
    }

    const statuses = await this.sql`
      SELECT id, code, name, category, position, is_initial, is_terminal, is_active
      FROM task_statuses
      WHERE workflow_id = ${workflowId}
      ORDER BY position ASC, id ASC
    `;

    const transitions = await this.sql`
      SELECT wt.from_status_id, wt.to_status_id, wt.requires_permission
      FROM workflow_transitions wt
      JOIN task_statuses s_from ON s_from.id = wt.from_status_id
      JOIN task_statuses s_to ON s_to.id = wt.to_status_id
      WHERE wt.workflow_id = ${workflowId}
      ORDER BY s_from.position ASC, s_to.position ASC
    `;

    return {
      ...workflow,
      statuses,
      transitions
    };
  }

  async create(workspaceId: string, actorId: string, input: CreateWorkflowDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(actorId);
    if ((input as any).is_default !== undefined || (input as any).code === undefined || !input.name?.trim()) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const rawCode = String(input.code).trim().toUpperCase();
    if (!codePattern.test(rawCode)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const name = input.name.trim();
    if (name.length > 255) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    if (!Array.isArray(input.statuses) || input.statuses.length === 0 || !Array.isArray(input.transitions)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    return this.sql.begin(async (tx: TransactionSql) => {
      // 1. Team validation if team_id provided
      if (input.team_id) {
        this.validateUuid(input.team_id);
        const team = (
          await tx<{ id: string; is_active: boolean }[]>`
            SELECT id, is_active FROM teams WHERE id = ${input.team_id} AND workspace_id = ${workspaceId}
          `
        )[0];
        if (!team) {
          throw new UnprocessableEntityException('CROSS_WORKSPACE_REFERENCE');
        }
        if (!team.is_active) {
          throw new ConflictException('TEAM_ARCHIVED');
        }
      }

      // 2. Validate workspace code and name uniqueness
      const existingCode = (
        await tx`SELECT id FROM workflows WHERE workspace_id = ${workspaceId} AND UPPER(code) = ${rawCode}`
      )[0];
      if (existingCode) {
        throw new ConflictException('DUPLICATE_WORKFLOW_CODE');
      }

      const existingName = (
        await tx`SELECT id FROM workflows WHERE workspace_id = ${workspaceId} AND LOWER(name) = ${name.toLowerCase()}`
      )[0];
      if (existingName) {
        throw new ConflictException('DUPLICATE_WORKFLOW_NAME');
      }

      // 3. Validate statuses
      let initialCount = 0;
      let terminalCount = 0;
      const statusCodeMap = new Map<string, string>(); // code -> name
      const statusNamesLower = new Set<string>();

      for (const s of input.statuses) {
        if (!s.name?.trim() || !s.code?.trim() || !validCategories.has(s.category)) {
          throw new BadRequestException('VALIDATION_ERROR');
        }
        const sCode = s.code.trim().toUpperCase();
        if (!statusCodePattern.test(sCode)) {
          throw new BadRequestException('VALIDATION_ERROR');
        }
        if (statusCodeMap.has(sCode)) {
          throw new ConflictException('DUPLICATE_STATUS_CODE');
        }
        statusCodeMap.set(sCode, s.name.trim());

        const sNameLower = s.name.trim().toLowerCase();
        if (statusNamesLower.has(sNameLower)) {
          throw new ConflictException('DUPLICATE_STATUS_NAME');
        }
        statusNamesLower.add(sNameLower);

        if (s.is_initial) {
          initialCount++;
          if (s.category === 'DONE' || s.category === 'CANCELLED') {
            throw new BadRequestException('VALIDATION_ERROR');
          }
        }
        if (s.category === 'DONE' || s.category === 'CANCELLED') {
          terminalCount++;
        }
      }

      if (initialCount !== 1) {
        throw new BadRequestException('VALIDATION_ERROR');
      }
      if (terminalCount < 1) {
        throw new BadRequestException('VALIDATION_ERROR');
      }

      // 4. Validate transitions
      const transitionPairs = new Set<string>();
      for (const tr of input.transitions) {
        const fromCode = String(tr.from_status_code).trim().toUpperCase();
        const toCode = String(tr.to_status_code).trim().toUpperCase();
        if (!statusCodeMap.has(fromCode) || !statusCodeMap.has(toCode)) {
          throw new BadRequestException('VALIDATION_ERROR');
        }
        if (fromCode === toCode) {
          throw new UnprocessableEntityException('SELF_LOOP_NOT_ALLOWED');
        }
        transitionPairs.add(`${fromCode}->${toCode}`);
      }

      // 5. Insert workflow row
      const [wf] = await tx<{ id: string }[]>`
        INSERT INTO workflows (workspace_id, team_id, code, name, description, is_default, is_active, version, created_by)
        VALUES (${workspaceId}, ${input.team_id ?? null}, ${rawCode}, ${name}, ${input.description?.trim() ?? null}, false, true, 1, ${actorId})
        RETURNING id
      `;

      // 6. Insert task_statuses rows
      const statusIdMap = new Map<string, string>(); // code -> status_id
      let pos = 1;
      for (const s of input.statuses) {
        const sCode = s.code.trim().toUpperCase();
        const isTerminal = s.category === 'DONE' || s.category === 'CANCELLED';
        const [st] = await tx<{ id: string }[]>`
          INSERT INTO task_statuses (workflow_id, code, name, category, position, is_initial, is_terminal, is_active)
          VALUES (${wf.id}, ${sCode}, ${s.name.trim()}, ${s.category}, ${pos++}, ${s.is_initial}, ${isTerminal}, true)
          RETURNING id
        `;
        statusIdMap.set(sCode, st.id);
      }

      // 7. Insert workflow_transitions rows
      for (const pair of transitionPairs) {
        const [fromCode, toCode] = pair.split('->');
        const fromId = statusIdMap.get(fromCode)!;
        const toId = statusIdMap.get(toCode)!;
        await tx`
          INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id, requires_permission)
          VALUES (${wf.id}, ${fromId}, ${toId}, false)
        `;
      }

      return this.detailSql(tx, workspaceId, wf.id);
    });
  }

  async update(workspaceId: string, workflowId: string, input: UpdateWorkflowDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    if (
      (input as any).code !== undefined ||
      (input as any).is_default !== undefined ||
      (input as any).team_id !== undefined
    ) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 255)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);

      if (input.name !== undefined) {
        const name = input.name.trim();
        const existingName = (
          await tx`SELECT id FROM workflows WHERE workspace_id = ${workspaceId} AND LOWER(name) = ${name.toLowerCase()} AND id <> ${workflowId}`
        )[0];
        if (existingName) {
          throw new ConflictException('DUPLICATE_WORKFLOW_NAME');
        }
      }

      const newName = input.name !== undefined ? input.name.trim() : locked.workflow.name;
      const newDesc = input.description !== undefined ? input.description?.trim() ?? null : locked.workflow.description;

      await tx`
        UPDATE workflows
        SET name = ${newName}, description = ${newDesc}, version = version + 1, updated_at = NOW()
        WHERE id = ${workflowId}
      `;

      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  // --- Task 4 Lifecycle Methods ---

  async setDefault(workspaceId: string, workflowId: string, input: SetWorkflowDefaultDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      await lockWorkspaceForWorkflowDefaultTx(tx, workspaceId);

      const targetWf = (
        await tx<{ id: string; workspace_id: string; team_id: string | null; is_default: boolean; is_active: boolean; version: number }[]>`
          SELECT id, workspace_id, team_id, is_default, is_active, version
          FROM workflows
          WHERE id = ${workflowId} AND workspace_id = ${workspaceId}
        `
      )[0];

      if (!targetWf || !targetWf.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      // Check deterministic 200 no-op vs stale version
      if (targetWf.is_default) {
        if (targetWf.version === input.version) {
          return this.detailSql(tx, workspaceId, workflowId);
        }
        throw new ConflictException('VERSION_CONFLICT');
      }

      if (targetWf.version !== input.version) {
        throw new ConflictException('VERSION_CONFLICT');
      }

      // Find current default in same scope
      const currentDefault = (
        await tx<{ id: string; version: number }[]>`
          SELECT id, version
          FROM workflows
          WHERE workspace_id = ${workspaceId}
            AND ${targetWf.team_id ? tx`team_id = ${targetWf.team_id}` : tx`team_id IS NULL`}
            AND is_default = true
            AND is_active = true
        `
      )[0];

      const idsToLock = currentDefault ? [targetWf.id, currentDefault.id] : [targetWf.id];
      await lockWorkflowsDeterministicTx(tx, workspaceId, idsToLock);

      if (currentDefault) {
        await tx`UPDATE workflows SET is_default = false, version = version + 1, updated_at = NOW() WHERE id = ${currentDefault.id}`;
      }

      await tx`UPDATE workflows SET is_default = true, version = version + 1, updated_at = NOW() WHERE id = ${workflowId}`;

      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async archive(workspaceId: string, workflowId: string, input: ArchiveWorkflowDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      if (locked.workflow.team_id === null && locked.workflow.is_default) {
        throw new ConflictException('CANNOT_ARCHIVE_DEFAULT_WORKFLOW');
      }

      // Recurrence rule guard
      const recurrenceDeps = await tx<{ id: string }[]>`
        SELECT id FROM recurrence_rules
        WHERE workspace_id = ${workspaceId} AND is_active = true AND template_snapshot->>'workflow_id' = ${workflowId}
      `;
      if (recurrenceDeps.length > 0) {
        throw new ConflictException('RECURRENCE_DEPENDENCY_CONFLICT');
      }

      await tx`
        UPDATE workflows
        SET is_active = false, is_default = false, version = version + 1, updated_at = NOW()
        WHERE id = ${workflowId}
      `;

      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async restore(workspaceId: string, workflowId: string, input: RestoreWorkflowDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      await tx`
        UPDATE workflows
        SET is_active = true, is_default = false, version = version + 1, updated_at = NOW()
        WHERE id = ${workflowId}
      `;

      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  // --- Task 5 Status Lifecycle Methods ---

  async addStatus(workspaceId: string, workflowId: string, input: CreateStatusDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    if (!input.name?.trim() || !input.code?.trim() || !validCategories.has(input.category)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const sCode = input.code.trim().toUpperCase();
    if (!statusCodePattern.test(sCode)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const name = input.name.trim();

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      // Check code & name duplicates
      const dupCode = (
        await tx`SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND UPPER(code) = ${sCode}`
      )[0];
      if (dupCode) {
        throw new ConflictException('DUPLICATE_STATUS_CODE');
      }

      const dupName = (
        await tx`SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND LOWER(name) = ${name.toLowerCase()}`
      )[0];
      if (dupName) {
        throw new ConflictException('DUPLICATE_STATUS_NAME');
      }

      const activeStatuses = locked.statuses.filter((s) => s.is_active);
      const nextPos = activeStatuses.length + 1;
      const isTerminal = input.category === 'DONE' || input.category === 'CANCELLED';

      await tx`
        INSERT INTO task_statuses (workflow_id, code, name, category, position, is_initial, is_terminal, is_active)
        VALUES (${workflowId}, ${sCode}, ${name}, ${input.category}, ${nextPos}, false, ${isTerminal}, true)
      `;

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async updateStatus(workspaceId: string, workflowId: string, statusId: string, input: UpdateStatusDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateUuid(statusId);
    this.validateVersion(input.version);

    if ((input as any).code !== undefined) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    if (input.category !== undefined && !validCategories.has(input.category)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const status = locked.statuses.find((s) => s.id === statusId);
      if (!status) {
        throw new NotFoundException('NOT_FOUND');
      }

      if (input.name !== undefined) {
        const name = input.name.trim();
        const dupName = (
          await tx`SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND LOWER(name) = ${name.toLowerCase()} AND id <> ${statusId}`
        )[0];
        if (dupName) {
          throw new ConflictException('DUPLICATE_STATUS_NAME');
        }
      }

      // Check category change guards
      if (input.category !== undefined && input.category !== status.category) {
        const activeTasks = (
          await tx<{ count: number }[]>`SELECT COUNT(*)::int as count FROM tasks WHERE status_id = ${statusId} AND deleted_at IS NULL`
        )[0].count;
        if (activeTasks > 0) {
          throw new ConflictException('STATUS_CATEGORY_IN_USE');
        }

        const recurrenceRules = (
          await tx<{ count: number }[]>`
            SELECT COUNT(*)::int as count FROM recurrence_rules
            WHERE workspace_id = ${workspaceId} AND is_active = true AND template_snapshot->>'status_id' = ${statusId}
          `
        )[0].count;
        if (recurrenceRules > 0) {
          throw new ConflictException('STATUS_CATEGORY_IN_USE');
        }
      }

      const newName = input.name !== undefined ? input.name.trim() : status.name;
      const newCat = input.category !== undefined ? input.category : status.category;
      const isTerminal = newCat === 'DONE' || newCat === 'CANCELLED';

      await tx`
        UPDATE task_statuses
        SET name = ${newName}, category = ${newCat}, is_terminal = ${isTerminal}
        WHERE id = ${statusId}
      `;

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async setInitialStatus(workspaceId: string, workflowId: string, statusId: string, input: SetStatusInitialDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateUuid(statusId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const targetStatus = locked.statuses.find((s) => s.id === statusId);
      if (!targetStatus || !targetStatus.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      if (targetStatus.category === 'DONE' || targetStatus.category === 'CANCELLED') {
        throw new BadRequestException('VALIDATION_ERROR');
      }

      // Check no-op
      if (targetStatus.is_initial) {
        return this.detailSql(tx, workspaceId, workflowId);
      }

      await tx`UPDATE task_statuses SET is_initial = false WHERE workflow_id = ${workflowId} AND is_initial = true`;
      await tx`UPDATE task_statuses SET is_initial = true WHERE id = ${statusId}`;

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async archiveStatus(workspaceId: string, workflowId: string, statusId: string, input: ArchiveStatusDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateUuid(statusId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const targetStatus = locked.statuses.find((s) => s.id === statusId);
      if (!targetStatus || !targetStatus.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      if (targetStatus.is_initial) {
        throw new ConflictException('CANNOT_ARCHIVE_INITIAL_STATUS');
      }

      // Check active recurrence rule dependency
      const recurrenceRules = (
        await tx<{ count: number }[]>`
          SELECT COUNT(*)::int as count FROM recurrence_rules
          WHERE workspace_id = ${workspaceId} AND is_active = true AND template_snapshot->>'status_id' = ${statusId}
        `
      )[0].count;
      if (recurrenceRules > 0) {
        throw new ConflictException('RECURRENCE_DEPENDENCY_CONFLICT');
      }

      // Archive status
      await tx`UPDATE task_statuses SET is_active = false, position = 9999 WHERE id = ${statusId}`;

      // Compact remaining active statuses to contiguous 1..N
      const remainingActive = (
        await tx<{ id: string }[]>`
          SELECT id FROM task_statuses
          WHERE workflow_id = ${workflowId} AND is_active = true
          ORDER BY position ASC, id ASC
        `
      );

      for (let i = 0; i < remainingActive.length; i++) {
        await tx`UPDATE task_statuses SET position = ${i + 1} WHERE id = ${remainingActive[i].id}`;
      }

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async restoreStatus(workspaceId: string, workflowId: string, statusId: string, input: RestoreStatusDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateUuid(statusId);
    this.validateVersion(input.version);

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const targetStatus = locked.statuses.find((s) => s.id === statusId);
      if (!targetStatus || targetStatus.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const activeCount = locked.statuses.filter((s) => s.is_active).length;
      await tx`UPDATE task_statuses SET is_active = true, position = ${activeCount + 1} WHERE id = ${statusId}`;

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async reorderStatuses(workspaceId: string, workflowId: string, input: ReorderStatusesDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    if (!Array.isArray(input.status_ids) || input.status_ids.length === 0) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const activeStatuses = locked.statuses.filter((s) => s.is_active);
      const activeIdsSet = new Set(activeStatuses.map((s) => s.id));

      if (
        input.status_ids.length !== activeStatuses.length ||
        new Set(input.status_ids).size !== input.status_ids.length ||
        !input.status_ids.every((id) => activeIdsSet.has(id))
      ) {
        throw new BadRequestException('VALIDATION_ERROR');
      }

      for (let i = 0; i < input.status_ids.length; i++) {
        await tx`UPDATE task_statuses SET position = ${i + 1} WHERE id = ${input.status_ids[i]}`;
      }

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  async replaceTransitions(workspaceId: string, workflowId: string, input: ReplaceTransitionsDto) {
    this.validateUuid(workspaceId);
    this.validateUuid(workflowId);
    this.validateVersion(input.version);

    if (!Array.isArray(input.transitions)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    return this.sql.begin(async (tx: TransactionSql) => {
      const locked = await this.lockWorkflowAggregate(tx, workspaceId, workflowId, input.version);
      if (!locked.workflow.is_active) {
        throw new NotFoundException('NOT_FOUND');
      }

      const statusMap = new Map(locked.statuses.map((s) => [s.id, s]));

      // Validate transitions
      for (const tr of input.transitions) {
        const fromStatus = statusMap.get(tr.from_status_id);
        const toStatus = statusMap.get(tr.to_status_id);

        if (!fromStatus || !toStatus) {
          throw new BadRequestException('VALIDATION_ERROR');
        }

        if (tr.from_status_id === tr.to_status_id) {
          throw new UnprocessableEntityException('SELF_LOOP_NOT_ALLOWED');
        }

        if (!toStatus.is_active) {
          throw new UnprocessableEntityException('INACTIVE_TRANSITION_TARGET');
        }
      }

      // Existing transitions
      const existingTransitions = await tx<{ from_status_id: string; to_status_id: string; requires_permission: boolean }[]>`
        SELECT from_status_id, to_status_id, requires_permission FROM workflow_transitions WHERE workflow_id = ${workflowId}
      `;

      const existingMap = new Map(
        existingTransitions.map((tr) => [`${tr.from_status_id}->${tr.to_status_id}`, tr.requires_permission])
      );

      // Delete only edges whose target status is active
      await tx`
        DELETE FROM workflow_transitions
        WHERE workflow_id = ${workflowId}
          AND to_status_id IN (SELECT id FROM task_statuses WHERE workflow_id = ${workflowId} AND is_active = true)
      `;

      // Insert new active-target transitions, preserving requires_permission if present in existingMap
      const submittedPairs = new Set<string>();
      for (const tr of input.transitions) {
        const pairKey = `${tr.from_status_id}->${tr.to_status_id}`;
        if (submittedPairs.has(pairKey)) {
          continue; // skip duplicate pairs in submission
        }
        submittedPairs.add(pairKey);

        const existingPerm = existingMap.get(pairKey);
        const requiresPermission = tr.requires_permission !== undefined ? tr.requires_permission : existingPerm ?? false;

        await tx`
          INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id, requires_permission)
          VALUES (${workflowId}, ${tr.from_status_id}, ${tr.to_status_id}, ${requiresPermission})
        `;
      }

      await this.bumpWorkflowVersion(tx, workflowId, input.version);
      return this.detailSql(tx, workspaceId, workflowId);
    });
  }

  private async detailSql(sql: SqlClient, workspaceId: string, workflowId: string) {
    const workflow = (
      await sql`
        SELECT id, workspace_id, team_id, code, name, description, is_default, is_active, version, created_at, updated_at
        FROM workflows
        WHERE id = ${workflowId} AND workspace_id = ${workspaceId}
      `
    )[0];

    if (!workflow) {
      throw new NotFoundException('NOT_FOUND');
    }

    const statuses = await sql`
      SELECT id, code, name, category, position, is_initial, is_terminal, is_active
      FROM task_statuses
      WHERE workflow_id = ${workflowId}
      ORDER BY position ASC, id ASC
    `;

    const transitions = await sql`
      SELECT wt.from_status_id, wt.to_status_id, wt.requires_permission
      FROM workflow_transitions wt
      JOIN task_statuses s_from ON s_from.id = wt.from_status_id
      JOIN task_statuses s_to ON s_to.id = wt.to_status_id
      WHERE wt.workflow_id = ${workflowId}
      ORDER BY s_from.position ASC, s_to.position ASC
    `;

    return {
      ...workflow,
      statuses,
      transitions
    };
  }
}
