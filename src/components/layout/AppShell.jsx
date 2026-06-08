import React, { useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, ScanSearch, Layers, Clock, LogOut, FlaskConical, Sun, Moon } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'

// ── Ambient blobs + cursor glow ───────────────────────────────────────────
function AmbientBackground() {
  const cursorRef = useRef(null)

  useEffect(() => {
    const el = cursorRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let tx = window.innerWidth  / 2
    let ty = window.innerHeight / 2
    let cx = tx
    let cy = ty
    let raf = null

    function tick() {
      cx += (tx - cx) * 0.05
      cy += (ty - cy) * 0.05
      const isLight = document.documentElement.classList.contains('light')
      const color = isLight ? 'rgba(6,148,185,0.18)' : 'rgba(6,148,185,0.08)'
      el.style.background =
        `radial-gradient(650px circle at ${cx}px ${cy}px, ${color}, transparent 80%)`
      raf = requestAnimationFrame(tick)
    }

    function onMove(e) { tx = e.clientX; ty = e.clientY }

    window.addEventListener('mousemove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf) }
  }, [])

  return (
    <>
      {/* Blob 1 — cyan / teal (brand primary), top-left */}
      <div
        className="blob-1"
        aria-hidden="true"
        style={{
          position: 'fixed', top: '-180px', left: '-120px',
          width: '700px', height: '700px', borderRadius: '50%',
          background: 'rgba(6,148,185,1)',
          filter: 'blur(80px)', opacity: 0.22, zIndex: 0, pointerEvents: 'none',
        }}
      />
      {/* Blob 2 — orange / coral (brand orange dot), bottom-right */}
      <div
        className="blob-2"
        aria-hidden="true"
        style={{
          position: 'fixed', bottom: '-160px', right: '-100px',
          width: '650px', height: '650px', borderRadius: '50%',
          background: 'rgba(249,115,22,1)',
          filter: 'blur(80px)', opacity: 0.18, zIndex: 0, pointerEvents: 'none',
        }}
      />
      {/* Blob 3 — violet / indigo, center-left wandering */}
      <div
        className="blob-3"
        aria-hidden="true"
        style={{
          position: 'fixed', top: '25%', left: '20%',
          width: '560px', height: '560px', borderRadius: '50%',
          background: 'rgba(139,92,246,1)',
          filter: 'blur(90px)', opacity: 0.18, zIndex: 0, pointerEvents: 'none',
        }}
      />
      {/* Cursor glow overlay — lerp-delayed */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          zIndex: 0, pointerEvents: 'none', background: 'transparent',
        }}
      />
    </>
  )
}

const mainNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', short: 'Home'    },
  { to: '/single',    icon: ScanSearch,      label: 'Single',    short: 'Single'  },
  { to: '/bulk',      icon: Layers,          label: 'Bulk',      short: 'Bulk'    },
  { to: '/history',   icon: Clock,           label: 'Storage',   short: 'Storage' },
]

const toolNavItems = [
  { to: '/demo', icon: FlaskConical, label: 'Algorithm Explorer', short: 'Explorer' },
]

// ── Icon rail item — icon only, tooltip via title + aria-label ────────────
function RailItem({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      title={label}
      aria-label={label}
      style={({ isActive }) => isActive ? {
        background: 'linear-gradient(135deg, rgba(6,148,185,0.15) 0%, rgba(6,148,185,0.05) 100%)',
      } : {}}
      className={({ isActive }) =>
        [
          'relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150',
          isActive
            ? 'text-primary'
            : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-primary"
              aria-hidden="true"
            />
          )}
          <span className={[
            'flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors duration-150',
            isActive ? 'bg-primary/15' : '',
          ].join(' ')}>
            <Icon size={16} aria-hidden="true" />
          </span>
        </>
      )}
    </NavLink>
  )
}

// ── Bottom tab item (mobile) ──────────────────────────────────────────────
function TabItem({ to, icon: Icon, short }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-lg transition-colors min-w-0 flex-1',
          isActive ? 'text-primary' : 'text-text-muted active:text-text-primary',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <div className="flex flex-col items-center gap-0.5 relative pt-1">
          {isActive && (
            <span className="absolute -top-0.5 w-1 h-1 rounded-full bg-primary" aria-hidden="true" />
          )}
          <Icon size={20} aria-hidden="true" />
          <span className="text-[10px] font-medium leading-none hidden xs:block truncate">{short}</span>
        </div>
      )}
    </NavLink>
  )
}

export function AppShell({ children }) {
  const { logout, session } = useAuth()
  const { theme, toggle }   = useTheme()
  const mainRef             = useRef(null)
  const location            = useLocation()

  const userEmail   = session?.user?.email ?? ''
  const userInitial = userEmail[0]?.toUpperCase() ?? 'A'

  useEffect(() => {
    mainRef.current?.querySelector('h1')?.focus()
  }, [location.pathname])

  const allNavItems = [...mainNavItems, ...toolNavItems]

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-base">

      {/* ── Background layer (blobs + cursor glow) ─────────────────────── */}
      <AmbientBackground />

      {/* ── UI content layer (above background) ────────────────────────── */}
      <div className="relative flex flex-col flex-1 overflow-hidden" style={{ zIndex: 1 }}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg"
      >
        Skip to main content
      </a>

      {/* ── Top bar (md+) ──────────────────────────────────────────────── */}
      <header
        className="hidden md:flex items-center justify-between h-11 px-4 shrink-0 border-b"
        style={{
          background: 'linear-gradient(90deg, rgb(var(--bg-elevated) / 0.9) 0%, rgb(var(--bg-surface)) 100%)',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
            <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(249,115,22,0.9)' }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(6,148,185,1)' }} />
            <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(245,158,11,0.9)' }} />
          </div>
          <span className="brand-logotype text-sm text-text-primary">ACRA</span>
          <span
            className="hidden lg:inline text-[10px] text-text-muted ml-0.5 border-l pl-2"
            style={{ borderColor: 'rgba(255,255,255,0.15)' }}
          >
            Color Accessibility Tool
          </span>
        </div>

        {/* User controls */}
        <div
          className="flex items-center gap-2 px-2.5 py-1 rounded-lg"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div
            className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold text-white select-none"
            style={{ background: 'linear-gradient(135deg, rgb(var(--primary)) 0%, rgb(14,120,152) 100%)' }}
            aria-hidden="true"
          >
            {userInitial}
          </div>
          <p className="text-xs text-text-muted truncate max-w-[160px]">
            {userEmail || 'Signed in'}
          </p>
          <div
            className="flex items-center gap-0.5 ml-0.5 pl-2 border-l"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <button
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="p-1 rounded-md text-text-disabled hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              {theme === 'dark'
                ? <Sun  size={13} aria-hidden="true" />
                : <Moon size={13} aria-hidden="true" />}
            </button>
            <button
              onClick={logout}
              aria-label="Logout"
              className="p-1 rounded-md text-text-disabled hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <LogOut size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Row: icon rail + content ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Icon rail (md+) */}
        <nav
          className="hidden md:flex flex-col items-center w-12 shrink-0 border-r pt-3 pb-4 gap-1"
          style={{
            background: 'linear-gradient(180deg, rgb(var(--bg-elevated) / 0.5) 0%, rgb(var(--bg-surface)) 100%)',
            borderRightColor: 'rgba(255,255,255,0.06)',
          }}
          aria-label="Main navigation"
        >
          {mainNavItems.map((item) => (
            <RailItem key={item.to} {...item} />
          ))}

          <div
            className="w-5 h-px my-1 shrink-0"
            style={{ background: 'rgba(255,255,255,0.07)' }}
            aria-hidden="true"
          />

          {toolNavItems.map((item) => (
            <RailItem key={item.to} {...item} />
          ))}
        </nav>

        {/* Content column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Mobile top bar */}
          <header
            className="md:hidden flex items-center justify-between px-4 h-12 shrink-0 border-b"
            style={{
              background: 'linear-gradient(90deg, rgb(var(--bg-elevated) / 0.8) 0%, rgb(var(--bg-surface)) 100%)',
              borderColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(249,115,22,0.9)' }} />
                <span className="w-2 h-2 rounded-full"     style={{ background: 'rgba(6,148,185,1)' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(245,158,11,0.9)' }} />
              </div>
              <span className="brand-logotype text-sm text-text-primary">ACRA</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggle}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="p-2 rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
              </button>
              <button
                onClick={logout}
                aria-label="Logout"
                className="p-2 rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          {/* Scrollable page content */}
          <main
            id="main-content"
            ref={mainRef}
            className="flex-1 overflow-y-auto p-4 md:p-8"
            tabIndex={-1}
            style={{ outline: 'none', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 2rem)' }}
          >
            <div className="md:hidden h-0" aria-hidden="true" />
            {children}
            <div className="md:hidden h-4" aria-hidden="true" />
          </main>

          {/* ── Mobile bottom tab bar ────────────────────────────────────── */}
          <nav
            className="md:hidden flex items-stretch border-t bg-bg-surface px-2 py-1 shrink-0"
            aria-label="Main navigation"
            style={{
              borderColor: 'rgba(255,255,255,0.06)',
              paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
            }}
          >
            {allNavItems.map((item) => (
              <TabItem key={item.to} {...item} />
            ))}
          </nav>
        </div>
      </div>
      </div>{/* end UI content layer */}
    </div>
  )
}
