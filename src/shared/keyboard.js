/** Shared by the app and the framework-free public help script. No build-machine OS detection. */
export function createKeyboardLabels(nav) {
  var hint = nav && nav.userAgentData && nav.userAgentData.platform
  var platform = hint || (nav && nav.platform) || (nav && nav.userAgent) || ''
  var mac = /Mac|iPhone|iPad|iPod/i.test(platform)
  var os = mac ? 'mac' : /Win/i.test(platform) ? 'windows' : 'other'
  var names = { Mod: mac ? '⌘' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift', Control: mac ? '⌃' : 'Ctrl' }
  function label(keys) {
    // Both canonical Mod+Shift+K and older engraved labels use the same renderer.
    if (keys === '+') return keys
    var normalized = keys.replace(/[⌘⌥⇧⌃]/g, function (g) { return { '⌘': 'Mod+', '⌥': 'Alt+', '⇧': 'Shift+', '⌃': 'Control+' }[g] })
    if (/[⌘⌥⇧⌃]$/.test(keys)) normalized = normalized.slice(0, -1)
    var parts = normalized.split('+')
    if (normalized.endsWith('++')) parts.splice(-2, 2, '+')
    return parts.map(function (p) { return Object.prototype.hasOwnProperty.call(names, p) ? names[p] : p }).join(mac ? '' : '+')
  }
  function text(value) {
    // Only authored UI/help prose calls this; never the interpolated user input, URLs or source code.
    value = value.replace(/⌘\/(?:Ctrl|Strg)(?=-)/g, function () { return label('Mod') })
    value = value.replace(/⌘\/(?:Ctrl|Strg)\+([A-Z])/g, function (_, key) { return label('Mod+' + key) })
    value = value.replace(/⌘([A-Z.])\s*\/\s*(?:Ctrl|Strg)\+\1/g, function (_, key) { return label('Mod+' + key) })
    value = value.replace(/\b(?:Mod|Alt|Shift|Control)(?:\+(?:Mod|Alt|Shift|Control))*\+(?:Backspace|Delete|Enter|Space|Tab|Esc|F[0-9]{1,2}|[A-Z0-9↵←→↑↓.,/\\])/g, label)
    return value.replace(/[⌘⌥⇧⌃]+(?:Esc|Enter|Backspace|Delete|[A-Z0-9↵←→↑↓.,/\\])?/g, function (keys) {
      // A bare Command glyph denotes the database's command button, not a keyboard chord.
      return keys === '⌘' ? keys : label(keys)
    })
  }
  return { os: os, isMac: mac, label: label, text: text }
}
