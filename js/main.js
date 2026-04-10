/**
 * main.js — Loads content from content.yaml and renders it into the page.
 * Supports: he (Hebrew, RTL), en (English, LTR), ru (Russian, LTR).
 * Extended with service modals.
 */

let currentLang = 'he';
let siteContent = null;
let activeServiceIndex = null;

function t(obj, lang) {
  if (!obj) return '';
  return obj[lang] || obj['he'] || '';
}

async function loadContent() {
  try {
    const response = await fetch('/content/content.yaml');
    const yamlText = await response.text();
    siteContent = jsyaml.load(yamlText);
    renderContent(currentLang);
  } catch (err) {
    console.error('Failed to load content:', err);
  }
}

function renderContent(lang) {
  if (!siteContent) return;
  const c = siteContent;

  document.title = t(c.site.title, lang);

  document.querySelectorAll('[data-content="nav.about"]').forEach(el => el.textContent = t(c.nav.about, lang));
  document.querySelectorAll('[data-content="nav.services"]').forEach(el => el.textContent = t(c.nav.services, lang));
  document.querySelectorAll('[data-content="nav.process"]').forEach(el => el.textContent = t(c.nav.process, lang));
  document.querySelectorAll('[data-content="nav.contact"]').forEach(el => el.textContent = t(c.nav.contact, lang));

  setText('hero.title', t(c.hero.title, lang));
  setText('hero.subtitle', t(c.hero.subtitle, lang));
  setText('hero.description', t(c.hero.description, lang));
  setText('hero.cta_primary', t(c.hero.cta_primary, lang));
  setText('hero.cta_secondary', t(c.hero.cta_secondary, lang));
  setText('hero.portrait_placeholder', t(c.hero.portrait_placeholder, lang));

  setText('clients.title', t(c.clients.title, lang));
  setText('clients.subtitle', t(c.clients.subtitle, lang));
  renderClientsStrip(c.clients.items);

  setText('about.title', t(c.about.title, lang));
  setText('about.photo_placeholder', t(c.about.photo_placeholder, lang));
  renderAboutParagraphs(c.about.paragraphs, lang);

  setText('services.title', t(c.services.title, lang));
  renderServices(c.services.items, lang);

  setText('audience.title', t(c.audience.title, lang));
  setText('audience.subtitle', t(c.audience.subtitle, lang));
  renderAudience(c.audience.items, lang);

  setText('why.title', t(c.why.title, lang));
  setText('why.text', t(c.why.text, lang));

  setText('process.title', t(c.process.title, lang));
  renderProcess(c.process.steps, lang);

  setText('trust.title', t(c.trust.title, lang));
  setText('trust.text', t(c.trust.text, lang));

  setText('final_cta.title', t(c.final_cta.title, lang));
  setText('final_cta.text', t(c.final_cta.text, lang));
  setText('final_cta.cta_primary', t(c.final_cta.cta_primary, lang));
  setText('final_cta.cta_secondary', t(c.final_cta.cta_secondary, lang));

  setText('footer.rights', t(c.footer.rights, lang));

  if (activeServiceIndex !== null) {
    openServiceModal(activeServiceIndex);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function setText(key, value) {
  const el = document.querySelector(`[data-content="${key}"]`);
  if (el) el.textContent = value;
}

function renderClientsStrip(items) {
  const container = document.getElementById('clients-strip');
  if (!container || !items || !items.length) return;

  const oneSetHtml = items.map(item => {
    const name = typeof item.name === 'object' ? t(item.name, currentLang) : (item.name || '');
    const logo = item.logo || '';

    return `
      <div class="client-item" aria-label="${name}">
        <div class="client-logo-box">
          <img
            src="${logo}"
            alt="${name}"
            class="client-logo-image"
            loading="lazy"
          />
        </div>
        <span class="client-logo-name">${name}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="clients-marquee-inner">
      <div class="marquee-track">${oneSetHtml}</div>
      <div class="marquee-track" aria-hidden="true">${oneSetHtml}</div>
    </div>
  `;
}

function renderAboutParagraphs(paragraphs, lang) {
  const container = document.getElementById('about-paragraphs');
  if (!container || !paragraphs) return;
  container.innerHTML = paragraphs.map(p =>
    `<p class="about-paragraph-theme font-light leading-relaxed">${t(p, lang)}</p>`
  ).join('');
}

function renderServices(items, lang) {
  const container = document.getElementById('services-list');
  if (!container || !items) return;

  container.innerHTML = items.map((item, index) =>
    `<button type="button" class="service-row fade-up visible service-card-theme p-6 w-full text-start cursor-pointer"
      onclick="openServiceModal(${index})">
      <h3 class="font-semibold text-lg mb-2 service-card-title-theme">${t(item.title, lang)}</h3>
      <p class="text-sm font-light leading-relaxed service-card-description-theme">${t(item.description, lang)}</p>
    </button>`
  ).join('');
}

function renderAudience(items, lang) {
  const container = document.getElementById('audience-list');
  if (!container || !items) return;
  container.innerHTML = items.map(item =>
    `<div class="audience-card p-5 rounded-xl audience-card-theme">${t(item, lang)}</div>`
  ).join('');
}

function renderProcess(steps, lang) {
  const container = document.getElementById('process-list');
  if (!container || !steps) return;
  container.innerHTML = steps.map(step =>
    `<div class="process-card rounded-xl p-5 process-card-theme">
      <div class="font-bold mb-3 process-step-number-theme">${step.number}</div>
      <h3 class="font-semibold mb-2 process-step-title-theme">${t(step.title, lang)}</h3>
      <p class="text-sm font-light process-step-description-theme">${t(step.description, lang)}</p>
    </div>`
  ).join('');
}

function openServiceModal(index) {
  if (!siteContent || !siteContent.services || !siteContent.services.items[index]) return;

  activeServiceIndex = index;
  const item = siteContent.services.items[index];
  const details = item.details || {};

  const contactWrap = document.getElementById('modal-contact-wrap');
  const contactButton = document.getElementById('modal-contact-button');
  const modal = document.getElementById('service-modal');
  const title = document.getElementById('modal-title');
  const summary = document.getElementById('modal-summary');
  const techPoints = document.getElementById('modal-tech-points');
  const secondTechPoints = document.getElementById('modal-second-tech-points');
  const body = document.getElementById('modal-body');
  const videoWrap = document.getElementById('modal-video-wrap');
  const videoTitle = document.getElementById('modal-video-title');
  const videoFrame = document.getElementById('modal-video-frame');
  const videoLink = document.getElementById('modal-video-link');

  title.textContent = t(item.title, currentLang);
  summary.textContent = t(details.summary, currentLang);

  const techItems = details.tech_points || [];
  techPoints.innerHTML = techItems.map(point =>
    `<li class="leading-relaxed modal-list-item-theme">${t(point, currentLang)}</li>`
  ).join('');

  const secondTechItems = details.second_tech_points || [];
  secondTechPoints.innerHTML = secondTechItems.map(point =>
    `<li class="leading-relaxed modal-list-item-theme">${t(point, currentLang)}</li>`
  ).join('');

  const bodyItems = details.body || [];
  body.innerHTML = bodyItems.map(par =>
    `<p class="leading-relaxed modal-body-paragraph-theme">${t(par, currentLang)}</p>`
  ).join('');

  const contactCta = details.contact_cta || null;

  if (contactCta && contactButton && contactWrap) {
    contactWrap.classList.remove('hidden');
    contactButton.textContent = t(contactCta.label, currentLang) || 'צרו קשר';
    contactButton.href = t(contactCta.href, currentLang) || 'https://wa.me/972547838645';
  } else if (contactButton && contactWrap) {
    contactWrap.classList.add('hidden');
    contactButton.textContent = '';
    contactButton.href = '#';
  }

  if (details.video) {
    videoWrap.classList.remove('hidden');
    videoTitle.textContent = t(details.video.title, currentLang) || '';
    const embed = details.video.embed || '';
    const link = details.video.link || '#';

    if (embed) {
      videoFrame.innerHTML = `<iframe src="${embed}" class="w-full aspect-video rounded-xl modal-video-frame-theme" allowfullscreen loading="lazy"></iframe>`;
    } else {
      videoFrame.innerHTML = '';
    }

    videoLink.href = link;
  } else {
    videoWrap.classList.add('hidden');
    videoFrame.innerHTML = '';
    videoLink.href = '#';
  }

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeServiceModal() {
  const modal = document.getElementById('service-modal');
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  activeServiceIndex = null;
}

function switchLang(lang) {
  currentLang = lang;
  const html = document.documentElement;

  if (lang === 'he') {
    html.setAttribute('dir', 'rtl');
    html.setAttribute('lang', 'he');
  } else {
    html.setAttribute('dir', 'ltr');
    html.setAttribute('lang', lang);
  }

  ['he', 'en', 'ru'].forEach(code => {
    const btn = document.getElementById('btn-' + code);
    if (btn) btn.classList.toggle('active', code === lang);
  });

  renderContent(lang);
}

function toggleMobile() {
  document.getElementById('mobile-nav').classList.toggle('hidden');
}

function closeMobile() {
  document.getElementById('mobile-nav').classList.add('hidden');
}

function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeServiceModal();
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  const modal = document.getElementById('service-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeServiceModal();
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  initAnimations();
  loadContent();
});