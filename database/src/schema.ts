import { relations, sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

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
}, (table) => ({ workspaceName: unique().on(table.workspaceId, table.name) }));

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
  startAt: timestamp('start_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: now(),
  updatedAt: updated(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => ({ workspaceTaskKey: unique().on(table.workspaceId, table.taskKey), workspaceStatus: index('tasks_workspace_status_idx').on(table.workspaceId, table.statusId), workspacePriority: index('tasks_workspace_priority_idx').on(table.workspaceId, table.priority) }));

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

export const userRelations = relations(users, ({ many }) => ({ sessions: many(sessions), memberships: many(workspaceMemberships) }));
export const workspaceRelations = relations(workspaces, ({ many }) => ({ memberships: many(workspaceMemberships), teams: many(teams) }));
export const roleCodes = ['ADMIN', 'MANAGER', 'MEMBER', 'FIELD_WORKER'] as const;
export type RoleCode = typeof roleCodes[number];
export const activeMembership = sql`${workspaceMemberships.status} = 'ACTIVE'`;
