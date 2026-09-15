import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { DrawerTab } from '../components/RightDrawer'

interface DrawerPreferences {
  pinned: boolean
  width: number
}

function clampWidth(width: number) {
  const maxWidth = Math.max(300, Math.min(720, window.innerWidth * 0.45))
  return Math.max(300, Math.min(maxWidth, width))
}

export function useDrawerState(
  scopeKey: string,
  persisted: DrawerPreferences,
  preferredTab: DrawerTab,
) {
  const [activeTab, setActiveTab] = useState<DrawerTab>(preferredTab)
  const [isPinned, setIsPinned] = useState(persisted.pinned)
  const [isHoverOpen, setIsHoverOpen] = useState(false)
  const [width, setWidth] = useState(() => clampWidth(persisted.width || 420))
  const [isResizing, setIsResizing] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearTimer = useCallback((timer: MutableRefObject<number | null>) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useLayoutEffect(() => {
    setActiveTab(preferredTab)
  }, [preferredTab, scopeKey])

  useLayoutEffect(() => {
    if (!isResizing) setWidth(clampWidth(persisted.width || 420))
    setIsPinned(persisted.pinned)
  }, [isResizing, persisted.pinned, persisted.width])

  useEffect(() => {
    const handleResize = () => setWidth((current) => clampWidth(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (event: MouseEvent) => {
      setWidth(clampWidth(window.innerWidth - event.clientX))
    }
    const handleMouseUp = () => setIsResizing(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  useEffect(() => () => {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
  }, [clearTimer])

  const handleEdgeEnter = useCallback(() => {
    if (isPinned) return
    clearTimer(closeTimerRef)
    clearTimer(openTimerRef)
    openTimerRef.current = window.setTimeout(() => setIsHoverOpen(true), 120)
  }, [clearTimer, isPinned])

  const handleDrawerEnter = useCallback(() => {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    if (!isPinned) setIsHoverOpen(true)
  }, [clearTimer, isPinned])

  const handleDrawerLeave = useCallback(() => {
    if (isPinned || isResizing) return
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    closeTimerRef.current = window.setTimeout(() => setIsHoverOpen(false), 300)
  }, [clearTimer, isPinned, isResizing])

  const togglePinned = useCallback(() => {
    setIsPinned((current) => {
      setIsHoverOpen(current)
      return !current
    })
  }, [])

  const openTab = useCallback((tab: DrawerTab) => {
    setActiveTab(tab)
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    if (!isPinned) setIsHoverOpen(true)
  }, [clearTimer, isPinned])

  const handleResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsResizing(true)
  }, [])

  return {
    activeTab,
    isOpen: isPinned || isHoverOpen || isResizing,
    isPinned,
    isResizing,
    width,
    setActiveTab,
    openTab,
    togglePinned,
    handleEdgeEnter,
    handleDrawerEnter,
    handleDrawerLeave,
    handleResizeMouseDown,
  }
}
