// CSS rules of the page stylesheets that apply to an element, with their lines in the css files.
// The server parses the files (/e-dev/css-rules), the element is matched here with element.matches().

const rulesOfSheet = new Map() // url → Promise of [{ selector, line, column }]

// States and pseudo-elements are removed from selectors: `button:hover::after` applies to the button
const DYNAMIC_PSEUDO = /::?(?:hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled|placeholder-shown|popover-open|modal|open|closed|user-invalid|user-valid|invalid|valid|autofill|before|after|backdrop|placeholder|marker|selection|first-line|first-letter|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(?![\w-])(?:\([^)]*\))?/g

function sheetUrls() {
  const urls = []
  for (const sheet of document.styleSheets) {
    if (!sheet.href) continue
    const url = new URL(sheet.href)
    if (url.origin === window.location.origin) urls.push(url.pathname)
  }
  return [...new Set(urls)]
}

function rulesOf(url) {
  if (!rulesOfSheet.has(url)) {
    rulesOfSheet.set(url, fetch(`/e-dev/css-rules?url=${encodeURIComponent(url)}`)
      .then(response => response.ok ? response.json() : { rules: [] })
      .then(body => (body.rules || []).map(rule => ({ ...rule, file: body.file })))
      .catch(() => []))
  }
  return rulesOfSheet.get(url)
}

// Splits "a, b:is(c, d)" on top-level commas
function splitSelectors(selector) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts.filter(Boolean)
}

function matches(element, selector) {
  const plain = selector.replace(DYNAMIC_PSEUDO, '').trim()
  // Rules for everything (*, ::before, :focus-visible...) say nothing about the element
  if (!plain || /^[*\s>+~]*$/.test(plain)) return false
  try {
    return element.matches(plain)
  } catch {
    return false
  }
}

/**
 * @param {Element} element
 * @returns {Promise<{ selector: string, src: string }[]>} in the order of the stylesheets
 */
export async function stylesOf(element) {
  const result = []
  for (const url of sheetUrls()) {
    for (const rule of await rulesOf(url)) {
      const matched = splitSelectors(rule.selector).filter(part => matches(element, part))
      if (matched.length) {
        result.push({ selector: matched.join(', '), src: `${rule.file}:${rule.line}:${rule.column}` })
      }
    }
  }
  return result
}
