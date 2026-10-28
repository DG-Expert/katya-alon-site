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
      document.documentElement.classList.add('viewer-open');
      viewer.showModal();
      viewer.querySelector('.results-viewer-scroll').scrollTo(0, 0);
      viewer.querySelector('[data-gallery-close]').focus();
    } else if (event.target === viewer || event.target.closest?.('[data-gallery-close]')) {
      viewer.close();
    }
  });

  // One cleanup for every close route (Escape, button, backdrop): unlock page scroll and return focus to the thumbnail.
  viewer.addEventListener('close', () => {
    document.documentElement.classList.remove('viewer-open');
    image.removeAttribute('src');
    opener?.focus();
  });
})();
