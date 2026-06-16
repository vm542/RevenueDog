import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useApi } from '../api.ts';

const NAV = [
  { to: '/', label: 'Overview', icon: '📊', end: true },
  { to: '/insights', label: 'Insights', icon: '📈' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/products', label: 'Products', icon: '📦' },
  { to: '/entitlements', label: 'Entitlements', icon: '🔑' },
  { to: '/offerings', label: 'Offerings', icon: '🏷️' },
  { to: '/experiments', label: 'Experiments', icon: '🧪' },
  { to: '/webhooks', label: 'Webhooks', icon: '🔔' },
  { to: '/billing', label: 'Billing', icon: '💳' },
  { to: '/audit', label: 'Audit Log', icon: '🛡️' },
  { to: '/account', label: 'Account', icon: '🏢' },
  { to: '/settings', label: 'Apps & Keys', icon: '⚙️' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { conn, disconnect } = useApi();
  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-white/5 bg-ink-900/60 px-3 py-5">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">🐕</span>
          <span className="text-lg font-semibold text-white">RevenueDog</span>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-brand-600/20 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-white/5 pt-4">
          <a
            href={`${conn.baseUrl.replace(/\/$/, '')}/docs`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            <span className="text-base">📖</span> API Docs
          </a>
          <p className="truncate px-3 text-xs text-slate-500" title={conn.baseUrl}>
            {conn.mode === 'session' ? (conn.email ?? 'Signed in') : conn.baseUrl}
          </p>
          <button
            onClick={disconnect}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            {conn.mode === 'session' ? '⏏ Sign out' : '⏏ Disconnect'}
          </button>
        </div>
      </aside>
      <main className="ml-60 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
