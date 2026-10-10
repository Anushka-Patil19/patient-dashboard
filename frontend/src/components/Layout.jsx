import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLiveStatus } from '../hooks/useLiveUpdates.jsx';
import { ROLE_LABEL } from '../lib/format.js';
import ReLoginModal from './ReLoginModal.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', permission: 'analytics:read' },
  { to: '/encounters/new', label: 'New encounter', permission: 'encounter:create' },
  { to: '/encounters', label: 'Encounters', permission: 'encounter:read:own', end: true },
  { to: '/patients', label: 'Patients', permission: 'patient:read' },
  { to: '/audit', label: 'Audit log', permission: 'audit:read' },
  { to: '/users', label: 'Users', permission: 'user:manage' },
];

function LiveIndicator() {
  const status = useLiveStatus();
  const map = {
    live: ['bg-good', 'Live'],
    connecting: ['bg-line-strong', 'Connecting'],
    offline: ['bg-danger', 'Offline – retrying'],
  };
  const [dot, label] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title="Real-time updates">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = NAV.filter((n) => can(n.permission));

  const navLink = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
    }`;

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">
        Skip to content
      </a>
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:py-5">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <div className="leading-tight">
              <p className="text-sm font-semibold">Rural Outreach</p>
              <p className="text-xs text-muted">Patient dashboard</p>
            </div>
          </div>
          <button
            className="btn-ghost md:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            Menu
          </button>
        </div>
        <nav id="main-nav" className={`${menuOpen ? 'block' : 'hidden'} space-y-0.5 px-3 pb-3 md:block md:flex-1`}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={navLink} onClick={() => setMenuOpen(false)}>
              {l.to === '/encounters' && !can('encounter:read:any') ? 'My entries' : l.label}
            </NavLink>
          ))}
        </nav>
        <div className={`${menuOpen ? 'block' : 'hidden'} border-t border-line px-4 py-3 md:block`}>
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-muted">
            {ROLE_LABEL[user.role]}
            {user.facility ? ` · ${user.facility}` : ''}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <LiveIndicator />
            <button className="btn-ghost px-2 py-1 text-xs" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <ReLoginModal />
    </div>
  );
}
