/**
 * workshops.js - Independent renderer for workshops.html.
 * Content is loaded from content/workshop.yaml and inserted as text only.
 * Registration sends data only when the code gate and registration.enabled are both on
 * and a configured https endpoint, Turnstile key and consent version are present.
 */

(() => {
  'use strict';

  const LANGUAGES = ['he', 'en', 'ru'];
  const LAYOUTS = ['conversion', 'story', 'program'];
  const FIELD_NAMES = ['full_name', 'mobile', 'email', 'expertise'];
  // Change only after the chosen verified backend, functioning server-side Turnstile Siteverify (hostname and action),
  // consent text approval, CORS review, and full E2E testing have all been approved.
  const SECURE_REGISTRATION_BACKEND_APPROVED = true;
  const FALLBACK_LOAD_ERRORS = {
    he: 'לא ניתן לטעון את תוכן הסדנה. בדקו את קובץ ה-YAML ורעננו את העמוד.',
    en: 'The workshop content could not be loaded. Check the YAML file and refresh the page.',
    ru: 'Не удалось загрузить содержимое мастер-класса. Проверьте YAML-файл и обновите страницу.'
  };

  let workshopContent = null;
  let currentLang = 'he';
  let currentLayout = 'conversion';
  let revealObserver = null;
  const touchedFields = new Set();

  function valueAt(path, root = workshopContent) {
    if (!root || !path) return undefined;
    return path.split('.').reduce((value, key) => (
      value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
    ), root);
  }

  const EVENT_LOCALES = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' };

  // Fills {event.*} tokens from the single `event` block so dates/counts are never hand-copied into translations.
  function fillEvent(text, lang) {
    const event = workshopContent?.event;
    if (!event || !text.includes('{event.')) return text;
    const date = new Date(`${event.first_session_date}T00:00:00Z`);
    const part = (options) => new Intl.DateTimeFormat(EVENT_LOCALES[lang] || 'en-GB', { timeZone: 'UTC', ...options }).formatToParts(date)
      .filter(p => ['day', 'month', 'year', 'literal'].includes(p.type)).map(p => p.value).join('').replace(/\s*г\.$/, '').trim();
    const values = {
      'event.sessions': String(event.session_count),
      'event.hours': String(event.total_hours),
      'event.date': part({ day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
      'event.date_short': part({ day: 'numeric', month: 'short', year: 'numeric' }),
      'event.date_long': part({ day: 'numeric', month: 'long', year: 'numeric' })
    };
    return text.replace(/\{(event\.[a-z_]+)\}/g, (match, key) => (key in values ? values[key] : match));
  }

  function translate(value, lang = currentLang) {
    if (typeof value === 'string') return fillEvent(value, lang);
    if (!value || typeof value !== 'object') return '';
    return fillEvent(value[lang] || value.he || value.en || value.ru || '', lang);
  }

  function translatedAt(path) {
    return translate(valueAt(path));
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '';
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function requestedLanguage(pathname = window.location.pathname) {
    const match = pathname.match(/^\/(en|ru)(?:\/|$)/);
    return match ? match[1] : 'he';
  }

  function requestedLayout() {
    const layout = new URLSearchParams(window.location.search).get('layout');
    return LAYOUTS.includes(layout) ? layout : null;
  }

  function homePath(lang) {
    return lang === 'he' ? '/' : `/${lang}/`;
  }

  function workshopsPath(lang) {
    return lang === 'he' ? '/workshops.html' : `/${lang}/workshops.html`;
  }

  function redirectLegacyLanguage() {
    const url = new URL(window.location.href);
    const lang = url.searchParams.get('lang');
    if (!LANGUAGES.includes(lang)) return false;
    url.pathname = workshopsPath(lang);
    url.searchParams.delete('lang');
    if (url.searchParams.has('layout') && !LAYOUTS.includes(url.searchParams.get('layout'))) {
      url.searchParams.delete('layout');
    }
    window.location.replace(`${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  function applyPreviewNoindex() {
    if (!requestedLayout()) return;
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.append(robots);
    }
    robots.content = 'noindex,follow';
  }

  function assertTranslation(value, path) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Missing translation object: ${path}`);
    }

    LANGUAGES.forEach(lang => {
      if (typeof value[lang] !== 'string') {
        throw new Error(`Missing ${lang} translation: ${path}`);
      }
    });
  }

  function validateContent(content) {
    if (!content || typeof content !== 'object') {
      throw new Error('workshop.yaml must contain a mapping.');
    }

    if (!LAYOUTS.includes(content.layout)) {
      throw new Error('layout must be conversion, story, or program.');
    }

    const reg = content.registration;
    if (!reg || typeof reg !== 'object' || reg.enabled !== false && reg.enabled !== true || typeof reg.endpoint !== 'string') {
      throw new Error('registration must contain boolean enabled and string endpoint settings.');
    }
    const event = content.event;
    if (!event || typeof event !== 'object' || !/^[A-Za-z0-9._-]{1,64}$/.test(event.workshop_id) || !/^\d{4}-\d{2}-\d{2}$/.test(event.first_session_date)
      || !Number.isInteger(event.session_count) || !Number.isFinite(event.total_hours)) {
      throw new Error('event must contain workshop_id, first_session_date, session_count and total_hours.');
    }
    ['turnstile_site_key', 'turnstile_action', 'consent_version'].forEach(key => {
      if (reg[key] !== undefined && typeof reg[key] !== 'string') throw new Error(`registration.${key} must be a string.`);
    });

    if (!content.sections || typeof content.sections !== 'object') {
      throw new Error('sections must be a mapping.');
    }

    ['content_1', 'content_2', 'power_image', 'content_3', 'pricing', 'instructor'].forEach(section => {
      if (typeof content.sections[section] !== 'boolean') {
        throw new Error(`sections.${section} must be a YAML boolean.`);
      }
    });

    [
      'meta.title',
      'meta.description',
      'hero.title',
      'hero.subtitle',
      'content_1.title',
      'content_2.title',
      'content_3.title',
      'form.title',
      'form.demo_notice',
      'form.submit_label'
    ].forEach(path => assertTranslation(valueAt(path, content), path));

    if (!Array.isArray(content.hero.details) || !Array.isArray(content.content_2.items) || !Array.isArray(content.content_3.items)) {
      throw new Error('Workshop detail and section item fields must be YAML lists.');
    }
  }

  function applyDocumentLanguage() {
    const html = document.documentElement;
    html.lang = currentLang;
    html.dir = currentLang === 'he' ? 'rtl' : 'ltr';

    LANGUAGES.forEach(lang => {
      const button = document.getElementById(`btn-${lang}`);
      if (!button) return;
      const isActive = lang === currentLang;
      button.classList.toggle('active', isActive);
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function homeHref(anchor) {
    return `${homePath(currentLang)}#${encodeURIComponent(anchor)}`;
  }

  function workshopsHref() {
    const params = new URLSearchParams();
    const previewLayout = requestedLayout();
    if (previewLayout) params.set('layout', previewLayout);
    const query = params.toString();
    return `${workshopsPath(currentLang)}${query ? `?${query}` : ''}`;
  }

  function updateNavigation() {
    const brandLink = document.getElementById('brand-link');
    if (brandLink) brandLink.href = homeHref('hero');

    document.querySelectorAll('[data-home-anchor]').forEach(link => {
      link.href = homeHref(link.dataset.homeAnchor);
    });

    document.querySelectorAll('[data-workshops-link]').forEach(link => {
      link.href = workshopsHref();
    });

    const previewLayout = requestedLayout();
    LANGUAGES.forEach(lang => {
      const link = document.getElementById(`btn-${lang}`);
      if (link) link.href = `${workshopsPath(lang)}${previewLayout ? `?layout=${encodeURIComponent(previewLayout)}` : ''}`;
    });
  }

  function renderTextBindings() {
    document.querySelectorAll('[data-copy]').forEach(element => {
      element.textContent = translatedAt(element.dataset.copy);
    });

    document.querySelectorAll('[data-aria-copy]').forEach(element => {
      element.setAttribute('aria-label', translatedAt(element.dataset.ariaCopy));
    });

    const brandLogo = document.getElementById('brand-logo');
    if (brandLogo) brandLogo.alt = translatedAt('nav.brand_alt');
  }

  function renderMeta() {
    const title = translatedAt('meta.title');
    const description = translatedAt('meta.description');
    document.title = title;

    const descriptionMeta = document.querySelector('meta[name="description"]');
    const openGraphTitle = document.querySelector('meta[property="og:title"]');
    const openGraphDescription = document.querySelector('meta[property="og:description"]');

    if (descriptionMeta) descriptionMeta.content = description;
    if (openGraphTitle) openGraphTitle.content = title;
    if (openGraphDescription) openGraphDescription.content = description;
  }

  function renderHero() {
    setText('layout-label', translate(workshopContent.layout_labels[currentLayout]));
    setText('hero-eyebrow', translatedAt('hero.eyebrow'));
    setText('workshop-title', translatedAt('hero.title'));
    setText('hero-subtitle', translatedAt('hero.subtitle'));
    setText('hero-description', translatedAt('hero.description'));
    setText('details-kicker', translatedAt('hero.details_kicker'));
    setText('details-heading', translatedAt('hero.details_heading'));

    const list = document.getElementById('hero-details-list');
    if (!list) return;
    list.replaceChildren();

    workshopContent.hero.details.forEach(detail => {
      const row = createElement('div', 'hero-detail');
      row.append(
        createElement('dt', '', translate(detail.label)),
        createElement('dd', '', translate(detail.value))
      );
      list.append(row);
    });
  }

  function renderParagraphs() {
    const container = document.getElementById('content-1-paragraphs');
    if (!container) return;
    container.replaceChildren();

    (workshopContent.content_1.paragraphs || []).forEach(paragraph => {
      container.append(createElement('p', '', translate(paragraph)));
    });
  }

  function renderWorkshopItems() {
    const list = document.getElementById('content-2-items');
    if (!list) return;
    list.replaceChildren();

    (workshopContent.content_2.items || []).forEach((item, index) => {
      const listItem = createElement('li', 'workshop-item');
      const itemNumber = String(index + 1).padStart(2, '0');
      listItem.append(
        createElement('span', 'workshop-item-number', itemNumber),
        createElement('h3', 'workshop-item-title', translate(item.title)),
        createElement('p', 'workshop-item-text', translate(item.text))
      );
      list.append(listItem);
    });
  }

  function renderFaqItems() {
    const list = document.getElementById('content-3-items');
    if (!list) return;
    list.replaceChildren();

    (workshopContent.content_3.items || []).forEach(item => {
      const row = createElement('div', 'faq-item');
      row.append(
        createElement('dt', 'faq-question', translate(item.question)),
        createElement('dd', 'faq-answer', translate(item.answer))
      );
      list.append(row);
    });
  }

  function safeAssetPath(value) {
    if (typeof value !== 'string' || !value.startsWith('./assets/') || value.includes('\\')) return '';

    try {
      const allowedRoot = new URL('/assets/', window.location.origin);
      const candidate = new URL(value.slice(1), window.location.origin);
      const isAllowed = candidate.origin === allowedRoot.origin && candidate.pathname.startsWith(allowedRoot.pathname);
      return isAllowed ? candidate.pathname : '';
    } catch (_error) {
      return '';
    }
  }

  const RESPONSIVE_IMAGES = Object.freeze({
    '/assets/images/katya-2.webp': {
      src: '/assets/images/katya-2-720.webp',
      srcset: '/assets/images/katya-2-720.webp 720w, /assets/images/katya-2-1440.webp 1440w',
      sizes: '(min-width: 1304px) 1240px, (max-width: 767px) calc(100vw - 34px), calc(100vw - 64px)'
    },
    '/assets/images/katya-workshop-cutout.png': {
      src: '/assets/images/katya-workshop-cutout-480.webp',
      srcset: '/assets/images/katya-workshop-cutout-480.webp 480w, /assets/images/katya-workshop-cutout-960.webp 960w',
      sizes: '(max-width: 767px) calc(100vw - 98px), 420px'
    }
  });

  function setResponsiveImageSource(image, source) {
    const responsive = RESPONSIVE_IMAGES[source];
    if (responsive) {
      image.sizes = responsive.sizes;
      image.srcset = responsive.srcset;
      image.src = responsive.src;
      return;
    }

    image.removeAttribute('sizes');
    image.removeAttribute('srcset');
    image.src = source;
  }

  function renderPowerImage() {
    const figure = document.getElementById('power-image-wrap');
    const image = document.getElementById('power-image');
    const caption = document.getElementById('power-image-caption');
    if (!figure || !image || !caption) return;

    const source = safeAssetPath(workshopContent.power_image.src);
    const shouldShow = workshopContent.sections.power_image === true && Boolean(source);
    figure.hidden = !shouldShow;

    if (!shouldShow) {
      image.removeAttribute('src');
      image.alt = '';
      caption.textContent = '';
      return;
    }

    setResponsiveImageSource(image, source);
    image.alt = translate(workshopContent.power_image.alt);
    caption.textContent = translate(workshopContent.power_image.caption);
    caption.hidden = !caption.textContent;
  }

  function renderSections() {
    setText('content-1-kicker', translatedAt('content_1.kicker'));
    setText('content-1-title', translatedAt('content_1.title'));
    setText('content-2-kicker', translatedAt('content_2.kicker'));
    setText('content-2-title', translatedAt('content_2.title'));
    setText('content-2-intro', translatedAt('content_2.intro'));
    setText('content-3-kicker', translatedAt('content_3.kicker'));
    setText('content-3-title', translatedAt('content_3.title'));
    setText('content-3-intro', translatedAt('content_3.intro'));
    setText('cta-1', translatedAt('ctas.after_content_1'));
    setText('cta-2', translatedAt('ctas.after_power_image'));

    renderParagraphs();
    renderWorkshopItems();
    renderFaqItems();
    renderPowerImage();

    const contentOneEnabled = workshopContent.sections.content_1 === true;
    const contentTwoEnabled = workshopContent.sections.content_2 === true;
    const contentThreeEnabled = workshopContent.sections.content_3 === true;

    document.getElementById('content-1').hidden = !contentOneEnabled;
    document.getElementById('cta-1-wrap').hidden = !contentOneEnabled;
    document.getElementById('content-2').hidden = !contentTwoEnabled;
    document.getElementById('cta-2-wrap').hidden = !contentTwoEnabled;
    document.getElementById('content-3').hidden = !contentThreeEnabled;
    renderPricing();
    renderInstructor();
  }

  function priceText(amount) {
    const price = Number(amount);
    return Number.isFinite(price) ? new Intl.NumberFormat(currentLang === 'he' ? 'he-IL' : currentLang === 'ru' ? 'ru-RU' : 'en-US').format(price) : '';
  }

  function renderPricing() {
    const section = document.getElementById('pricing');
    const pricing = workshopContent.pricing;
    section.hidden = workshopContent.sections.pricing !== true;
    if (section.hidden || !pricing) return;
    setText('pricing-kicker', translate(pricing.kicker)); setText('pricing-title', translate(pricing.title)); setText('pricing-intro', translate(pricing.intro));
    const currency = translate(pricing.currency); const vat = translate(pricing.vat_text);
    const fill = (template, amount) => translate(template)
      .replaceAll('{price}', priceText(amount))
      .replaceAll('{total}', priceText(pricing.current_price))
      .replaceAll('{count}', priceText(pricing.session_count))
      .replaceAll('{currency}', currency)
      .replaceAll('{vat}', vat);
    const original = document.getElementById('pricing-original'); original.replaceChildren(createElement('del', '', fill(pricing.original_label, pricing.original_price)));
    setText('pricing-current', fill(pricing.current_label, pricing.current_price)); setText('pricing-breakdown', fill(pricing.breakdown_label, pricing.per_session_price));
    setText('pricing-deadline', translate(pricing.deadline)); setText('pricing-after', fill(pricing.after_deadline, pricing.original_price)); setText('pricing-cta', translate(pricing.cta));
  }

  function renderInstructor() {
    const section = document.getElementById('instructor'); const instructor = workshopContent.instructor;
    section.hidden = workshopContent.sections.instructor !== true;
    if (section.hidden || !instructor) return;
    setText('instructor-kicker', translate(instructor.kicker)); setText('instructor-title', translate(instructor.title));
    setText('instructor-caption', `${translate(instructor.title)}, ${translate(instructor.role)}`);
    const bio = document.getElementById('instructor-bio'); bio.replaceChildren(); (instructor.paragraphs || []).forEach(item => bio.append(createElement('p', '', translate(item))));
    const image = document.getElementById('instructor-image'); setResponsiveImageSource(image, safeAssetPath(instructor.image.src)); image.alt = translate(instructor.image.alt);
  }

  function renderFormText() {
    setText('form-kicker', translatedAt('form.kicker'));
    setText('registration-title', translatedAt('form.title'));
    setText('form-intro', translatedAt('form.intro'));
    setText('form-demo-notice', translatedAt('form.demo_notice'));
    setText('form-privacy-note', translatedAt('form.privacy_note'));
    setText('form-privacy-placeholder', translatedAt('form.privacy_notice'));
    setText('form-consent-label', translatedAt('form.consent'));
    setText('form-submit', translatedAt('form.submit_label'));

    const consentWrap = document.getElementById('form-consent-wrap');
    const consent = document.getElementById('form-consent');
    const submit = document.getElementById('form-submit');
    const enabled = registrationIsReady();
    if (consentWrap) consentWrap.hidden = !enabled;
    if (consent) {
      consent.disabled = !enabled;
      consent.required = enabled;
    }
    if (submit) submit.disabled = !enabled;
    const demoNotice = document.getElementById('form-demo-notice')?.closest('.demo-notice');
    if (demoNotice) demoNotice.hidden = enabled; // the demo text is only truthful while registration is off

    const fieldIdParts = {
      full_name: 'full-name',
      mobile: 'mobile',
      email: 'email',
      expertise: 'expertise'
    };

    FIELD_NAMES.forEach(name => {
      const input = document.getElementById(name);
      const idPart = fieldIdParts[name];
      setText(`${idPart}-label`, translatedAt(`form.fields.${name}.label`));
      setText(`${idPart}-help`, translatedAt(`form.fields.${name}.help`));
      if (input) input.placeholder = translatedAt(`form.fields.${name}.placeholder`);
    });

    const status = document.getElementById('form-status');
    if (status && status.dataset.statusKey) {
      status.textContent = translatedAt(`form.status.${status.dataset.statusKey}`);
    }

    FIELD_NAMES.forEach(name => {
      const input = document.getElementById(name);
      if (input && touchedFields.has(name)) validateField(input, true);
    });
  }

  function renderPage() {
    currentLayout = requestedLayout() || workshopContent.layout;
    document.body.classList.remove(...LAYOUTS.map(layout => `layout-${layout}`));
    document.body.classList.add(`layout-${currentLayout}`);
    document.body.dataset.layout = currentLayout;

    applyDocumentLanguage();
    updateNavigation();
    renderTextBindings();
    renderMeta();
    renderHero();
    renderSections();
    renderFormText();

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function errorMessage(fieldName, key) {
    return translatedAt(`form.fields.${fieldName}.errors.${key}`);
  }

  function fieldValidation(input) {
    const value = input.value.trim();

    if (!value) return { valid: false, message: errorMessage(input.name, 'required') };

    if (input.name === 'full_name') {
      const allowedName = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’ʼ-]*$/u.test(value);
      const letterCount = (value.match(/\p{L}/gu) || []).length;
      if (!allowedName || letterCount < 2 || /\p{N}/u.test(value)) {
        return { valid: false, message: errorMessage(input.name, 'invalid') };
      }
    }

    if (input.name === 'mobile' && !/^[0-9]{8,15}$/.test(value)) {
      return { valid: false, message: errorMessage(input.name, 'invalid') };
    }

    if (input.name === 'email') {
      const conservativeEmail = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
      if (input.validity.typeMismatch || value.length > 254 || !conservativeEmail.test(value)) {
        return { valid: false, message: errorMessage(input.name, 'invalid') };
      }
    }

    if (input.name === 'expertise') {
      if ([...value].length < 2) {
        return { valid: false, message: errorMessage(input.name, 'too_short') };
      }
      if (/\p{N}/u.test(value)) {
        return { valid: false, message: errorMessage(input.name, 'has_digit') };
      }
    }

    return { valid: true, message: '' };
  }

  function validateField(input, showMessage) {
    const result = fieldValidation(input);
    const error = document.getElementById(`${input.name.replace('_', '-')}-error`);

    input.setCustomValidity(result.valid ? '' : result.message);
    input.setAttribute('aria-invalid', String(!result.valid));

    if (error) {
      error.textContent = showMessage && !result.valid ? result.message : '';
      error.hidden = !showMessage || result.valid;
    }

    return result.valid;
  }

  function setFormStatus(key) {
    const status = document.getElementById('form-status');
    if (!status) return;
    status.dataset.statusKey = key;
    status.textContent = translatedAt(`form.status.${key}`);
  }

  function registrationIsReady() {
    const settings = workshopContent?.registration;
    if (!SECURE_REGISTRATION_BACKEND_APPROVED || !settings || settings.enabled !== true || !settings.endpoint) return false;
    if (!settings.turnstile_site_key || !settings.turnstile_action || !workshopContent.event?.workshop_id || !settings.consent_version || settings.consent_version === 'pending-approval') return false;
    try {
      const endpoint = new URL(settings.endpoint);
      return endpoint.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function registrationEndpoint() {
    return new URL(workshopContent.registration.endpoint).toString();
  }

  function registrationTimeout() {
    const configured = Number(workshopContent?.registration?.timeout_ms);
    return Number.isFinite(configured) ? Math.min(Math.max(configured, 3000), 30000) : 10000;
  }

  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileLoading = null;
  let turnstileObserver = null;
  let idempotencyKey = '';

  function newIdempotencyKey() {
    idempotencyKey = crypto.randomUUID();
  }

  // Loaded only after the code gate and every public setting pass registrationIsReady().
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
      turnstileLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => resolve(window.turnstile);
        script.onerror = () => { turnstileLoading = null; reject(new Error('turnstile')); };
        document.head.appendChild(script);
      });
    }
    return turnstileLoading;
  }

  async function setupTurnstile() {
    const box = document.getElementById('turnstile-widget');
    if (!box || !registrationIsReady() || turnstileWidgetId !== null) return;
    try {
      const api = await loadTurnstile();
      if (turnstileWidgetId !== null) return;
      box.hidden = false;
      turnstileWidgetId = api.render(box, {
        sitekey: workshopContent.registration.turnstile_site_key,
        action: workshopContent.registration.turnstile_action,
        language: currentLang,
        callback: token => { turnstileToken = token; },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; }
      });
    } catch {
      setFormStatus('challenge_failure');
    }
  }

  function scheduleTurnstile() {
    const registration = document.getElementById('registration');
    if (!registration || !registrationIsReady()) return;

    const start = () => {
      if (turnstileObserver) {
        turnstileObserver.disconnect();
        turnstileObserver = null;
      }
      setupTurnstile();
    };

    registration.addEventListener('focusin', start, { once: true });
    registration.addEventListener('pointerdown', start, { once: true });
    document.querySelectorAll('a[href="#registration"]').forEach(link => {
      link.addEventListener('click', start, { once: true });
    });

    if ('IntersectionObserver' in window) {
      turnstileObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) start();
      }, { rootMargin: '600px 0px', threshold: 0 });
      turnstileObserver.observe(registration);
    }
  }

  function resetTurnstile() {
    turnstileToken = '';
    if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
  }

  async function submitRegistration(form) {
    const honeypot = document.getElementById('registration-website');
    if (honeypot?.value) {
      setFormStatus('challenge_failure');
      return;
    }

    const consent = document.getElementById('form-consent');
    if (!consent?.checked) {
      consent?.focus();
      setFormStatus('fix_errors');
      return;
    }

    if (!turnstileToken) {
      setFormStatus('challenge_failure');
      return;
    }

    const settings = workshopContent.registration;
    const submit = document.getElementById('form-submit');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), registrationTimeout());
    if (!idempotencyKey) newIdempotencyKey();
    const payload = Object.fromEntries(FIELD_NAMES.map(name => [name, document.getElementById(name).value.trim()]));
    Object.assign(payload, {
      consent: true,
      consentVersion: settings.consent_version,
      workshopId: workshopContent.event.workshop_id,
      lang: currentLang,
      website: honeypot ? honeypot.value : '',
      idempotencyKey,
      turnstileToken
    });
    setFormStatus('loading');
    if (submit) submit.disabled = true;

    try {
      const response = await fetch(registrationEndpoint(), {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (response.status === 409) return setFormStatus('duplicate');
      if (response.status === 429) return setFormStatus('rate_limited');
      if (response.status === 422) return setFormStatus('invalid');
      if (response.status === 400 || response.status === 403) return setFormStatus('challenge_failure');
      if (response.status === 503) return setFormStatus('unavailable');
      if (response.status === 504) return setFormStatus('timeout');
      if (!response.ok) return setFormStatus('failure');

      const result = await response.json();
      if (result?.ok === true && typeof result.registrationId === 'string' && result.registrationId.trim()) {
        form.reset();
        newIdempotencyKey();
        setFormStatus('success');
      } else {
        setFormStatus('failure');
      }
    } catch (error) {
      setFormStatus(error?.name === 'AbortError' ? 'timeout' : 'failure');
    } finally {
      window.clearTimeout(timeoutId);
      resetTurnstile(); // tokens are single-use; the idempotency key is kept so a retry cannot duplicate
      if (submit) submit.disabled = !registrationIsReady();
    }
  }

  function validateAllFields() {
    let firstInvalid = null;
    let allValid = true;

    FIELD_NAMES.forEach(name => {
      const input = document.getElementById(name);
      if (!input) return;
      touchedFields.add(name);
      const isValid = validateField(input, true);
      if (!isValid && !firstInvalid) firstInvalid = input;
      allValid = isValid && allValid;
    });

    if (firstInvalid) firstInvalid.focus();
    return allValid;
  }

  function sanitizeMobileInput(input) {
    const sanitized = input.value.replace(/[^0-9]/g, '').slice(0, 15);
    if (input.value !== sanitized) input.value = sanitized;
  }

  function setupForm() {
    const form = document.getElementById('registration-form');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';

    FIELD_NAMES.forEach(name => {
      const input = document.getElementById(name);
      if (!input) return;

      input.addEventListener('blur', () => {
        touchedFields.add(name);
        validateField(input, true);
      });

      input.addEventListener('input', () => {
        if (name === 'mobile') sanitizeMobileInput(input);
        if (touchedFields.has(name)) validateField(input, true);
        idempotencyKey = '';
        const status = document.getElementById('form-status');
        if (status) {
          status.textContent = '';
          delete status.dataset.statusKey;
        }
      });
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      const allValid = validateAllFields();
      if (!allValid) {
        setFormStatus('fix_errors');
      } else if (!registrationIsReady()) {
        setFormStatus('no_registration');
      } else {
        submitRegistration(form);
      }
    });

  }

  function closeMobileMenu() {
    const menu = document.getElementById('mobile-nav');
    const button = document.getElementById('mobile-menu-button');
    if (!menu || !button) return;
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    if (workshopContent) button.setAttribute('aria-label', translatedAt('nav.open_menu'));
  }

  function toggleMobileMenu() {
    const menu = document.getElementById('mobile-nav');
    const button = document.getElementById('mobile-menu-button');
    if (!menu || !button) return;
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
    if (workshopContent) {
      button.setAttribute('aria-label', translatedAt(willOpen ? 'nav.close_menu' : 'nav.open_menu'));
    }
  }

  function setupNavigation() {
    const menuButton = document.getElementById('mobile-menu-button');
    if (menuButton) menuButton.addEventListener('click', toggleMobileMenu);

    document.querySelectorAll('#mobile-nav a').forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMobileMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1200) closeMobileMenu();
    });
  }

  function setupReveals() {
    const elements = document.querySelectorAll('[data-reveal]:not([hidden])');
    document.body.classList.add('animations-ready');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      elements.forEach(element => element.classList.add('is-visible'));
      return;
    }

    if (revealObserver) revealObserver.disconnect();
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    elements.forEach(element => revealObserver.observe(element));
  }

  function showLoadError(error) {
    console.error('Failed to load workshop content:', error);

    const message = (workshopContent && translatedAt('system.content_error')) || FALLBACK_LOAD_ERRORS[currentLang];
    const errorBox = document.getElementById('content-error');
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    document.querySelectorAll('#workshop-main > :not(#content-error)').forEach(element => {
      element.hidden = true;
    });
  }

  async function loadWorkshopContent() {
    try {
      const contentUrl = new URL('/content/workshop.yaml', window.location.origin);
      const response = await fetch(contentUrl);
      if (!response.ok) {
        throw new Error(`workshop.yaml returned HTTP ${response.status}`);
      }

      const yamlText = await response.text();
      workshopContent = jsyaml.load(yamlText);
      validateContent(workshopContent);
      renderPage();
      setupForm();
      scheduleTurnstile();
      setupReveals();
    } catch (error) {
      showLoadError(error);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (redirectLegacyLanguage()) return;
    currentLang = requestedLanguage();
    applyPreviewNoindex();
    applyDocumentLanguage();
    updateNavigation();
    setupNavigation();

    const year = document.getElementById('footer-year');
    if (year) year.textContent = String(new Date().getFullYear());

    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadWorkshopContent();
  });
})();
