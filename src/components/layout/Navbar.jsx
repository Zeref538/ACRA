import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { LogOut } from 'lucide-react'

export function Navbar() {
  const { session, logout } = useAuth()

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-bg-surface border-b border-border-default shrink-0">
      <span className="font-heading font-bold text-text-primary">ACRA</span>
      <div className="flex items-center gap-3">
        {session?.user?.email && (
          <span className="text-sm text-text-muted hidden sm:block">
            {session.user.email}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut size={15} aria-hidden="true" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  )
}
