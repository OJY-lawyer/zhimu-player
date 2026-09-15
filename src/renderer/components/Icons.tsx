import type { SVGProps } from 'react'

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'folder'
  | 'fullscreen'
  | 'guide'
  | 'list'
  | 'maximize'
  | 'minimize'
  | 'more'
  | 'pause'
  | 'pin'
  | 'play'
  | 'search'
  | 'settings'
  | 'subtitles'
  | 'volume'
  | 'volume-off'

const paths: Record<IconName, JSX.Element> = {
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  folder: <path d="M3 7.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Zm0 0V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5" />,
  fullscreen: <><path d="M8 3H3v5" /><path d="m3 3 6 6" /><path d="M16 3h5v5" /><path d="m21 3-6 6" /><path d="M8 21H3v-5" /><path d="m3 21 6-6" /><path d="M16 21h5v-5" /><path d="m21 21-6-6" /></>,
  guide: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" /><path d="M8 8h7M8 12h7M8 16h4" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1" />,
  minimize: <path d="M5 12h14" />,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  pin: <><path d="m9 4 6 6" /><path d="m14 3 7 7-4 1-4 4-1 6-3-3-6-6 6-1 4-4 1-4Z" /></>,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  subtitles: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h4M14 10h3M7 14h2M12 14h5" /></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
  'volume-off': <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 9 5 5M21 9l-5 5" /></>,
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
