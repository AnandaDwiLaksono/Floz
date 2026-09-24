'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useUnreadCount, useNotifications } from '../lib/hooks/use-notifications';
import { NotificationCenter } from './notification-center';
import { NotificationResource } from './notification-item';
import { notificationRoute } from '../lib/task-route';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { MobileNavigation } from './mobile-navigation';

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, activeWorkspace, workspaceResolving, setActiveWorkspace, logout, checkSession, authOutcome, loading } = useAuth();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [filterRead, setFilterRead] = useState<boolean | null>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const notificationTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const routeWorkspaceId = pathname.match(/^\/workspaces\/([^/]+)(?:\/|$)/)?.[1];
  const resolvedWorkspace = workspaceResolving || (routeWorkspaceId && activeWorkspace?.id !== routeWorkspaceId) ? null : activeWorkspace;
  const { unreadCount, setUnreadCount } = useUnreadCount(resolvedWorkspace?.id);
  const { notifications, loading: notificationsLoading, hasMore, error, loadMore, markRead, markAllRead, fetchNotifications } = useNotifications(resolvedWorkspace?.id, filterRead, setUnreadCount);
  const handleSelect = useCallback((notification: NotificationResource) => { markRead(notification.id); setNotificationsOpen(false); router.push(notificationRoute(resolvedWorkspace?.id ?? '', notification.entity_id ?? '', notification.context?.route, notification.type, notification.entity_type)); }, [markRead, resolvedWorkspace?.id, router]);
  useEffect(() => { if (!notificationsOpen) return; const outside = (event: MouseEvent) => { if (!notificationRef.current?.contains(event.target as Node)) { setNotificationsOpen(false); notificationTriggerRef.current?.focus(); } }; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNotificationsOpen(false); notificationTriggerRef.current?.focus(); } }; document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape); return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); }; }, [notificationsOpen]);
  const publicRoutes = ['/login', '/register', '/verify-email', '/join', '/invitations/accept', '/onboarding'];
  if (publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return <>{children}</>;
  if (loading) return <div className="grid min-h-dvh place-items-center bg-background text-foreground"><p role="status">Memuat Floz...</p></div>;
  return <div className="flex h-dvh overflow-hidden bg-background text-foreground">{(authOutcome === 'unknown' || authOutcome === 'failure') && <div role={authOutcome === 'failure' ? 'alert' : 'status'} className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-warning p-2 text-sm text-warning-foreground"><span>{authOutcome === 'unknown' ? 'Status sesi belum diketahui.' : 'Keluar gagal. Sesi tetap dipertahankan.'}</span><button type="button" onClick={() => void checkSession()} className="min-h-11 rounded border border-current px-2">Periksa sesi</button></div>}<AppSidebar workspace={resolvedWorkspace} workspaces={user?.workspaces ?? []} setActiveWorkspace={setActiveWorkspace} pathname={pathname} name={user?.full_name} email={user?.email} logout={() => void logout()} /><div className="flex min-w-0 flex-1 flex-col"><div className="relative" ref={notificationRef}><AppHeader workspace={resolvedWorkspace} unreadCount={unreadCount} menuButtonRef={menuTriggerRef} notificationButtonRef={notificationTriggerRef} onMenu={() => setMobileOpen(true)} onNotifications={() => { if (!notificationsOpen) void fetchNotifications(); setNotificationsOpen((value) => !value); }} notificationsOpen={notificationsOpen} />{notificationsOpen && <div className="absolute right-2 top-full z-30 mt-2 w-[min(24rem,calc(100vw-1rem))]"><NotificationCenter notifications={notifications} loading={notificationsLoading} hasMore={hasMore} unreadCount={unreadCount} onSelect={handleSelect} onMarkAllRead={markAllRead} onLoadMore={loadMore} filterRead={filterRead} onFilterReadChange={setFilterRead} error={error} onRetry={fetchNotifications} /></div>}</div><main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</main></div><MobileNavigation open={mobileOpen} onClose={() => { setMobileOpen(false); menuTriggerRef.current?.focus(); }} workspace={resolvedWorkspace} workspaces={user?.workspaces ?? []} setActiveWorkspace={setActiveWorkspace} pathname={pathname} logout={() => void logout()} /></div>;
}
