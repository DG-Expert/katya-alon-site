// Results gallery viewer (paid-advertising page). Thumbnails are plain links to the full image, so without JS they still open it.
(() => {
  const viewer = document.querySelector('[data-gallery-viewer]');
  if (!viewer || typeof viewer.showModal !== 'function') return;
  const image = viewer.querySelector('[data-gallery-image]');
  let opener = null;

  document.addEventListener('click', event => {
    const link = event.target.closest?.('[data-gallery-link]');
    if (link) {
      event.preventDefault();
      opener = link;
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      document.body.classList.add('viewer-open');
      viewer.showModal();
      viewer.querySelector('[data-gallery-close]').focus();
    } else if (event.target === viewer || event.target.closest?.('[data-gallery-close]')) {
      viewer.close();
    }
  });

  // Escape closes natively (dialog); focus returns to the thumbnail that opened it.
  viewer.addEventListener('close', () => {
    document.body.classList.remove('viewer-open');
    image.removeAttribute('src');
    opener?.focus();
  });
})();
