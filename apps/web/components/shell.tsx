'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import {
  CheckSquare,
  Building,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Layers,
  Calendar,
  Bell,
} from 'lucide-react';
import { NotificationCenter } from './notification-center';
import { NotificationResource } from './notification-item';

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, activeWorkspace, setActiveWorkspace, logout, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const pathname = usePathname();

  // ponytail: Mock state for UI placement, API integration pending
  const unreadCount = 3; 
  const mockNotifications: NotificationResource[] = [
    { id: '1', type: 'TASK_ASSIGNED', title: 'Task assigned', body: 'You were assigned to Setup DB', entity_type: 'task', entity_id: '1', is_read: false, read_at: null, created_at: new Date().toISOString() }
  ];

  // ponytail: handle escape to close notification center
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && notificationCenterOpen) {
        setNotificationCenterOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [notificationCenterOpen]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm font-medium text-gray-500">Loading Floz...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white font-bold">
              F
            </div>
            <span className="text-lg font-bold tracking-tight">Floz</span>
          </div>
        </div>

        {/* Workspace Switcher */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 relative">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Workspace
          </label>
          <button
            onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
            className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition"
          >
            <div className="flex items-center space-x-2 truncate">
              <Building className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <span className="truncate">{activeWorkspace?.name || 'Select Workspace'}</span>
            </div>
            <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
          </button>

          {wsDropdownOpen && (
            <div className="absolute left-4 right-4 top-16 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1">
              {user?.workspaces?.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspace(ws);
                    setWsDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between w-full px-4 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    ws.id === activeWorkspace?.id ? 'font-bold text-blue-600' : ''
                  }`}
                >
                  <span className="truncate">{ws.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {ws.role}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {activeWorkspace && (
            <>
              <Link href={`/workspaces/${activeWorkspace.id}/tasks`} className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition ${pathname.includes('/tasks') ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <CheckSquare className="h-5 w-5" />
                <span>Tasks</span>
              </Link>
              <Link href={`/workspaces/${activeWorkspace.id}/kanban`} className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition ${pathname.includes('/kanban') ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <Layers className="h-5 w-5" />
                <span>Kanban</span>
              </Link>
              <Link href={`/workspaces/${activeWorkspace.id}/calendar`} className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition ${pathname.includes('/calendar') ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <Calendar className="h-5 w-5" />
                <span>Calendar</span>
              </Link>
            </>
          )}
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center space-x-3 truncate">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs flex-shrink-0">
              {user?.full_name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="truncate">
              <p className="text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            title="Log out"
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header Bar */}
        <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center space-x-4">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
            >
              <Menu className="h-6 w-6" />
            </button>
            <h1 className="text-lg font-semibold tracking-tight">
              {activeWorkspace ? activeWorkspace.name : 'Floz Work Management'}
            </h1>
          </div>

          <div className="flex items-center space-x-3">
            {activeWorkspace && (
              <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Role: {activeWorkspace.role}
              </span>
            )}

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setNotificationCenterOpen(!notificationCenterOpen)}
                aria-label={`Notifications, ${unreadCount} unread`}
                className="relative p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notificationCenterOpen && (
                <div className="absolute right-0 mt-2 z-50">
                  <NotificationCenter
                    notifications={mockNotifications}
                    loading={false}
                    hasMore={false}
                    unreadCount={unreadCount}
                    onSelect={() => {}}
                    onMarkAllRead={() => {}}
                    onLoadMore={() => {}}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative flex flex-col w-4/5 max-w-sm bg-white dark:bg-gray-900 p-4 space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <span className="font-bold text-lg">Floz Menu</span>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X className="h-6 w-6 text-gray-500" />
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase">Workspaces</p>
                {user?.workspaces?.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setActiveWorkspace(ws);
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm rounded ${
                      ws.id === activeWorkspace?.id ? 'bg-blue-50 text-blue-600 font-bold' : ''
                    }`}
                  >
                    {ws.name} ({ws.role})
                  </button>
                ))}
              </div>
              {activeWorkspace && (
                <div className="pt-4 border-t space-y-2">
                  <Link
                    href={`/workspaces/${activeWorkspace.id}/tasks`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center space-x-2 px-3 py-2 font-medium rounded"
                  >
                    <CheckSquare className="h-5 w-5" />
                    <span>Tasks</span>
                  </Link>
                  <Link
                    href={`/workspaces/${activeWorkspace.id}/calendar`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center space-x-2 px-3 py-2 font-medium rounded"
                  >
                    <Calendar className="h-5 w-5" />
                    <span>Calendar</span>
                  </Link>
                </div>
              )}
              <div className="pt-auto mt-auto border-t pt-4">
                <button
                  onClick={() => logout()}
                  className="flex items-center space-x-2 text-red-600 font-medium px-3 py-2 w-full text-left"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
