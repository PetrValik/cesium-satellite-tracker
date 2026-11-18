import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// read from disk: vitest serves CSS as an empty module (see core/engine/signalColors.test.ts)
const read = (file: string) =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const navCss = read('nav.css')
const tokensCss = read('tokens.css')
const modeTabsCss = read('mode-tabs.css')

interface Block {
  prelude: string
  body: string
}

/** Top-level `prelude { body }` blocks of a stylesheet or of an @media body. */
function blocks(css: string): Block[] {
  const out: Block[] = []
  let depth = 0
  let from = 0
  let bodyFrom = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) {
        out.push({ prelude: css.slice(from, i).trim().replace(/\s+/g, ' '), body: '' })
        bodyFrom = i + 1
      }
      depth++
    } else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        out[out.length - 1].body = css.slice(bodyFrom, i)
        from = i + 1
      }
    }
  }
  return out
}

function declarations(body: string): Record<string, string> {
  const pairs = body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim().replace(/\s+/g, ' ')])
  return Object.fromEntries(pairs)
}

/** Declarations of `selector` (merged), at the top level or inside the @media blocks `media` matches. */
function rule(css: string, selector: string, media?: (query: string) => boolean): Record<string, string> {
  const scope = media
    ? blocks(css)
        .filter((b) => b.prelude.startsWith('@media') && media(b.prelude))
        .flatMap((b) => blocks(b.body))
    : blocks(css)
  return Object.assign({}, ...scope.filter((b) => b.prelude === selector).map((b) => declarations(b.body)))
}

const px = (value: string | undefined) => Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? Number.NaN)
const token = (name: string) => px(rule(tokensCss, ':root')[name])

/** The landscape phone too short for the nav row on top of chip + dock + transport (568×320). */
const shortLandscape = (q: string) => /orientation: landscape/.test(q) && /max-height: 359px/.test(q)

describe('nav.css — short landscape phone (568×320)', () => {
  const nav = rule(navCss, '.is-compact .nav-controls', shortLandscape)

  it('takes the nav out of the cluster flow: a column on the cluster’s right edge', () => {
    expect(nav.position).toBe('absolute')
    expect(nav['flex-direction']).toBe('column')
    expect(nav.right).toBe('0')
    // the landscape .cluster-stack > * width rule must not stretch the column
    expect(nav.width).toBe('auto')
  })

  it('starts the column on the mode-tab line, beside the tabs instead of under them', () => {
    const tabsTop = rule(modeTabsCss, '.is-compact .mode-tabs').top
    expect(tabsTop).toBe('calc(34px + var(--safe-top))')
    expect(nav.top).toBe('calc(var(--safe-top) + 34px - var(--compact-top))')
  })

  it('fits the five-button column between the tab line and the attribution row at 320 px', () => {
    const tap = token('--tap')
    const gap = px(rule(navCss, '.nav-controls').gap)
    const column = 5 * tap + 4 * gap
    expect(column).toBeGreaterThan(0)
    expect(34 + column).toBeLessThanOrEqual(320 - token('--credits-row'))
  })

  it('makes the cluster stack yield a lane as wide as the column plus a gap', () => {
    const stack = rule(navCss, '.is-compact .cluster-stack:has(> .nav-controls)', shortLandscape)
    expect(stack['--nav-lane']).toBe('calc(var(--tap) + var(--sp-2))')
    // only as much as the 640px-capped stack (cluster.css) still needs
    expect(stack['padding-right']).toBe('clamp(0px, calc(640px + 2 * var(--nav-lane) - 100%), var(--nav-lane))')
  })

  it('puts the locate message left of the column at the cluster top, clear of the tabs', () => {
    expect(rule(navCss, '.is-compact .nav-locate', shortLandscape).position).toBe('static')
    const message = rule(navCss, '.is-compact .nav-message', shortLandscape)
    expect(message.top).toBe('calc(var(--compact-top) - var(--safe-top) - 34px)')
    expect(message.right).toBe('calc(100% + var(--sp-2))')
    expect(message.bottom).toBe('auto')
    expect(message.transform).toBe('none')
  })
})

describe('nav.css — tokens only', () => {
  it('holds no colour literals', () => {
    expect(navCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})
