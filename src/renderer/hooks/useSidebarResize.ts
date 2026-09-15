import { useState, useCallback, useEffect } from 'react'

interface SidebarResizeOptions {
  minWidth?: number
  maxWidth?: number
  side: 'left' | 'right'
}

export interface SidebarResizeState {
  width: number
  isDragging: boolean
  setWidth: (width: number) => void
  setIsDragging: (dragging: boolean) => void
  handleMouseDown: (e: React.MouseEvent) => void
}

export function useSidebarResize(
  initialWidth: number,
  options: SidebarResizeOptions = { minWidth: 200, maxWidth: 500, side: 'right' }
): SidebarResizeState {
  const { minWidth = 200, maxWidth = 500, side } = options
  const [width, setWidth] = useState(initialWidth)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return

      let newWidth: number
      if (side === 'left') {
        newWidth = e.clientX
      } else {
        newWidth = window.innerWidth - e.clientX
      }

      // Clamp to min/max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      setWidth(newWidth)
    },
    [isDragging, side, minWidth, maxWidth]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
    },
    []
  )

  return {
    width,
    isDragging,
    setWidth,
    setIsDragging,
    handleMouseDown
  }
}
