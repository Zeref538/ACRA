import React, { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'

function getTimeLeft(expiresAt) {
  const diff = new Date(expiresAt) - Date.now()
  if (diff <= 0) return null
  const totalSeconds = Math.floor(diff / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return { h, m, s, totalSeconds }
}

export function ExpiryCountdown({ expiresAt }) {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(expiresAt))

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft(getTimeLeft(expiresAt))
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  if (!timeLeft) {
    return (
      <span className="text-text-muted text-xs font-medium">
        Expired
      </span>
    )
  }

  const { h, m, s, totalSeconds } = timeLeft

  let text
  let colorClass

  if (totalSeconds > 3600) {
    text = `Expires in ${h}h ${m}m`
    colorClass = 'text-text-muted'
  } else if (totalSeconds > 120) {
    text = `Expires in ${m}m ${s}s`
    colorClass = 'text-amber-400'
  } else {
    text = `Expires in ${s}s`
    colorClass = 'text-orange-400'
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      <Clock size={12} aria-hidden="true" />
      {text}
    </span>
  )
}
