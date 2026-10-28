function toggleArticleMenu() {
  const menu = document.getElementById('mobile-nav');
  const button = document.getElementById('mobile-menu-button');
  if (!menu || !button) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
}

document.addEventListener('click', event => {
  if (event.target.closest('#mobile-nav a')) {
    const menu = document.getElementById('mobile-nav');
    const button = document.getElementById('mobile-menu-button');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = document.getElementById('mobile-nav');
  const button = document.getElementById('mobile-menu-button');
  if (menu) menu.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
});

document.querySelectorAll('[data-current-year]').forEach(element => {
  element.textContent = String(new Date().getFullYear());
});
