/// <reference lib="dom" />

import type { BrowserSemanticElement, DomSemanticObservation } from './browserObservation.js'

export interface CaptureDomSemanticObservationOptions {
  maxElements?: number
  maxVisibleTextLength?: number
  minBoxSize?: number
}

export function captureDomSemanticObservation(options: CaptureDomSemanticObservationOptions = {}): DomSemanticObservation {
  const maxElements = positiveInteger(options.maxElements, 120)
  const maxVisibleTextLength = positiveInteger(options.maxVisibleTextLength, 12000)
  const minBoxSize = positiveInteger(options.minBoxSize, 2)
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }
  const fullVisibleText = renderedText(document.body)
  const selector = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    'details',
    'label',
    'img[alt]',
    '[role]',
    '[aria-label]',
    '[aria-labelledby]',
    '[aria-describedby]',
    '[aria-controls]',
    '[tabindex]:not([tabindex="-1"])',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'main',
    'nav',
    'header',
    'footer',
    'aside',
    'article',
    'section',
    'form',
  ].join(',')
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((element, index) => toSemanticElement(element, index, viewport, minBoxSize))
    .filter((element): element is BrowserSemanticElement => element !== null)
  const elements = candidates.slice(0, maxElements)
  const visibleText = fullVisibleText.slice(0, maxVisibleTextLength)

  return {
    schemaVersion: 'browser-observation/v1',
    source: 'dom_aria_approx',
    url: window.location.href,
    title: document.title || window.location.href,
    observedAt: new Date().toISOString(),
    viewport,
    visibleText,
    elements,
    signals: detectStopSignals(fullVisibleText),
    limits: {
      maxElements,
      maxVisibleTextLength,
      truncatedElements: candidates.length > maxElements,
      truncatedVisibleText: fullVisibleText.length > maxVisibleTextLength,
    },
    notes: [
      'This observation is DOM-visible plus ARIA/HTML semantic approximation, not native browser AX tree.',
    ],
  }

  function toSemanticElement(
    element: HTMLElement,
    index: number,
    currentViewport: { width: number, height: number, scrollX: number, scrollY: number },
    minimumBoxSize: number,
  ): BrowserSemanticElement | null {
    const tagName = element.tagName.toLowerCase()
    const sources: string[] = [`tag:${tagName}`]
    const style = window.getComputedStyle(element)
    const hiddenByAttribute = element.hidden
      || element.getAttribute('aria-hidden') === 'true'
      || (tagName === 'input' && (element as HTMLInputElement).type === 'hidden')
    const hiddenByStyle = style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.opacity === '0'

    if (hiddenByAttribute || hiddenByStyle) {
      return null
    }

    sources.push('computed-style')

    const rect = firstUsableRect(element)
    if (!rect) {
      return null
    }

    const box = intersectRect(rect, {
      x: 0,
      y: 0,
      width: currentViewport.width,
      height: currentViewport.height,
    })
    if (!box || box.width < minimumBoxSize || box.height < minimumBoxSize) {
      return null
    }

    sources.push('bounding-rect')

    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }
    const topElement = document.elementFromPoint(center.x, center.y)
    const occluded = !topElement || (topElement !== element && !element.contains(topElement))
    if (occluded) {
      return null
    }

    sources.push('elementFromPoint')

    const role = inferRole(element, tagName, sources)
    const name = accessibleNameApproximation(element, tagName, sources)
    const text = normalizeText(renderedText(element) || element.textContent || '')
    const href = element instanceof HTMLAnchorElement ? element.href : null
    const actionable = isActionable(element, tagName, role)

    if (!isWorthKeeping({ role, name, text, actionable, tagName })) {
      return null
    }

    return {
      id: element.id || `dom-${index}`,
      tagName,
      role,
      name,
      text,
      href,
      box,
      center,
      states: collectStates(element),
      relationships: collectRelationships(element),
      visible: true,
      occluded: false,
      actionable,
      confidence: confidenceScore({ role, name, actionable, sources }),
      sources,
    }
  }

  function firstUsableRect(element: HTMLElement) {
    for (const clientRect of Array.from(element.getClientRects())) {
      const rect = {
        x: clientRect.x,
        y: clientRect.y,
        width: clientRect.width,
        height: clientRect.height,
      }
      if (rect.width > 0 && rect.height > 0) {
        return rect
      }
    }

    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  }

  function intersectRect(
    rect: { x: number, y: number, width: number, height: number },
    clip: { x: number, y: number, width: number, height: number },
  ) {
    const x = Math.max(rect.x, clip.x)
    const y = Math.max(rect.y, clip.y)
    const right = Math.min(rect.x + rect.width, clip.x + clip.width)
    const bottom = Math.min(rect.y + rect.height, clip.y + clip.height)
    const width = right - x
    const height = bottom - y

    if (width <= 0 || height <= 0) {
      return null
    }

    return {
      x,
      y,
      width,
      height,
    }
  }

  function accessibleNameApproximation(element: HTMLElement, tagName: string, sources: string[]): string {
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledByText = labelledBy
      ?.split(/\s+/)
      .map(id => renderedText(document.getElementById(id)).trim())
      .filter(Boolean)
      .join(' ')
    if (labelledByText) {
      sources.push('aria-labelledby')
      return normalizeText(labelledByText)
    }

    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) {
      sources.push('aria-label')
      return normalizeText(ariaLabel)
    }

    const labelText = associatedLabelText(element)
    if (labelText) {
      sources.push('label')
      return normalizeText(labelText)
    }

    if (element instanceof HTMLImageElement && element.alt) {
      sources.push('alt')
      return normalizeText(element.alt)
    }

    const title = element.getAttribute('title')
    if (title) {
      sources.push('title')
      return normalizeText(title)
    }

    const placeholder = element.getAttribute('placeholder')
    if (placeholder) {
      sources.push('placeholder')
      return normalizeText(placeholder)
    }

    if ('value' in element && tagName !== 'button') {
      const value = String(element.value ?? '')
      if (value) {
        sources.push('value')
        return normalizeText(value)
      }
    }

    const text = renderedText(element) || element.textContent || ''
    if (text) {
      sources.push('visible-text')
      return normalizeText(text)
    }

    return ''
  }

  function associatedLabelText(element: HTMLElement): string {
    if (element.id) {
      const explicitLabel = document.querySelector<HTMLLabelElement>(`label[for="${cssEscape(element.id)}"]`)
      const explicitLabelText = renderedText(explicitLabel)
      if (explicitLabelText) {
        return explicitLabelText
      }
    }

    const parentLabel = element.closest('label')
    return renderedText(parentLabel)
  }

  function inferRole(element: HTMLElement, tagName: string, sources: string[]): string {
    const explicitRole = element.getAttribute('role')
    if (explicitRole) {
      sources.push('explicit-role')
      return explicitRole
    }

    sources.push('implicit-role')

    if (element instanceof HTMLAnchorElement && element.href) {
      return 'link'
    }
    if (element instanceof HTMLButtonElement || tagName === 'summary') {
      return 'button'
    }
    if (element instanceof HTMLTextAreaElement) {
      return 'textbox'
    }
    if (element instanceof HTMLSelectElement) {
      return element.multiple ? 'listbox' : 'combobox'
    }
    if (element instanceof HTMLInputElement) {
      return inputRole(element)
    }
    if (element instanceof HTMLImageElement) {
      return 'img'
    }
    if (/^h[1-6]$/.test(tagName)) {
      return 'heading'
    }

    const landmarkRole = landmarkRoleForTag(tagName)
    if (landmarkRole) {
      return landmarkRole
    }

    return 'generic'
  }

  function inputRole(element: HTMLInputElement): string {
    switch (element.type) {
      case 'button':
      case 'submit':
      case 'reset':
        return 'button'
      case 'checkbox':
        return 'checkbox'
      case 'radio':
        return 'radio'
      case 'range':
        return 'slider'
      case 'search':
        return 'searchbox'
      case 'email':
      case 'password':
      case 'tel':
      case 'text':
      case 'url':
      default:
        return 'textbox'
    }
  }

  function landmarkRoleForTag(tagName: string): string | null {
    switch (tagName) {
      case 'main':
        return 'main'
      case 'nav':
        return 'navigation'
      case 'header':
        return 'banner'
      case 'footer':
        return 'contentinfo'
      case 'aside':
        return 'complementary'
      case 'article':
        return 'article'
      case 'form':
        return 'form'
      case 'section':
        return 'region'
      default:
        return null
    }
  }

  function collectStates(element: HTMLElement) {
    const states: Record<string, unknown> = {}

    for (const key of ['expanded', 'selected', 'checked', 'disabled', 'hidden', 'required', 'invalid', 'current'] as const) {
      const value = element.getAttribute(`aria-${key}`)
      if (value !== null) {
        states[key] = value
      }
    }

    if (isNativeDisabled(element)) {
      states.disabled = true
    }
    if ('required' in element && Boolean(element.required)) {
      states.required = true
    }

    return states
  }

  function collectRelationships(element: HTMLElement) {
    const relationships: Record<string, unknown> = {}

    for (const key of ['controls', 'describedby', 'owns', 'labelledby'] as const) {
      const value = element.getAttribute(`aria-${key}`)
      if (value) {
        relationships[key] = value.split(/\s+/).filter(Boolean)
      }
    }

    return relationships
  }

  function isActionable(element: HTMLElement, tagName: string, role: string): boolean {
    if (isNativeDisabled(element)) {
      return false
    }

    return element instanceof HTMLAnchorElement
      || element instanceof HTMLButtonElement
      || element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || tagName === 'summary'
      || ['button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox', 'listbox', 'menuitem', 'tab'].includes(role)
  }

  function isNativeDisabled(element: HTMLElement): boolean {
    return element instanceof HTMLButtonElement
      || element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      ? element.disabled
      : false
  }

  function isWorthKeeping({
    role,
    name,
    text,
    actionable,
    tagName,
  }: {
    role: string
    name: string
    text: string
    actionable: boolean
    tagName: string
  }): boolean {
    if (actionable || name || role !== 'generic') {
      return true
    }

    return tagName === 'label' && Boolean(text)
  }

  function confidenceScore({
    role,
    name,
    actionable,
    sources,
  }: {
    role: string
    name: string
    actionable: boolean
    sources: string[]
  }): number {
    let score = 0.25
    if (role !== 'generic') {
      score += 0.2
    }
    if (name) {
      score += 0.25
    }
    if (sources.includes('aria-labelledby') || sources.includes('aria-label') || sources.includes('label')) {
      score += 0.15
    }
    if (sources.includes('bounding-rect') && sources.includes('elementFromPoint')) {
      score += 0.1
    }
    if (actionable) {
      score += 0.05
    }

    return Math.min(1, Number(score.toFixed(2)))
  }

  function detectStopSignals(text: string): string[] {
    const lower = text.toLowerCase()
    const signals: string[] = []

    if (lower.includes('captcha') || lower.includes('verify you are human') || text.includes('自动程序')) {
      signals.push('captcha')
    }
    if (lower.includes('sign in') || lower.includes('log in') || lower.includes('login')) {
      signals.push('login_required')
    }
    if (
      lower.includes('too many requests')
      || lower.includes('rate limit')
      || lower.includes('unusual traffic')
      || lower.includes('detected unusual')
      || text.includes('异常流量')
    ) {
      signals.push('rate_limited')
    }

    return signals
  }

  function renderedText(element: Element | null): string {
    const value = element ? Reflect.get(element, 'innerText') : ''
    return typeof value === 'string' ? normalizeText(value) : normalizeText(element?.textContent ?? '')
  }

  function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
  }

  function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replaceAll('"', '\\"')
  }

  function positiveInteger(value: unknown, fallback: number): number {
    return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback
  }
}
