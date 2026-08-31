// Full-size image viewer with a timed slideshow, plus the settings dialog that
// configures its interval. Plain DOM, no framework: the page has no bundler, so this
// ships as-is. Settings live here rather than in their own file because the interval
// has exactly one consumer -- the slideshow below.
(function () {
  const DEFAULT_INTERVAL_SECONDS = 6
  const MIN_INTERVAL_SECONDS = 1
  const MAX_INTERVAL_SECONDS = 60
  const STORAGE_KEY = 'uatu:slideshow-interval'

  const dialog = document.getElementById('lightbox')
  const image = document.getElementById('lightbox-image')
  if (!dialog || !image) return

  function clampInterval(seconds) {
    return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)))
  }

  // localStorage throws in some privacy modes, so every access is guarded and falls
  // back to the default rather than breaking the viewer.
  function readInterval() {
    try {
      const seconds = Number(window.localStorage.getItem(STORAGE_KEY))
      return Number.isFinite(seconds) && seconds > 0 ? clampInterval(seconds) : DEFAULT_INTERVAL_SECONDS
    } catch {
      return DEFAULT_INTERVAL_SECONDS
    }
  }

  function writeInterval(seconds) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clampInterval(seconds)))
    } catch {
      // Non-persistent session; the in-page value still applies until reload.
    }
  }

  // Index into the tiles as they currently appear. Recomputed on each open because
  // HTMX replaces the grid contents on shuffle and appends on scroll.
  let tiles = []
  let current = -1
  let timer = null

  function show(index) {
    if (index < 0 || index >= tiles.length) return
    current = index
    const tile = tiles[current]
    image.src = tile.src
    image.alt = tile.alt

    if (window.htmx) {
      window.htmx.ajax('GET', '/images/' + encodeURIComponent(tile.dataset.name) + '/tags', {
        target: '#lightbox-tags',
        swap: 'innerHTML',
      })
    }
  }

  /** Moves by `delta`, wrapping around the ends so the slideshow never stalls. */
  function advance(delta) {
    if (tiles.length === 0) return
    show((current + delta + tiles.length) % tiles.length)
  }

  function stopAutoplay() {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  function startAutoplay() {
    stopAutoplay()
    timer = window.setInterval(() => advance(1), readInterval() * 1000)
  }

  // Exposed so the tag panel can hold the slideshow while the user types, without
  // reaching into the timer itself.
  window.uatuSlideshow = {
    pause: stopAutoplay,
    resume: function () {
      if (dialog.open) startAutoplay()
    },
  }

  // Delegated from document, so tiles added by HTMX after load still work.
  document.addEventListener('click', function (event) {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || !target.dataset.name) return

    tiles = Array.from(document.querySelectorAll('#grid img[data-name]'))
    show(tiles.indexOf(target))
    dialog.showModal()
    startAutoplay()
  })

  document.addEventListener('keydown', function (event) {
    if (!dialog.open) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      advance(1)
      startAutoplay() // a manual move earns a fresh full interval
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      advance(-1)
      startAutoplay()
    }
  })

  // Covers Escape and the close() below alike, so the timer can never outlive the view.
  dialog.addEventListener('close', stopAutoplay)

  // Clicking the backdrop closes; clicking the image itself does not.
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close()
  })

  const tagPanel = document.getElementById('lightbox-tags')
  if (tagPanel) {
    tagPanel.addEventListener('focusin', function () {
      window.uatuSlideshow.pause()
    })
    tagPanel.addEventListener('focusout', function (event) {
      // Only resume once focus has genuinely left the panel, not while moving
      // between the input and the Add button.
      if (!tagPanel.contains(event.relatedTarget)) window.uatuSlideshow.resume()
    })
  }

  // --- Settings ---------------------------------------------------------------

  const settings = document.getElementById('settings')
  const openSettings = document.getElementById('settings-open')
  const input = document.getElementById('interval-input')
  const menu = document.getElementById('settings-menu')
  const tagsDialog = document.getElementById('tags-dialog')
  const menuInterval = document.getElementById('menu-interval')
  const menuTags = document.getElementById('menu-tags')
  if (!settings || !openSettings || !input || !menu || !tagsDialog) return
  if (!menuInterval || !menuTags) return

  openSettings.addEventListener('click', function () {
    menu.showModal()
  })

  menuInterval.addEventListener('click', function () {
    menu.close()
    input.value = String(readInterval())
    settings.showModal()
  })

  menuTags.addEventListener('click', function () {
    menu.close()
    tagsDialog.showModal()
    if (window.htmx) {
      window.htmx.ajax('GET', '/tags', { target: '#tags-dialog-body', swap: 'innerHTML' })
    }
  })

  // Backdrop click closes either dialog.
  for (const d of [menu, tagsDialog]) {
    d.addEventListener('click', function (event) {
      if (event.target === d) d.close()
    })
  }

  settings.addEventListener('close', function () {
    if (settings.returnValue !== 'save') return

    const seconds = Number(input.value)
    if (!Number.isFinite(seconds) || seconds <= 0) return

    writeInterval(seconds)
    // Apply at once if a slideshow is already running.
    if (dialog.open) startAutoplay()
  })
})()
