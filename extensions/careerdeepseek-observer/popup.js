/* global chrome */

const output = document.getElementById('output')
const screenshot = document.getElementById('screenshot')
const observeButton = document.getElementById('observe')

observeButton.addEventListener('click', () => {
  observeCurrentTab().catch((error) => {
    output.textContent = JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)
  })
})

async function observeCurrentTab() {
  output.textContent = 'Observing current tab...'

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error('No active tab is available.')
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: capturePageObservation,
    args: [{
      maxElements: 120,
      maxVisibleTextLength: 12000,
    }],
  })
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const observation = injection.result

  screenshot.src = dataUrl
  screenshot.style.display = 'block'
  output.textContent = JSON.stringify({
    ok: true,
    observation: {
      ...observation,
      screenshot: {
        source: 'extension_captureVisibleTab',
        format: 'png',
        dataUrlLength: dataUrl.length,
      },
    },
  }, null, 2)
}

function capturePageObservation(options) {
  const maxElements = positiveInteger(options.maxElements, 120)
  const maxVisibleTextLength = positiveInteger(options.maxVisibleTextLength, 12000)
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
  const candidates = Array.from(document.querySelectorAll(selector))
    .map((element, index) => toElement(element, index, viewport))
    .filter(Boolean)
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

  function toElement(element, index, currentViewport) {
    const tagName = element.tagName.toLowerCase()
    const style = window.getComputedStyle(element)

    if (
      element.hidden
      || element.getAttribute('aria-hidden') === 'true'
      || style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.opacity === '0'
      || (tagName === 'input' && element.type === 'hidden')
    ) {
      return null
    }

    const rect = firstRect(element)
    if (!rect) {
      return null
    }

    const box = intersectRect(rect, {
      x: 0,
      y: 0,
      width: currentViewport.width,
      height: currentViewport.height,
    })
    if (!box || box.width < 2 || box.height < 2) {
      return null
    }

    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }
    const topElement = document.elementFromPoint(center.x, center.y)
    if (!topElement || (topElement !== element && !element.contains(topElement))) {
      return null
    }

    const sources = [`tag:${tagName}`, 'computed-style', 'bounding-rect', 'elementFromPoint']
    const role = inferRole(element, tagName, sources)
    const name = accessibleName(element, tagName, sources)
    const text = renderedText(element)
    const actionable = isActionable(element, tagName, role)

    if (!actionable && !name && role === 'generic' && tagName !== 'label') {
      return null
    }

    return {
      id: element.id || `dom-${index}`,
      tagName,
      role,
      name,
      text,
      href: element instanceof HTMLAnchorElement ? element.href : null,
      box,
      center,
      states: collectStates(element),
      relationships: collectRelationships(element),
      visible: true,
      occluded: false,
      actionable,
      confidence: confidenceScore(role, name, actionable, sources),
      sources,
    }
  }

  function firstRect(element) {
    for (const clientRect of Array.from(element.getClientRects())) {
      if (clientRect.width > 0 && clientRect.height > 0) {
        return {
          x: clientRect.x,
          y: clientRect.y,
          width: clientRect.width,
          height: clientRect.height,
        }
      }
    }

    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
      ? {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      : null
  }

  function intersectRect(rect, viewportRect) {
    const x = Math.max(rect.x, viewportRect.x)
    const y = Math.max(rect.y, viewportRect.y)
    const right = Math.min(rect.x + rect.width, viewportRect.x + viewportRect.width)
    const bottom = Math.min(rect.y + rect.height, viewportRect.y + viewportRect.height)
    const width = right - x
    const height = bottom - y

    return width > 0 && height > 0
      ? {
          x,
          y,
          width,
          height,
        }
      : null
  }

  function accessibleName(element, tagName, sources) {
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledByText = labelledBy
      ?.split(/\s+/)
      .map(id => renderedText(document.getElementById(id)))
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

    const label = associatedLabelText(element)
    if (label) {
      sources.push('label')
      return normalizeText(label)
    }

    const alt = element instanceof HTMLImageElement ? element.alt : ''
    if (alt) {
      sources.push('alt')
      return normalizeText(alt)
    }

    for (const attribute of ['title', 'placeholder']) {
      const value = element.getAttribute(attribute)
      if (value) {
        sources.push(attribute)
        return normalizeText(value)
      }
    }

    if ('value' in element && tagName !== 'button' && element.value) {
      sources.push('value')
      return normalizeText(String(element.value))
    }

    const text = renderedText(element)
    if (text) {
      sources.push('visible-text')
      return text
    }

    return ''
  }

  function associatedLabelText(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`)
      const labelText = renderedText(label)
      if (labelText) {
        return labelText
      }
    }

    return renderedText(element.closest('label'))
  }

  function inferRole(element, tagName, sources) {
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
      return inputRole(element.type)
    }
    if (element instanceof HTMLImageElement) {
      return 'img'
    }
    if (/^h[1-6]$/.test(tagName)) {
      return 'heading'
    }

    return {
      main: 'main',
      nav: 'navigation',
      header: 'banner',
      footer: 'contentinfo',
      aside: 'complementary',
      article: 'article',
      form: 'form',
      section: 'region',
    }[tagName] || 'generic'
  }

  function inputRole(type) {
    return {
      button: 'button',
      submit: 'button',
      reset: 'button',
      checkbox: 'checkbox',
      radio: 'radio',
      range: 'slider',
      search: 'searchbox',
    }[type] || 'textbox'
  }

  function collectStates(element) {
    const states = {}

    for (const key of ['expanded', 'selected', 'checked', 'disabled', 'hidden', 'required', 'invalid', 'current']) {
      const value = element.getAttribute(`aria-${key}`)
      if (value !== null) {
        states[key] = value
      }
    }

    if ('disabled' in element && element.disabled) {
      states.disabled = true
    }
    if ('required' in element && element.required) {
      states.required = true
    }

    return states
  }

  function collectRelationships(element) {
    const relationships = {}

    for (const key of ['controls', 'describedby', 'owns', 'labelledby']) {
      const value = element.getAttribute(`aria-${key}`)
      if (value) {
        relationships[key] = value.split(/\s+/).filter(Boolean)
      }
    }

    return relationships
  }

  function isActionable(element, tagName, role) {
    if ('disabled' in element && element.disabled) {
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

  function confidenceScore(role, name, actionable, sources) {
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

  function detectStopSignals(text) {
    const lower = text.toLowerCase()
    const signals = []

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

  function renderedText(element) {
    const value = element ? Reflect.get(element, 'innerText') : ''
    return typeof value === 'string' ? normalizeText(value) : normalizeText(element?.textContent || '')
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim()
  }

  function cssEscape(value) {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replaceAll('"', '\\"')
  }

  function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback
  }
}
