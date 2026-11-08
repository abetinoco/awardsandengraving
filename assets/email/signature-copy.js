/* Copy buttons for /email-signature. Kept out of the page because the site's
   Content-Security-Policy blocks inline scripts. */
(function () {
  function source(sig) {
    var html = sig.innerHTML
    var start = html.indexOf('<table')
    var end = html.lastIndexOf('</table>') + 8
    return html.slice(start, end)
  }
  function say(status, text) {
    status.textContent = text
    clearTimeout(status.timer)
    status.timer = setTimeout(function () { status.textContent = '' }, 4000)
  }
  function copySelection(sig) {
    var range = document.createRange()
    range.selectNodeContents(sig)
    var selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    var ok = document.execCommand('copy')
    selection.removeAllRanges()
    return ok
  }
  function copyText(text) {
    var area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    var ok = document.execCommand('copy')
    area.remove()
    return ok
  }
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var sig = document.getElementById(button.getAttribute('data-sig'))
      var status = button.parentNode.querySelector('.status')
      var rich = button.getAttribute('data-copy') === 'rich'
      var html = source(sig)
      var done = 'Copied. Paste it into your signature settings.'
      if (rich && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([sig.innerText.trim()], { type: 'text/plain' }),
        })]).then(function () { say(status, done) }, function () {
          say(status, copySelection(sig) ? done : 'Select the signature and copy it by hand.')
        })
      } else if (rich) {
        say(status, copySelection(sig) ? done : 'Select the signature and copy it by hand.')
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(html).then(function () { say(status, 'HTML copied.') }, function () { say(status, copyText(html) ? 'HTML copied.' : 'Copy failed.') })
      } else {
        say(status, copyText(html) ? 'HTML copied.' : 'Copy failed.')
      }
    })
  })
})()
