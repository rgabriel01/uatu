// Opens a full-size overlay when a tile is clicked. Plain DOM, no framework:
// the page has no bundler, so this ships as-is.
(function () {
  const dialog = document.getElementById('lightbox')
  const image = document.getElementById('lightbox-image')
  if (!dialog || !image) return

  // Index into the tiles as they currently appear. Recomputed on each open because
  // HTMX replaces the grid contents on shuffle and appends on scroll.
  let tiles = []
  let current = -1

  function show(index) {
    if (index < 0 || index >= tiles.length) return
    current = index
    const tile = tiles[current]
    image.src = tile.src
    image.alt = tile.alt
  }

  // Delegated from document, so tiles added by HTMX after load still work.
  document.addEventListener('click', function (event) {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || !target.dataset.name) return

    tiles = Array.from(document.querySelectorAll('#grid img[data-name]'))
    show(tiles.indexOf(target))
    dialog.showModal()
  })

  document.addEventListener('keydown', function (event) {
    if (!dialog.open) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      show(current + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      show(current - 1)
    }
  })

  // Clicking the backdrop closes; clicking the image itself does not.
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close()
  })
})()
