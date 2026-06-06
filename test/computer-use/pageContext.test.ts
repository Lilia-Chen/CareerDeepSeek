import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { classifyBrowserPage } from '../../src/computer-use/page-context.js'

describe('browser page context classifier', () => {
  it('classifies the LinkedIn feed as a usable LinkedIn start state', () => {
    const context = classifyBrowserPage({
      url: 'https://www.linkedin.com/feed/',
      title: 'Feed | LinkedIn',
      domAvailable: true,
      signals: [],
    })

    assert.equal(context.className, 'linkedin_feed')
    assert.equal(context.host, 'www.linkedin.com')
    assert.equal(context.source, 'chrome_dom')
  })

  it('classifies LinkedIn company search results separately from generic LinkedIn pages', () => {
    const context = classifyBrowserPage({
      url: 'https://www.linkedin.com/search/results/companies/?keywords=AI%20agent%20infrastructure',
      title: 'AI agent infrastructure | Search | LinkedIn',
      domAvailable: true,
      signals: [],
    })

    assert.equal(context.className, 'linkedin_search_results')
  })

  it('classifies Google search results for bootstrap-only workflows', () => {
    const context = classifyBrowserPage({
      url: 'https://www.google.com/search?q=AI+agent+infrastructure',
      title: 'AI agent infrastructure - Google Search',
      domAvailable: true,
      signals: [],
    })

    assert.equal(context.className, 'google_results')
  })
})
