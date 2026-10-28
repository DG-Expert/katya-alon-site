// Services disclosure in the shared site navigation (markup: siteNav in scripts/build-pages.mjs).
// Click, tap, Enter or Space toggles it; Escape, outside taps, link clicks and tabbing away close it.
(() => {
  const toggles = () => document.querySelectorAll('[data-nav-dropdown]');

  function setOpen(button, open) {
    button.setAttribute('aria-expanded', String(open));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
  }

  const closeAllExcept = keep => toggles().forEach(button => {
    if (button !== keep) setOpen(button, false);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-nav-dropdown]');
    closeAllExcept(button);
    if (button) setOpen(button, button.getAttribute('aria-expanded') !== 'true');
  });

  // iOS Safari fires no click for taps on non-interactive areas, so outside taps close on pointerdown.
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest?.('.nav-dropdown')) closeAllExcept(null);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    toggles().forEach(button => {
      if (button.getAttribute('aria-expanded') !== 'true') return;
      const hadFocus = button.parentElement.contains(document.activeElement);
      setOpen(button, false);
      if (hadFocus) button.focus();
    });
  });

  document.addEventListener('focusout', event => {
    const dropdown = event.target.closest?.('.nav-dropdown');
    if (dropdown && event.relatedTarget && !dropdown.contains(event.relatedTarget)) {
      setOpen(dropdown.querySelector('[data-nav-dropdown]'), false);
    }
  });
})();
