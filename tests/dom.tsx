/** Render helper: mount a component into a jsdom document and drive it. */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

// React only batches updates inside act() when the environment says so.
;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

/** One mounted tree and the handles a spec drives it with. */
export interface Mounted {
  /** The container the tree rendered into. */
  readonly container: HTMLElement
  /** Every element matching a selector, in document order. */
  all(selector: string): HTMLElement[]
  /** The first element matching a selector. */
  one(selector: string): HTMLElement
  /** The first input matching a selector. */
  input(selector: string): HTMLInputElement
  /** The rendered text of the whole tree. */
  text(): string
  /** Click one element and let the update settle. */
  click(element: Element): Promise<void>
  /** Type into an input the way a browser does, so a controlled value updates. */
  type(element: HTMLInputElement, text: string): Promise<void>
  /** Press a key on an element, with any modifiers the spec needs. */
  press(element: Element, key: string, init?: KeyboardEventInit): Promise<void>
  /** Settle pending promises and effects. */
  flush(): Promise<void>
  /** Unmount and remove the container. */
  unmount(): Promise<void>
}

/** Let effects and awaited promises settle. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

/**
 * Mount a tree into a fresh container attached to the document.
 * @param node - the element to render.
 * @returns the handles a spec drives the tree with.
 */
export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  await flush()
  return {
    container,
    all: (selector) => [...container.querySelectorAll(selector)] as HTMLElement[],
    one: (selector) => {
      const found = container.querySelector(selector)
      if (found === null) throw new Error(`expected an element matching ${selector}`)
      return found as HTMLElement
    },
    input: (selector) => {
      const found = container.querySelector(selector)
      if (found === null) throw new Error(`expected an input matching ${selector}`)
      return found as HTMLInputElement
    },
    text: () => container.textContent ?? '',
    click: async (element) => {
      await act(async () => { (element as HTMLElement).click() })
      await flush()
    },
    type: async (element, text) => {
      // React tracks the DOM value itself, so the native setter is what a real
      // keystroke goes through; assigning `element.value` would be ignored.
      await act(async () => {
        // Reflect.set on the prototype runs that setter with the element as its
        // receiver, which leaves React's instance-level value tracker stale; plain
        // `element.value = text` would update the tracker and the event would then
        // read as no change.
        Reflect.set(HTMLInputElement.prototype, 'value', text, element)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await flush()
    },
    press: async (element, key, init = {}) => {
      await act(async () => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
      })
      await flush()
    },
    flush,
    unmount: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

/**
 * Assert a value a spec expects to exist, so specs need no non-null assertion.
 * @param value - the value under test.
 * @returns the same value with `null` and `undefined` removed.
 * @throws {Error} when the value is absent.
 */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value, got nothing')
  return value
}
