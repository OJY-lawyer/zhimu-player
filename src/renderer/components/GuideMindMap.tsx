import { useEffect, useId, useMemo, useState } from 'react'
import { getMindMapTimestamps, mindMapPlainText, parseGuideMindMap, type GuideMindMapNode } from '../../shared/guideMindMap'
import { t } from '../i18n'
import { Icon } from './Icons'
import './GuideMindMap.css'

interface GuideMindMapProps {
  content: string
  partMap: (number | null)[]
  onNavigate: (partIndex: number, time: number) => void
}

function collectBranches(nodes: GuideMindMapNode[]): string[] {
  return nodes.flatMap(node => node.children.length ? [node.id, ...collectBranches(node.children)] : [])
}

export function GuideMindMap({ content, partMap, onNavigate }: GuideMindMapProps) {
  const nodes = useMemo(() => parseGuideMindMap(content), [content])
  const branches = useMemo(() => collectBranches(nodes), [nodes])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const mapId = useId()
  useEffect(() => { setCollapsed(new Set()) }, [content])

  function toggle(id: string, expanded?: boolean) {
    setCollapsed(current => {
      const next = new Set(current)
      if (expanded === true || (expanded === undefined && next.has(id))) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderNode(node: GuideMindMapNode) {
    const hasChildren = node.children.length > 0
    const expanded = !collapsed.has(node.id)
    const timestamps = getMindMapTimestamps(node.text)
    const target = timestamps.find(timestamp => partMap[timestamp.partIndex] != null)
    const label = mindMapPlainText(node.text) || timestamps.map(timestamp => timestamp.label).join(' ') || node.text
    const childrenId = `${mapId}-${node.id}`
    const navigate = () => {
      if (!target) return
      const part = partMap[target.partIndex]
      if (part != null) onNavigate(part, target.time)
    }
    return (
      <li className="guide-map-branch" data-node-id={node.id} key={node.id}>
        <div className={`guide-map-node guide-map-node-${node.kind}`}>
          {hasChildren && (
            <button
              className="guide-map-toggle"
              type="button"
              aria-expanded={expanded}
              aria-controls={childrenId}
              aria-label={expanded ? t(`折叠：${label}`, `Collapse: ${label}`) : t(`展开：${label}`, `Expand: ${label}`)}
              title={expanded ? t('折叠分支', 'Collapse branch') : t('展开分支', 'Expand branch')}
              onClick={() => toggle(node.id)}
              onKeyDown={event => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  event.stopPropagation()
                  toggle(node.id, event.key === 'ArrowRight')
                }
              }}
            >
              <Icon name="chevron-right" size={15} />
            </button>
          )}
          <div className="guide-map-node-copy">
            {target ? (
              <button className="guide-map-node-link" type="button" onClick={navigate}
                title={t(`跳转至 ${target.label}`, `Go to ${target.label}`)}>{label}</button>
            ) : <span className="guide-map-node-label">{label}</span>}
            {timestamps.length > 0 && (
              <div className="guide-map-timestamps">
                {timestamps.map((timestamp, index) => {
                  const part = partMap[timestamp.partIndex] ?? null
                  return <button className="timestamp-button" type="button" key={index}
                    disabled={part === null}
                    title={part === null ? t('无法确定这个时间戳对应的视频', 'The video for this timestamp could not be identified') : t(`跳转至当前播放列表 P${part + 1}`, `Go to P${part + 1} in the current playlist`)}
                    onClick={() => part !== null && onNavigate(part, timestamp.time)}>{timestamp.label}</button>
                })}
              </div>
            )}
            {hasChildren && !expanded && <span className="guide-map-hidden-count">{t(`${node.children.length} 个分支`, `${node.children.length} branches`)}</span>}
          </div>
        </div>
        {hasChildren && <ul className="guide-map-children" id={childrenId} hidden={!expanded}>{node.children.map(renderNode)}</ul>}
      </li>
    )
  }

  if (!nodes.length) return null
  return (
    <div className="guide-mind-map">
      <div className="guide-map-actions" role="group" aria-label={t('思维导图操作', 'Mind map controls')}>
        <button className="text-button" type="button" disabled={!collapsed.size} onClick={() => setCollapsed(new Set())}>{t('全部展开', 'Expand all')}</button>
        <button className="text-button" type="button" disabled={!branches.length || branches.every(id => collapsed.has(id))} onClick={() => setCollapsed(new Set(branches))}>{t('全部折叠', 'Collapse all')}</button>
      </div>
      <div className="guide-map-canvas" role="region" aria-label={t('导读思维导图', 'Guide mind map')} tabIndex={0}
        onKeyDown={event => { event.stopPropagation() }}>
        <div className="guide-map-root">{t('内容导读', 'Content guide')}</div>
        <ul className="guide-map-tree" aria-label={t('导读主题', 'Guide topics')}>{nodes.map(renderNode)}</ul>
      </div>
    </div>
  )
}
