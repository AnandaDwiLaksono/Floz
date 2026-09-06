import { relations, sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: varchar('name', { length: 255 }).notNull(),
  image: text('image'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Jakarta'),
  locale: varchar('locale', { length: 16 }).notNull().default('id-ID'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updated()
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  issuer: varchar('issuer', { length: 255 }).notNull(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  password: text('password_hash'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({ accountIdentity: unique().on(table.issuer, table.accountId) }));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: now(),
  updatedAt: updated()
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: varchar('identifier', { length: 320 }).notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: now(),
  updatedAt: updated()
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  createdAt: now()
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Jakarta'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: now(),
  updatedAt: updated()
});

export const workspaceMemberships = pgTable('workspace_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({ workspaceUser: unique().on(table.workspaceId, table.userId) }));

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  managerUserId: uuid('manager_user_id').references(() => users.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({ workspaceName: unique().on(table.workspaceId, table.name), workspaceManager: index('teams_workspace_manager_idx').on(table.workspaceId, table.managerUserId) }));

export const teamMemberships = pgTable('team_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  membershipRole: varchar('membership_role', { length: 32 }).default('MEMBER'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  createdAt: now()
}, (table) => ({ teamUser: unique().on(table.teamId, table.userId) }));

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  teamId: uuid('team_id').references(() => teams.id),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({ workspaceName: unique().on(table.workspaceId, table.name), workspaceCode: unique().on(table.workspaceId, table.code) }));

export const taskStatuses = pgTable('task_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  position: integer('position').notNull(),
  isInitial: boolean('is_initial').notNull().default(false),
  isTerminal: boolean('is_terminal').notNull().default(false),
  createdAt: now()
}, (table) => ({ workflowCode: unique().on(table.workflowId, table.code) }));

export const workflowTransitions = pgTable('workflow_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
  fromStatusId: uuid('from_status_id').notNull().references(() => taskStatuses.id),
  toStatusId: uuid('to_status_id').notNull().references(() => taskStatuses.id),
  requiresPermission: boolean('requires_permission').notNull().default(false),
  createdAt: now()
}, (table) => ({ transition: unique().on(table.workflowId, table.fromStatusId, table.toStatusId) }));

export const recurrenceRules = pgTable('recurrence_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  frequency: varchar('frequency', { length: 16 }).notNull(),
  intervalValue: integer('interval_value').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  occurrenceLimit: integer('occurrence_limit'),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  anchorDay: integer('anchor_day'),
  generatedCount: integer('generated_count').notNull().default(0),
  ruleConfig: jsonb('rule_config').notNull().default({}),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  frequencyCheck: check('recurrence_rules_frequency_check', sql`${table.frequency} IN ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM')`),
  intervalValueCheck: check('recurrence_rules_interval_value_check', sql`${table.intervalValue} > 0`),
  occurrenceLimitCheck: check('recurrence_rules_occurrence_limit_check', sql`${table.occurrenceLimit} IS NULL OR ${table.occurrenceLimit} > 0`),
  anchorDayCheck: check('recurrence_rules_anchor_day_check', sql`${table.anchorDay} IS NULL OR ${table.anchorDay} BETWEEN 1 AND 31`),
  generatedCountCheck: check('recurrence_rules_generated_count_check', sql`${table.generatedCount} >= 0`),
  endOrLimitCheck: check('recurrence_rules_end_or_limit_check', sql`NOT (${table.endAt} IS NOT NULL AND ${table.occurrenceLimit} IS NOT NULL)`),
  dueScan: index('recurrence_rules_due_scan_idx').on(table.workspaceId, table.nextRunAt).where(sql`${table.isActive} = true`)
}));

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskKey: varchar('task_key', { length: 64 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
  statusId: uuid('status_id').notNull().references(() => taskStatuses.id),
  priority: varchar('priority', { length: 16 }).notNull().default('MEDIUM'),
  teamId: uuid('team_id').references(() => teams.id),
  creatorId: uuid('creator_id').notNull().references(() => users.id),
  recurrenceRuleId: uuid('recurrence_rule_id').references(() => recurrenceRules.id),
  startAt: timestamp('start_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  dueVersion: integer('due_version').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: now(),
  updatedAt: updated(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => ({ workspaceTaskKey: unique().on(table.workspaceId, table.taskKey), workspaceStatus: index('tasks_workspace_status_idx').on(table.workspaceId, table.statusId), workspacePriority: index('tasks_workspace_priority_idx').on(table.workspaceId, table.priority) }));

export const recurrenceOccurrences = pgTable('recurrence_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  recurrenceRuleId: uuid('recurrence_rule_id').notNull().references(() => recurrenceRules.id),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  createdAt: now()
}, (table) => ({ recurrenceRuleScheduledFor: unique().on(table.recurrenceRuleId, table.scheduledFor), task: unique().on(table.taskId) }));

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  claimedBy: varchar('claimed_by', { length: 255 }),
  claimedUntil: timestamp('claimed_until', { withTimezone: true }),
  createdAt: now(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true })
}, (table) => ({
  statusCheck: check('outbox_events_status_check', sql`${table.status} IN ('PENDING', 'DISPATCHED', 'FAILED')`),
  attemptCountCheck: check('outbox_events_attempt_count_check', sql`${table.attemptCount} >= 0`),
  statusAvailable: index('outbox_events_status_available_idx').on(table.status, table.availableAt)
}));

export const recurrenceIdempotencyKeys = pgTable('recurrence_idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  idempotencyKey: text('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  recurrenceRuleId: uuid('recurrence_rule_id').references(() => recurrenceRules.id),
  firstOccurrenceTaskId: uuid('first_occurrence_task_id').references(() => tasks.id),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({ workspaceKey: unique().on(table.workspaceId, table.idempotencyKey) }));

export const taskAssignees = pgTable('task_assignees', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  isPrimary: boolean('is_primary').notNull().default(false),
  assignedBy: uuid('assigned_by').notNull().references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({ taskUser: unique().on(table.taskId, table.userId), onePrimary: uniqueIndex('task_assignees_one_primary_idx').on(table.taskId).where(sql`${table.isPrimary} = true`) }));

export const taskHistory = pgTable('task_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  fromStatusId: uuid('from_status_id').references(() => taskStatuses.id),
  toStatusId: uuid('to_status_id').references(() => taskStatuses.id),
  metadata: jsonb('metadata'),
  createdAt: now()
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  entityType: varchar('entity_type', { length: 50 }).default('TASK'),
  entityId: uuid('entity_id'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: now()
}, (table) => ({
  userReadCreated: index('idx_notifications_user_read_created').on(table.userId, table.isRead, table.createdAt),
  wsUserReadCreatedId: index('idx_notifications_ws_user_read_created_id').on(table.workspaceId, table.userId, table.isRead, table.createdAt, table.id)
}));

export const notificationDedupLedger = pgTable('notification_dedup_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  dedupKey: varchar('dedup_key', { length: 255 }).notNull(),
  notificationId: uuid('notification_id'),
  createdAt: now()
}, (table) => ({
  wsKey: uniqueIndex('idx_notification_dedup_ws_key').on(table.workspaceId, table.dedupKey)
}));

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  notificationType: varchar('notification_type', { length: 50 }).notNull(),
  inAppEnabled: boolean('in_app_enabled').notNull().default(true),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  pushEnabled: boolean('push_enabled').notNull().default(false),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  userWsType: uniqueIndex('idx_notification_pref_user_ws_type').on(table.userId, table.workspaceId, table.notificationType)
}));

export const userRelations = relations(users, ({ many }) => ({ sessions: many(sessions), memberships: many(workspaceMemberships) }));
export const workspaceRelations = relations(workspaces, ({ many }) => ({ memberships: many(workspaceMemberships), teams: many(teams) }));

export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').references(() => tasks.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  cancelReason: text('cancel_reason'),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  wsStatusSubmittedId: index('approval_requests_ws_status_submitted_id_idx').on(table.workspaceId, table.status, table.submittedAt, table.id),
  wsRequesterStatusSubmittedId: index('approval_requests_ws_requester_status_submitted_id_idx').on(table.workspaceId, table.requesterId, table.status, table.submittedAt, table.id),
  wsTask: index('approval_requests_ws_task_idx').on(table.workspaceId, table.taskId)
}));

export const approvalSteps = pgTable('approval_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  approvalRequestId: uuid('approval_request_id').notNull().references(() => approvalRequests.id),
  stepOrder: integer('step_order').notNull().default(1),
  approverUserId: uuid('approver_user_id').notNull().references(() => users.id),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  decision: varchar('decision', { length: 32 }),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  reqStepOrder: unique().on(table.approvalRequestId, table.stepOrder),
  wsApproverStatusCreated: index('approval_steps_ws_approver_status_created_idx').on(table.workspaceId, table.approverUserId, table.status, table.createdAt)
}));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  authorId: uuid('author_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  createdAt: now(),
  updatedAt: updated(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => ({
  wsTaskCreatedId: index('comments_ws_task_created_id_idx').on(table.workspaceId, table.taskId, table.createdAt, table.id)
}));

export const mentions = pgTable('mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  commentId: uuid('comment_id').notNull().references(() => comments.id),
  mentionedUserId: uuid('mentioned_user_id').notNull().references(() => users.id),
  createdAt: now()
}, (table) => ({
  commentUser: unique().on(table.commentId, table.mentionedUserId),
  wsMentionedUserCreated: index('mentions_ws_user_created_idx').on(table.workspaceId, table.mentionedUserId, table.createdAt)
}));

export const roleCodes = ['ADMIN', 'MANAGER', 'MEMBER', 'FIELD_WORKER'] as const;
export type RoleCode = typeof roleCodes[number];
export const activeMembership = sql`${workspaceMemberships.status} = 'ACTIVE'`;
