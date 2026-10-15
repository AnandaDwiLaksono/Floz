'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

interface SettingsNavProps {
  workspaceId: string;
}

export function SettingsNav({ workspaceId }: SettingsNavProps) {
  const pathname = usePathname();
  const { activeWorkspace, workspaceResolving } = useAuth();
  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';
  const navRef = useRef<HTMLElement>(null);

  const navItems = [
    { href: `/workspaces/${workspaceId}/settings/profile`, label: 'Profil', ariaLabel: 'Profile' },
    ...(isAdmin
      ? [
          { href: `/workspaces/${workspaceId}/settings/workspace`, label: 'Ruang kerja', ariaLabel: 'Workspace' },
          { href: `/workspaces/${workspaceId}/settings/members`, label: 'Anggota', ariaLabel: 'Members' },
          { href: `/workspaces/${workspaceId}/settings/teams`, label: 'Tim', ariaLabel: 'Teams' },
          { href: `/workspaces/${workspaceId}/settings/workflows`, label: 'Alur kerja', ariaLabel: 'Workflows' },
          { href: `/workspaces/${workspaceId}/settings/join`, label: 'Bergabung', ariaLabel: 'Join' },
        ]
      : []),
  ];

  useEffect(() => {
    const container = navRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (activeEl) {
      const scrollPos = activeEl.offsetLeft - (container.clientWidth - activeEl.clientWidth) / 2;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ left: Math.max(0, scrollPos), behavior: 'auto' });
      }
    }
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Settings sections"
      className="flex w-full max-w-full items-center gap-1.5 border-b border-border pb-3 overflow-x-auto no-scrollbar px-1 touch-pan-x"
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <a
            key={item.href}
            href={item.href}
            aria-label={item.ariaLabel}
            aria-current={isActive ? 'page' : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors shrink-0 ${
              isActive
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
