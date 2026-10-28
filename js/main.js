/**
 * main.js — Loads content from content.yaml and renders it into the page.
 * Supports: he (Hebrew, RTL), en (English, LTR), ru (Russian, LTR).
 * Extended with service modals.
 */

let currentLang = 'he';
let siteContent = null;
let siteArticles = null;
let activeServiceIndex = null;
let activeRecommendationIndex = null;
let recommendationItemsCache = [];
const LANGUAGES = ['he', 'en', 'ru'];

function languageFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/(en|ru)(?:\/|$)/);
  return match ? match[1] : 'he';
}

function homePath(lang) {
  return lang === 'he' ? '/' : `/${lang}/`;
}

function workshopsPath(lang) {
  return lang === 'he' ? '/workshops.html' : `/${lang}/workshops.html`;
}

function articlesPath(lang) {
  return lang === 'he' ? '/articles/' : `/${lang}/articles/`;
}

function articlePath(lang, slug) {
  return `${articlesPath(lang)}${slug}/`;
}

function servicePath(lang, slug) {
  return `${homePath(lang)}services/${slug}/`;
}

function redirectLegacyLanguage() {
  const url = new URL(window.location.href);
  const lang = url.searchParams.get('lang');
  if (!LANGUAGES.includes(lang)) return false;
  url.pathname = homePath(lang);
  url.searchParams.delete('lang');
  url.searchParams.delete('layout');
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
  return true;
}

function rootAssetPath(value) {
  return typeof value === 'string' && value.startsWith('./assets/') ? value.slice(1) : value;
}

function t(obj, lang) {
  if (!obj) return '';
  return obj[lang] || obj['he'] || '';
}

async function loadContent() {
  try {
    const contentUrl = new URL('/content/content.yaml', window.location.origin);
    const articlesUrl = new URL('/content/articles.yaml', window.location.origin);
    const [contentResponse, articlesResponse] = await Promise.all([fetch(contentUrl), fetch(articlesUrl)]);
    if (!contentResponse.ok) throw new Error(`Failed to load content.yaml: ${contentResponse.status}`);
    if (!articlesResponse.ok) throw new Error(`Failed to load articles.yaml: ${articlesResponse.status}`);
    siteContent = jsyaml.load(await contentResponse.text());
    siteArticles = jsyaml.load(await articlesResponse.text());
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
  document.querySelectorAll('[data-content="nav.workshops"]').forEach(el => el.textContent = t(c.nav.workshops, lang));
  updatePageLinks(lang);

  setText('hero.name', t(c.hero.name, lang));
  setText('hero.professional_title', t(c.hero.professional_title, lang));
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
  renderTrustFacts(c.trust_facts, lang);

  setText('services.title', t(c.services.title, lang));
  setText('services.includes_title', t(c.services.includes_title, lang));
  setText('services.results_title', t(c.services.results_title, lang));
  renderServices(c.services.items, lang);

  setText('audience.title', t(c.audience.title, lang));
  setText('audience.subtitle', t(c.audience.subtitle, lang));
  renderAudience(c.audience.items, lang);

  setText('recommendations.title', t(c.recommendations.title, lang));
  setText('recommendations.subtitle', t(c.recommendations.subtitle, lang));
  renderRecommendationsStrip(c.recommendations.items, lang);

  setText('process.title', t(c.process.title, lang));
  renderProcess(c.process.steps, lang);

  setText('trust.title', t(c.trust.title, lang));
  setText('trust.text', t(c.trust.text, lang));

  setText('final_cta.title', t(c.final_cta.title, lang));
  setText('final_cta.text', t(c.final_cta.text, lang));
  setText('final_cta.cta_primary', t(c.final_cta.cta_primary, lang));
  setText('final_cta.cta_secondary', t(c.final_cta.cta_secondary, lang));

  setText('articles_section.title', t(c.articles_section.title, lang));
  setText('articles_section.intro', t(c.articles_section.intro, lang));
  setText('articles_section.all_articles', t(c.articles_section.all_articles, lang));
  renderHomeArticles(siteArticles?.articles, lang);

  setText('footer.summary', t(c.footer.summary, lang));
  setText('footer.navigation_label', t(c.footer.navigation_label, lang));
  setText('footer.services_label', t(c.footer.services_label, lang));
  setText('footer.contact_label', t(c.footer.contact_label, lang));
  setText('footer.home', t(c.footer.home, lang));
  setText('footer.articles', t(c.footer.articles, lang));
  setText('footer.privacy_notice', t(c.footer.privacy_notice, lang));
  setText('footer.whatsapp', t(c.footer.whatsapp, lang));
  setText('footer.email', t(c.footer.email, lang));
  setText('footer.instagram', t(c.footer.instagram, lang));
  setText('footer.facebook', t(c.footer.facebook, lang));
  setText('footer.rights', t(c.footer.rights, lang));

  if (activeServiceIndex !== null) {
    openServiceModal(activeServiceIndex);
  }

  if (activeRecommendationIndex !== null) {
    openRecommendationModal(activeRecommendationIndex);
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
    const logo = rootAssetPath(item.logo || '');

    return `
      <div class="client-item" aria-label="${name}">
        <div class="client-logo-box">
          <img
            src="${logo}"
            alt="${name}"
            class="client-logo-image"
            width="200"
            height="200"
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

function renderRecommendationsStrip(items, lang) {
  const container = document.getElementById('recommendations-strip');
  if (!container || !items || !items.length) return;

  recommendationItemsCache = items;

  const openLabel = t(siteContent?.recommendations?.open_label, lang) || 'לחצו לצפייה';

  const recommendationHtml = isDuplicate => items.map((item, index) => {
    return `
      <button
        type="button"
        class="recommendation-item"
        onclick="openRecommendationModal(${index})"
        aria-label="${openLabel}"
        ${isDuplicate ? 'tabindex="-1"' : ''}
      >
        <span class="recommendation-envelope-box">
          <img
            src="${rootAssetPath(item.envelope)}"
            alt=""
            class="recommendation-envelope-image"
            width="200"
            height="200"
            loading="lazy"
          />
        </span>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="recommendations-marquee-inner">
      <div class="recommendations-track">${recommendationHtml(false)}</div>
      <div class="recommendations-track" aria-hidden="true">${recommendationHtml(true)}</div>
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

function renderTrustFacts(facts, lang) {
  const container = document.getElementById('trust-facts');
  if (!container || !facts) return;
  container.innerHTML = facts.map(fact => `<li><strong>${fact.value}</strong><span>${t(fact.label, lang)}</span></li>`).join('');
}

function renderServices(items, lang) {
  const container = document.getElementById('services-list');
  if (!container || !items) return;

  const visibleItems = items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item.enabled !== false)
    .sort((a, b) => a.item.display_order - b.item.display_order);

  container.innerHTML = visibleItems.map(({ item, sourceIndex }, index) => {
    const positionClass = `service-card-pos-${index + 1}`;
    return `
      <button
        id="${item.anchor}"
        type="button"
        class="service-row fade-up visible service-card-theme text-start cursor-pointer ${positionClass}"
        data-service-index="${sourceIndex}"
        onclick="openServiceModal(${sourceIndex})"
      >
        <span class="service-card-shell">
          <span class="service-card-base" aria-hidden="true"></span>
          <span class="service-card-circles" aria-hidden="true"></span>
          <span class="service-card-holo-bg" aria-hidden="true"></span>
          <span class="service-card-holo-lines" aria-hidden="true"></span>

          <span class="service-card-content">
            <span class="service-card-title service-card-title-theme">${t(item.title, lang)}</span>
            <span class="service-card-description service-card-description-theme">${t(item.description, lang)}</span>
          </span>
        </span>
      </button>
    `;
  }).join('');

  setupServicesDiagram();
}

const SERVICES_RADIAL_BREAKPOINT = 1200;
const SERVICES_RADIAL_CARD_COUNT = 5;

// The radial scene needs a wide viewport and hover; touch tablets get the bounded card grid.
function shouldUseServicesRadial(cards) {
  return window.innerWidth >= SERVICES_RADIAL_BREAKPOINT
    && cards.length === SERVICES_RADIAL_CARD_COUNT
    && Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);
}

const servicesSceneState = {
  activeIndex: -1,
  localX: 0,
  localY: 0,
  bound: false,
  resizeBound: false
};

function setupServicesDiagram() {
  const section = document.getElementById('services');
  const diagram = document.getElementById('services-diagram');
  const list = document.getElementById('services-list');
  if (!section || !diagram || !list) return;

  const cards = Array.from(list.querySelectorAll('.service-row'));
  const isRadial = shouldUseServicesRadial(cards);

  section.classList.toggle('services-layout-radial', isRadial);
  clearServicesDiagramEffect();

  cards.forEach((card) => {
    resetServiceCardHolographic(card);
  });

  if (!servicesSceneState.bound) {
    diagram.addEventListener('pointermove', handleServicesDiagramPointerMove);
    diagram.addEventListener('pointerleave', handleServicesDiagramPointerLeave);
    diagram.addEventListener('pointercancel', handleServicesDiagramPointerLeave);
    servicesSceneState.bound = true;
  }

  if (!servicesSceneState.resizeBound) {
    window.addEventListener('resize', handleServicesDiagramResize, { passive: true });
    servicesSceneState.resizeBound = true;
  }
}

function handleServicesDiagramResize() {
  const section = document.getElementById('services');
  const list = document.getElementById('services-list');
  if (!section || !list) return;

  const cards = Array.from(list.querySelectorAll('.service-row'));
  const isRadial = shouldUseServicesRadial(cards);

  section.classList.toggle('services-layout-radial', isRadial);

  servicesSceneState.activeIndex = -1;
  servicesSceneState.localX = 0;
  servicesSceneState.localY = 0;

  clearServicesDiagramEffect();
}

function handleServicesDiagramPointerMove(event) {
  const section = document.getElementById('services');
  const diagram = document.getElementById('services-diagram');
  const list = document.getElementById('services-list');

  if (!section || !diagram || !list || !section.classList.contains('services-layout-radial')) {
    clearServicesDiagramEffect();
    return;
  }

  const cards = Array.from(list.querySelectorAll('.service-row'));
  if (!shouldUseServicesRadial(cards)) {
    clearServicesDiagramEffect();
    return;
  }

  const hoveredCard = event.target.closest('.service-row');

  if (hoveredCard && list.contains(hoveredCard)) {
    servicesSceneState.activeIndex = Number(hoveredCard.dataset.serviceIndex);

    const rect = hoveredCard.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    const halfHeight = rect.height / 2;

    if (halfWidth && halfHeight) {
      servicesSceneState.localX = clamp(
        (event.clientX - (rect.left + halfWidth)) / halfWidth,
        -1,
        1
      );
      servicesSceneState.localY = clamp(
        (event.clientY - (rect.top + halfHeight)) / halfHeight,
        -1,
        1
      );
    }
  } else if (servicesSceneState.activeIndex === -1) {
    clearServicesDiagramEffect();
    return;
  } else {
    servicesSceneState.localX *= 0.84;
    servicesSceneState.localY *= 0.84;
  }

  const sceneRect = diagram.getBoundingClientRect();
  const sceneHalfWidth = sceneRect.width / 2;
  const sceneHalfHeight = sceneRect.height / 2;
  if (!sceneHalfWidth || !sceneHalfHeight) return;

  const sceneX = clamp(
    (event.clientX - (sceneRect.left + sceneHalfWidth)) / sceneHalfWidth,
    -1,
    1
  );
  const sceneY = clamp(
    (event.clientY - (sceneRect.top + sceneHalfHeight)) / sceneHalfHeight,
    -1,
    1
  );

  applyServicesGroupEffect(
    diagram,
    list,
    servicesSceneState.activeIndex,
    sceneX,
    sceneY,
    servicesSceneState.localX,
    servicesSceneState.localY
  );
}

function handleServicesDiagramPointerLeave() {
  servicesSceneState.activeIndex = -1;
  servicesSceneState.localX = 0;
  servicesSceneState.localY = 0;
  clearServicesDiagramEffect();
}

function getServicesCardVectors(diagram, cards) {
  const diagramRect = diagram.getBoundingClientRect();
  const centerX = diagramRect.left + (diagramRect.width / 2);
  const centerY = diagramRect.top + (diagramRect.height / 2);

  return cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const cardCenterX = rect.left + (rect.width / 2);
    const cardCenterY = rect.top + (rect.height / 2);

    const dx = cardCenterX - centerX;
    const dy = cardCenterY - centerY;
    const length = Math.hypot(dx, dy) || 1;

    return {
      x: dx / length,
      y: dy / length
    };
  });
}

function applyServicesGroupEffect(diagram, list, activeIndex, sceneX, sceneY, localX, localY) {
  const cards = Array.from(list.querySelectorAll('.service-row'));
  const lines = Array.from(diagram.querySelectorAll('.services-lines-path'));

  if (!cards.length || activeIndex < 0 || activeIndex >= cards.length) {
    clearServicesDiagramEffect();
    return;
  }

  const vectors = getServicesCardVectors(diagram, cards);
  const activeVector = vectors[activeIndex] || { x: 0, y: 0 };

  diagram.style.setProperty('--services-scene-shift-x', `${(-sceneX * 15).toFixed(2)}px`);
  diagram.style.setProperty('--services-scene-shift-y', `${(-sceneY * 15).toFixed(2)}px`);
  diagram.style.setProperty('--services-center-shift-x', `${(sceneX * 10 + activeVector.x * 1).toFixed(2)}px`);
  diagram.style.setProperty('--services-center-shift-y', `${(sceneY * 10 + activeVector.y * 1).toFixed(2)}px`);
  diagram.style.setProperty('--services-center-rotate-y', `${(sceneX * 15).toFixed(2)}deg`);
  diagram.style.setProperty('--services-center-rotate-x', `${(-sceneY * 15).toFixed(2)}deg`);
  diagram.style.setProperty('--services-center-scale', '1.05');
  diagram.style.setProperty('--services-lines-opacity', '1');
  diagram.style.setProperty('--services-core-scale', '1.05');

  cards.forEach((card, index) => {
    const vector = vectors[index] || { x: 0, y: 0 };
    const relation = clamp(
      (vector.x * activeVector.x) + (vector.y * activeVector.y),
      -1,
      1
    );

    const inverseStrength = (1 - relation) / 2;
    const sameSideStrength = 1 - inverseStrength;

    let shiftX = 0;
    let shiftY = 0;
    let depth = 0;
    let scale = 1;
    let hover = 0;
    let ratioX = 0;
    let ratioY = 0;
    let zIndex = 1;

    if (index === activeIndex) {
      const outward = 16;

      shiftX = (vector.x * outward) + (localX * 8) + (sceneX * 4);
      shiftY = (vector.y * outward) + (localY * 7) + (sceneY * 4);
      depth = -20;
      scale = 0.972;
      hover = 1;
      ratioX = clamp(localX + (sceneX * 0.25), -1, 1);
      ratioY = clamp(localY + (sceneY * 0.25), -1, 1);
      zIndex = 4;
    } else {
      const awayFromActiveX = -activeVector.x * (4 + inverseStrength * 7);
      const awayFromActiveY = -activeVector.y * (4 + inverseStrength * 7);
      const ownBiasX = vector.x * (2 + sameSideStrength * 2.5);
      const ownBiasY = vector.y * (2 + sameSideStrength * 2.5);

      shiftX = awayFromActiveX + ownBiasX + (sceneX * 4.5);
      shiftY = awayFromActiveY + ownBiasY + (sceneY * 3.5);
      depth = 6 + (inverseStrength * 6);
      scale = 1 + (inverseStrength * 0.026) + (sameSideStrength * 0.008);
      hover = 0.12 + (inverseStrength * 0.18);
      ratioX = clamp(sceneX * (0.12 + inverseStrength * 0.08), -0.35, 0.35);
      ratioY = clamp(sceneY * (0.12 + inverseStrength * 0.08), -0.35, 0.35);
      zIndex = 1;
    }

    card.style.setProperty('--service-ratio-x', ratioX.toFixed(3));
    card.style.setProperty('--service-ratio-y', ratioY.toFixed(3));
    card.style.setProperty('--service-hover', hover.toFixed(3));
    card.style.setProperty('--service-group-x', `${shiftX.toFixed(2)}px`);
    card.style.setProperty('--service-group-y', `${shiftY.toFixed(2)}px`);
    card.style.setProperty('--service-group-depth', `${depth.toFixed(2)}px`);
    card.style.setProperty('--service-group-scale', scale.toFixed(3));
    card.style.setProperty('--service-group-z', String(zIndex));

    if (lines[index]) {
      const lineShiftX = (shiftX * 0.32) + (sceneX * 2);
      const lineShiftY = (shiftY * 0.32) + (sceneY * 2);
      const lineActive = index === activeIndex ? 1 : (0.24 + (inverseStrength * 0.42));

      lines[index].style.setProperty('--line-shift-x', `${lineShiftX.toFixed(2)}px`);
      lines[index].style.setProperty('--line-shift-y', `${lineShiftY.toFixed(2)}px`);
      lines[index].style.setProperty('--line-active', lineActive.toFixed(3));
    }
  });
}

function resetServiceCardHolographic(card) {
  if (!card) return;

  card.style.setProperty('--service-ratio-x', '0');
  card.style.setProperty('--service-ratio-y', '0');
  card.style.setProperty('--service-hover', '0');
  card.style.setProperty('--service-group-x', '0px');
  card.style.setProperty('--service-group-y', '0px');
  card.style.setProperty('--service-group-depth', '0px');
  card.style.setProperty('--service-group-scale', '1');
  card.style.setProperty('--service-group-z', '1');
}

function resetServiceConnectorLine(line) {
  if (!line) return;

  line.style.setProperty('--line-shift-x', '0px');
  line.style.setProperty('--line-shift-y', '0px');
  line.style.setProperty('--line-active', '0');
}

function clearServicesDiagramEffect() {
  const diagram = document.getElementById('services-diagram');

  document.querySelectorAll('#services-list .service-row').forEach((card) => {
    resetServiceCardHolographic(card);
  });

  document.querySelectorAll('#services-diagram .services-lines-path').forEach((line) => {
    resetServiceConnectorLine(line);
  });

  if (!diagram) return;

  diagram.style.setProperty('--services-scene-shift-x', '0px');
  diagram.style.setProperty('--services-scene-shift-y', '0px');
  diagram.style.setProperty('--services-center-shift-x', '0px');
  diagram.style.setProperty('--services-center-shift-y', '0px');
  diagram.style.setProperty('--services-center-rotate-x', '0deg');
  diagram.style.setProperty('--services-center-rotate-y', '0deg');
  diagram.style.setProperty('--services-center-scale', '1');
  diagram.style.setProperty('--services-lines-opacity', '0.84');
  diagram.style.setProperty('--services-core-scale', '1');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


function renderAudience(items, lang) {
  const container = document.getElementById('audience-list');
  if (!container || !items) return;
  container.innerHTML = items.map(item =>
    `<div class="audience-card p-5 rounded-xl audience-card-theme">${t(item, lang)}</div>`
  ).join('');
}

function renderHomeArticles(items, lang) {
  const container = document.getElementById('home-articles-list');
  if (!container || !items) return;
  const selected = [...items].sort((a, b) => a.order - b.order).slice(0, 3);
  container.innerHTML = selected.map(article => `
    <article class="article-card">
      <h3><a href="${articlePath(lang, article.slug)}">${t(article.title, lang)}</a></h3>
      <p>${t(article.meta_description, lang)}</p>
      <a class="article-card-link" href="${articlePath(lang, article.slug)}">${t(siteContent.articles_section.read_article, lang)}</a>
    </article>
  `).join('');
}

function renderProcess(steps, lang) {
  const container = document.getElementById('process-list');
  if (!container || !steps) return;

  const isHebrew = lang === 'he';
  const arrowSrc = isHebrew
    ? '/assets/images/leftArrow.png'
    : '/assets/images/rightArrow.png';

  const bulletImages = [
    '/assets/images/bullet_01.png',
    '/assets/images/bullet_02.png',
    '/assets/images/bullet_03.png',
    '/assets/images/bullet_04.png',
    '/assets/images/bullet_05.png',
    '/assets/images/bullet_06.png'
  ];

  container.setAttribute('dir', isHebrew ? 'rtl' : 'ltr');

  container.innerHTML = `
    <div class="process-flow-track">
      ${steps.map((step, index) => {
        const bulletSrc = bulletImages[index] || bulletImages[bulletImages.length - 1];
        const title = t(step.title, lang);
        const description = t(step.description, lang);

        const titleHtml = title
          ? `<h3 class="process-flow-step-title">${title}</h3>`
          : '';

        const descriptionHtml = description
          ? `<p class="process-flow-step-description">${description}</p>`
          : '';

        const arrowHtml = index < steps.length - 1
          ? `
            <div class="process-flow-arrow" aria-hidden="true">
              <img
                src="${arrowSrc}"
                alt=""
                class="process-flow-arrow-image"
                loading="lazy"
              />
            </div>
          `
          : '';

        return `
          <div class="process-flow-step">
            <div class="process-flow-bullet">
              <img
                src="${bulletSrc}"
                alt="Step ${index + 1}"
                class="process-flow-bullet-image"
                loading="lazy"
              />
            </div>

            <div class="process-flow-card">
              <div class="process-flow-card-inner">
                ${titleHtml}
                ${descriptionHtml}
              </div>
            </div>
          </div>

          ${arrowHtml}
        `;
      }).join('')}
    </div>
  `;
}

function openServiceModal(index) {
  if (!siteContent || !siteContent.services || !siteContent.services.items[index]) return;

  activeServiceIndex = index;
  const item = siteContent.services.items[index];
  const details = item.details || {};

  const serviceLink = document.getElementById('modal-service-link');
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

  // The WhatsApp contact CTA lives on the service page; the modal links there.
  serviceLink.textContent = t(siteContent.services.learn_more, currentLang);
  serviceLink.href = servicePath(currentLang, item.slug);

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

function openRecommendationModal(index) {
  if (!siteContent || !siteContent.recommendations || !recommendationItemsCache[index]) return;

  activeRecommendationIndex = index;

  const item = recommendationItemsCache[index];
  const modal = document.getElementById('recommendation-modal');
  const image = document.getElementById('recommendation-modal-image');

  if (!modal || !image) return;

  image.src = rootAssetPath(item.screenshot);
  image.alt = t(siteContent.recommendations.modal_image_alt, currentLang) || 'Recommendation screenshot';

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeRecommendationModal() {
  const modal = document.getElementById('recommendation-modal');
  const image = document.getElementById('recommendation-modal-image');

  if (modal) {
    modal.classList.add('hidden');
  }

  if (image) {
    image.src = '';
    image.alt = '';
  }

  document.body.classList.remove('overflow-hidden');
  activeRecommendationIndex = null;
}

function updatePageLinks(lang) {
  document.querySelectorAll('[data-workshops-link]').forEach(link => {
    link.href = `${workshopsPath(lang)}${link.hasAttribute('data-privacy-fragment') ? '#registration-privacy' : ''}`;
  });
  document.querySelectorAll('[data-articles-link]').forEach(link => {
    link.href = articlesPath(lang);
  });
  document.querySelectorAll('[data-home-link]').forEach(link => {
    link.href = homePath(lang);
  });
  document.querySelectorAll('[data-home-anchor]').forEach(link => {
    link.href = `${homePath(lang)}#${link.dataset.homeAnchor}`;
  });
}

function toggleMobile() {
  const menu = document.getElementById('mobile-nav');
  const button = document.getElementById('mobile-menu-button');
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  button?.setAttribute('aria-expanded', String(willOpen));
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
  if (e.key === 'Escape') {
    closeServiceModal();
    closeRecommendationModal();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (redirectLegacyLanguage()) return;
  currentLang = languageFromPath();
  document.getElementById('footer-year').textContent = new Date().getFullYear();
  updatePageLinks(currentLang);

  const serviceModal = document.getElementById('service-modal');
  if (serviceModal) {
    serviceModal.addEventListener('click', (e) => {
      if (e.target === serviceModal) closeServiceModal();
    });
  }

  const recommendationModal = document.getElementById('recommendation-modal');
  if (recommendationModal) {
    recommendationModal.addEventListener('click', (e) => {
      if (e.target === recommendationModal) closeRecommendationModal();
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  initAnimations();
  loadContent();
});
