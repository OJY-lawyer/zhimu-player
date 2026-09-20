export interface ChatGptComposerState {
  found: boolean
  empty: boolean
  matches: boolean
  length: number
}

/** Runs in the page. All text stays there; only verification flags leave the editor. */
function inspectComposer(action: 'read' | 'paste', expectedText: string): ChatGptComposerState {
  const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').trim()
  const expected = normalize(expectedText)
  const editors = [...document.querySelectorAll('#prompt-textarea')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || node.closest('[hidden],[aria-hidden="true"],[inert]')) return false
    const box = node.getBoundingClientRect(), style = getComputedStyle(node)
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
  })
  const editor = editors.length === 1 ? editors[0] : null
  const textarea = editor instanceof HTMLTextAreaElement ? editor : null
  if (!editor || textarea && (textarea.disabled || textarea.readOnly) || !textarea && !editor.isContentEditable) {
    return { found: false, empty: false, matches: false, length: 0 }
  }
  const block = (node: Node) => node instanceof HTMLElement && /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(node.tagName)
  // ProseMirror can represent each pasted line as a paragraph. innerText adds
  // visual paragraph spacing; this second candidate reads the actual line/BR structure.
  const plainText = (node: Node): string => {
    if (node.nodeType === 3) return node.nodeValue || ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.tagName === 'BR') return node.classList.contains('ProseMirror-trailingBreak')
      || node.parentNode?.childNodes.length === 1 ? '' : '\n'
    if (/^(IMG|VIDEO|AUDIO|CANVAS|IFRAME)$/.test(node.tagName)) return '\ufffc'
    const children = [...node.childNodes]
    return children.map((child, index) => (index > 0 && (block(child) || block(children[index - 1])) ? '\n' : '') + plainText(child)).join('')
  }
  const read = (): ChatGptComposerState => {
    const candidates = textarea ? [normalize(textarea.value)] : [normalize(editor.innerText), normalize(plainText(editor))]
    return { found: true, empty: candidates.every(text => !text),
      matches: !!expected && candidates.some(text => text === expected), length: Math.max(...candidates.map(text => text.length)) }
  }
  const initial = read()
  if (action !== 'paste' || !expected || !initial.empty) return initial
  try {
    editor.focus()
    // A focus handler can restore a saved draft. Check again before mutating.
    if (!read().empty) return read()
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) return read()
      setter.call(textarea, expectedText)
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: expectedText }))
    } else {
      const data = new DataTransfer()
      data.setData('text/plain', expectedText)
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: data }))
    }
  } catch { /* Unsupported/rejected paste is reported by the read-back flags, never by a text-bearing exception. */ }
  return read()
}

export function chatGptComposerExpression(action: 'read' | 'paste', expectedText: string): string {
  return `(${inspectComposer.toString()})(${JSON.stringify(action)},${JSON.stringify(expectedText)})`
}
