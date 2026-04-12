import { NavLink } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { LLMStatus } from './LLMStatus';

const NAV_ITEMS = [
  { to: '/', label: 'Upload' },
  { to: '/archive', label: 'Archive' },
  { to: '/settings', label: 'Settings' },
];

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Briefcase className="w-5 h-5 text-indigo-400" />
            <span>JobMatch</span>
          </div>
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
        <LLMStatus />
      </div>
    </nav>
  );
}
