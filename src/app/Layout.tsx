import { Activity, Bell, LayoutDashboard, LogIn, Menu, MessageSquare, Moon, PanelLeft, Radar, Settings, ShieldCheck, Sun, Target, User, Wallet, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={19} />, group: 'overview' },
  { path: '/detection', label: 'Detection Engine', icon: <Radar size={19} />, group: 'market' },
  { path: '/sentiment', label: 'Narrative Intelligence', icon: <Target size={19} />, group: 'market' },
  { path: '/smart-money', label: 'Smart Money Engine', icon: <Zap size={19} />, group: 'capital' },
  { path: '/heatmap', label: 'Token Heatmap', icon: <Activity size={19} />, group: 'capital' },
  { path: '/wallet', label: 'Wallet Tracker', icon: <Wallet size={19} />, group: 'capital' },
  { path: '/smart-alerts', label: 'Smart Alerts', icon: <Bell size={19} />, group: 'tools' },
  { path: '/ai-assistant', label: 'AI Assistant', icon: <MessageSquare size={19} />, group: 'tools' },
  { path: '/safe-scan', label: 'Safe Scan', icon: <ShieldCheck size={19} />, group: 'tools' },
  { path: '/settings', label: 'Settings', icon: <Settings size={19} />, group: 'account' }
] as const;

const sections = [
  { key: 'overview', label: 'Overview' },
  { key: 'market', label: 'Market & Narrative Intelligence' },
  { key: 'capital', label: 'Wallet & Capital Intelligence' },
  { key: 'tools', label: 'Platform-wide Intelligence & Tools' },
  { key: 'account', label: 'Account' }
] as const;

function titleFromPath(pathname: string) {
  if (pathname.startsWith('/safe-scan')) return 'Safe Scan';
  if (pathname.startsWith('/detection')) return 'Detection Engine';
  if (pathname.startsWith('/smart-money')) return 'Smart Money Engine';
  if (pathname.startsWith('/wallet')) return 'Wallet Tracker';
  return 'Overview';
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const location = useLocation();
  const pageTitle = titleFromPath(location.pathname);

  return (
    <div className={`app-shell ${darkMode ? 'dark-preview' : ''}`}>
      <header className="topbar">
        <button className="icon-button mobile-only" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <Link className="brand-mark desktop-only" to="/safe-scan" aria-label="Atlaix Safe Scan">
          <span><img src="/logo.png" alt="" /></span>
          <strong>Atlaix</strong>
        </Link>
        <h1>{pageTitle}</h1>
        <div className="topbar-actions">
          <button className="appearance-button" type="button" onClick={() => setDarkMode((current) => !current)} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? <Moon size={18} /> : <Sun size={19} />}
          </button>
          <button className="profile-button" type="button" aria-label="Open user menu">
            <User size={18} />
          </button>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="mobile-nav-scrim" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
          <aside>
            <div className="mobile-nav-head">
              <Link to="/safe-scan" onClick={() => setMobileNavOpen(false)}><span><img src="/logo.png" alt="" /></span><strong>Atlaix</strong></Link>
              <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={21} /></button>
            </div>
            <NavList closeMobile={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      <aside className={`rail ${navPinned ? 'pinned' : ''}`}>
        <button className="rail-pin" type="button" onClick={() => setNavPinned((current) => !current)} aria-label={navPinned ? 'Collapse navigation' : 'Keep navigation open'}>
          <PanelLeft size={20} />
        </button>
        <NavList />
        <button className="rail-account" type="button" aria-label="Log in">
          <LogIn size={18} />
          <span>Log in</span>
        </button>
      </aside>

      <main>{children}</main>
    </div>
  );
}

function NavList({ closeMobile }: { closeMobile?: () => void }) {
  const location = useLocation();
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {sections.map((section) => {
        const items = navItems.filter((item) => item.group === section.key);
        return (
          <div className="nav-section" key={section.key}>
            <small>{section.label}</small>
            {items.map((item) => (
              <Link className={location.pathname.startsWith(item.path) ? 'active' : ''} key={item.path} to={item.path} onClick={closeMobile}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
