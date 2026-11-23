const main = document.querySelector('#main');
const header = document.querySelector('.top');
const account = document.querySelector('#account');
const accountPanel = document.querySelector('#account-panel');
const dialog = document.querySelector('#dialog');
const dialogBody = document.querySelector('#dialog-body');
let token = sessionStorage.getItem('alquilometro-token');
let user;
let routeVersion = 0;
let releasePublicationMap;
let releaseSimilarCarousel;
let currentView;
let savedPageLink;
let publicationBackLink;
let resultsScrollY = 0;
let resultsProgress;
let comparisonRequest = 0;
let filters = new URLSearchParams();
let searchOperation = 'alquiler';
let photoUploadError;
let releasePhotoPreviews;
let releaseManagedPhotos;
const maxListingPhotos = 20;
const maxComparedListings = 3;
const cabaNeighborhoods = [
  'Agronomía', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Boca', 'Boedo',
  'Caballito', 'Chacarita', 'Coghlan', 'Colegiales', 'Constitución', 'Flores',
  'Floresta', 'Liniers', 'Mataderos', 'Monte Castro', 'Monserrat', 'Nueva Pompeya',
  'Núñez', 'Palermo', 'Parque Avellaneda', 'Parque Chacabuco', 'Parque Chas',
  'Parque Patricios', 'Paternal', 'Puerto Madero', 'Recoleta', 'Retiro',
  'Saavedra', 'San Cristóbal', 'San Nicolás', 'San Telmo', 'Vélez Sarsfield',
  'Versalles', 'Villa Crespo', 'Villa del Parque', 'Villa Devoto', 'Villa General Mitre',
  'Villa Lugano', 'Villa Luro', 'Villa Ortúzar', 'Villa Pueyrredón', 'Villa Real',
  'Villa Riachuelo', 'Villa Santa Rita', 'Villa Soldati', 'Villa Urquiza',
];
const cabaSubareas = [
  'Abasto', 'Barrio Norte', 'Belgrano C', 'Belgrano R', 'Las Cañitas', 'La Imprenta',
  'Palermo Botánico', 'Palermo Chico', 'Palermo Hollywood', 'Palermo Nuevo',
  'Palermo Sensible', 'Palermo Soho', 'Palermo Viejo',
];
const rentalGuarantees = [
  'Garantía propietaria', 'Seguro de caución', 'Garante personal', 'Aval bancario',
];
const propertyTypes = [
  ['departamento', 'Departamento'], ['casa', 'Casa'], ['ph', 'PH'],
  ['dúplex', 'Dúplex'], ['tríplex', 'Tríplex'], ['loft', 'Loft'],
  ['habitación', 'Habitación'], ['quinta', 'Quinta'],
  ['local comercial', 'Local comercial'], ['oficina', 'Oficina'], ['consultorio', 'Consultorio'],
  ['galpón', 'Galpón / nave industrial'], ['depósito', 'Depósito'],
  ['edificio', 'Edificio'], ['hotel', 'Hotel'],
  ['terreno', 'Terreno / lote'], ['cochera', 'Cochera'], ['baulera', 'Baulera'],
  ['otro', 'Otro tipo de propiedad'],
];
const propertyTypesWithoutRooms = new Set(['terreno', 'cochera', 'baulera']);
const listingCostLabels = {
  expensas_mensuales: 'Expensas mensuales',
  abl_mensual: 'ABL mensual',
  seguro_caucion: 'Seguro de caución (total)',
  deposito: 'Depósito',
  comision: 'Comisión',
  otros_gastos_entrada: 'Otros gastos de entrada',
};
const saleExpenseKeys = ['expensas_mensuales', 'abl_mensual'];
const optionalAmount = 'type="number" min="0" max="9999999999.99" step="0.01"';
const adjustmentIndexes = [
  ['IPC', 'IPC · Precios al consumidor (INDEC)'],
  ['ICL', 'ICL · Índice para contratos de locación'],
  ['CASA PROPIA', 'Coeficiente Casa Propia'],
  ['UVA', 'UVA · Unidad de Valor Adquisitivo'],
  ['UVI', 'UVI · Unidad de Vivienda'],
  ['CER', 'CER · Coeficiente de Estabilización de Referencia'],
  ['CVS', 'CVS · Coeficiente de Variación Salarial'],
  ['RIPTE', 'RIPTE · Salarios de trabajadores estables'],
  ['CAC', 'CAC · Costo de la construcción (CAMARCO)'],
  ['ICC', 'ICC · Costo de la construcción (INDEC)'],
  ['otro', 'Otro índice pactado'],
];
const favoriteStorageKey = 'alquilometro-favoritos';
const favorites = readFavorites();
const compared = new Map();
const searchFilterLabels = {
  zona: 'Barrio', ambientes: 'Ambientes', permite_mascotas: 'Mascotas', moneda: 'Moneda',
  tipo_garantia: 'Garantía', alquiler_min: 'Alquiler desde', alquiler_max: 'Alquiler hasta',
  costo_real_min: 'Costo mensual desde', costo_real_max: 'Costo mensual hasta',
  precio_min: 'Precio desde', precio_max: 'Precio hasta',
  orden: 'Orden', descendente: 'Sentido',
};
const canPublish = () => ['INMOBILIARIA', 'ADMIN'].includes(user?.rol);
const canManagePublication = (p) => user && (user.id === p.publicador_id || user.rol === 'ADMIN');
const recordedListingEvents = new Set();

function recordListingEvent(listing, event) {
  if (canManagePublication(listing)) return;
  const key = `alquilometro-metrica-${listing.id}-${event}`;
  if (recordedListingEvents.has(key)) return;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // Si el navegador bloquea el almacenamiento, se deduplica en memoria.
  }
  recordedListingEvents.add(key);
  fetch(`/api/publicaciones/${listing.id}/metricas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evento: event }),
    keepalive: true,
  }).catch(() => {});
}

const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const number = (value) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const money = (value) => value ? new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: value.moneda, maximumFractionDigits: 2, minimumFractionDigits: 0,
}).format(Number(value.monto)) : '—';
const pct = (value) => value == null ? '—' : number(value) + '%';
const date = (value) => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
const labels = {
  alquiler: 'Alquiler', expensas: 'Expensas', abl: 'ABL', deposito: 'Depósito',
  seguro_caucion: 'Seguro de caución', seguro_caucion_prorrateado: 'Seguro prorrateado',
  comision: 'Comisión', primer_mes: 'Primer mes', otros_gastos_entrada: 'Otros gastos de entrada',
  duracion_contrato_meses: 'Duración del contrato',
};
const label = (key) => labels[key] ?? key.replaceAll('_', ' ');
const note = (message, type = '') => `<p class="notice ${type}" role="status">${h(message)}</p>`;
const missing = (keys) => keys?.length ? note('Datos faltantes: ' + keys.map(label).join(', '), 'warn') : '';
const result = (element, html) => { element.innerHTML = html; };

async function api(path, method = 'GET', body) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api' + path, {
    method, headers, body: multipart ? body : JSON.stringify(body),
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && token) setUser(null);
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.loc.at(-1) + ': ' + item.msg).join(' · ')
      : data.detail;
    throw new Error(detail || 'La API devolvió un error (' + response.status + ').');
  }
  return data;
}

function setUser(profile, accessToken = null) {
  user = profile;
  token = accessToken;
  if (token) sessionStorage.setItem('alquilometro-token', token);
  else sessionStorage.removeItem('alquilometro-token');
  account.textContent = profile ? profile.nombre : 'Ingresar';
  if (profile) {
    account.setAttribute('aria-controls', 'account-panel');
    account.setAttribute('aria-expanded', String(!accountPanel.hidden));
  } else {
    closeAccountPanel();
    account.removeAttribute('aria-controls');
    account.removeAttribute('aria-expanded');
  }
  document.querySelector('#publish-link').hidden = !canPublish();
  document.querySelector('#my-listings-link').hidden = !canPublish();
}

function submit(form, handler) {
  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const buttons = Array.from(form.elements).filter((control) => control.type === 'submit' && !control.disabled);
    const formOutput = form.querySelector('[data-output]');
    const topOutput = document.getElementById(form.dataset.topOutput ?? '');
    const output = event.submitter?.hasAttribute('data-top-submit') ? topOutput : formOutput;
    saving = true;
    for (const button of buttons) button.disabled = true;
    for (const target of [formOutput, topOutput]) {
      if (target) result(target, '');
    }
    try {
      await handler(new FormData(form), output);
    } catch (error) {
      if (output) result(output, note(error.message, 'error'));
    } finally {
      for (const button of buttons) button.disabled = false;
      saving = false;
    }
  });
}

function input(title, name, attrs = '') {
  return `<label>${title}<input name="${name}" ${attrs}></label>`;
}

function passwordField(title, name, id, attrs, visibilityLabel = 'contraseña') {
  return `<div class="password-field">
    <label for="${id}">${title}</label>
    <div class="password-control">
      <input id="${id}" name="${name}" type="password" required ${attrs}>
      <button class="password-toggle" type="button" aria-controls="${id}"
        aria-label="Mostrar ${visibilityLabel}" title="Mostrar ${visibilityLabel}" data-password-label="${visibilityLabel}">
        <span class="password-eye" aria-hidden="true"></span>
      </button>
    </div>
  </div>`;
}

function fieldWithFeedback(title, name, attrs) {
  return `<div class="validated-field">
    ${input(title, name, `${attrs} aria-describedby="${name}-error"`)}
    <p id="${name}-error" class="field-error" aria-live="polite" hidden></p>
  </div>`;
}
function select(title, name, choices, attrs = '') {
  return `<label>${title}<select name="${name}" ${attrs}>${choices.map(([value, text]) =>
    `<option value="${h(value)}">${h(text)}</option>`).join('')}</select></label>`;
}

function indexFields() {
  return `<div data-index-choice>
    ${select('Índice de ajuste', 'serie_codigo', [['', 'Elegí un índice'], ...adjustmentIndexes],
      'aria-describedby="index-history-hint"')}
    <small id="index-history-hint">Para calcular el ajuste hace falta tener cargado el historial del índice.</small>
  </div>
  ${input('Código del índice pactado', 'serie_personalizada', 'minlength="2" maxlength="20"')}`;
}

function setupAdjustmentFields(form) {
  const { tipo_ajuste, serie_codigo } = form.elements;
  function update() {
    const mode = tipo_ajuste.disabled ? '' : tipo_ajuste.value;
    const byIndex = mode === 'INDICE';
    for (const [field, visible] of [
      ['serie_codigo', byIndex],
      ['serie_personalizada', byIndex && serie_codigo.value === 'otro'],
      ['tasa_ajuste', mode === 'FIJO'],
    ]) {
      const control = form.elements[field];
      control.disabled = !visible;
      control.required = visible;
      control.closest('[data-index-choice]')?.toggleAttribute('hidden', !visible);
      control.closest('label').hidden = !visible;
    }
  }
  tipo_ajuste.onchange = update;
  serie_codigo.onchange = update;
  update();
  return update;
}

function selectedIndex(data) {
  const index = data.get('serie_codigo');
  if (index !== 'otro') return index;
  const custom = data.get('serie_personalizada')?.trim().toUpperCase() ?? '';
  if (custom.length < 2 || custom.length > 20) {
    throw new Error('Ingresá un código de índice de 2 a 20 caracteres.');
  }
  return custom;
}

const currency = [['ARS', 'ARS'], ['USD', 'USD']];
const submitButton = (text) => `<div class="actions"><button class="btn" type="submit">${text}</button></div><div class="full" data-output aria-live="polite"></div>`;
const roomLabel = (rooms) => rooms > 0 ? rooms + (rooms === 1 ? ' ambiente' : ' ambientes') : null;
const metadata = (p) => [
  roomLabel(p.ambientes),
  p.metros_cuadrados && number(p.metros_cuadrados) + ' m²',
  p.permite_mascotas === true ? 'Acepta mascotas' : null,
].filter(Boolean).join(' · ');
const adjustment = (p) => p.tipo_ajuste === 'INDICE' ? p.serie_codigo :
  p.tipo_ajuste === 'FIJO' ? 'Fijo ' + pct(p.tasa_ajuste) : 'Ajuste sin informar';
const query = (data) => new URLSearchParams([...data].filter(([, value]) => value !== ''));
const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map((s) =>
  `<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${rows.map((row) =>
  '<tr>' + row.map((cell) => '<td>' + h(cell) + '</td>').join('') + '</tr>').join('')}</tbody></table></div>`;
const loginPrompt = (text) => `<p>${text}</p><button class="quiet" data-login>Ingresar</button>`;
const roleNames = { INMOBILIARIA: 'Inmobiliaria', ADMIN: 'Administración', BUSCADOR: 'Buscador' };

function closeAccountPanel(restoreFocus = false) {
  if (accountPanel.hidden) return;
  accountPanel.hidden = true;
  account.setAttribute('aria-expanded', 'false');
  if (restoreFocus) account.focus({ preventScroll: true });
}

function openAccountPanel() {
  result(accountPanel, `<h2 id="account-panel-title"><a href="#cuenta">Mi cuenta <span aria-hidden="true">↗</span></a></h2>
    <div class="account-identity">
      <strong>${h(user.nombre)}</strong>
      <small>${h(user.email)}</small>
      <span class="tag">${h(roleNames[user.rol])}</span>
    </div>
    ${user.rol === 'ADMIN' ? '<a class="quiet account-admin-link" href="#admin">Panel de administración</a>' : ''}
    <button class="quiet" type="button" id="logout">Cerrar sesión</button>`);
  for (const link of accountPanel.querySelectorAll('a')) link.onclick = () => closeAccountPanel();
  accountPanel.querySelector('#logout').onclick = () => {
    closeAccountPanel(true);
    setUser(null);
    route();
  };
  accountPanel.hidden = false;
  account.setAttribute('aria-expanded', 'true');
}

function setupPasswordToggles(form) {
  for (const toggle of form.querySelectorAll('.password-toggle')) {
    const password = form.querySelector('#' + toggle.getAttribute('aria-controls'));
    function setVisibility(show) {
      password.type = show ? 'text' : 'password';
      const label = (show ? 'Ocultar ' : 'Mostrar ') + toggle.dataset.passwordLabel;
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }
    toggle.onclick = () => setVisibility(password.type === 'password');
    form.addEventListener('reset', () => setVisibility(false));
  }
}

function openAccount(register = false) {
  result(dialogBody, `<h2 id="dialog-title">${register ? 'Crear cuenta' : 'Ingresar'}</h2><form id="login-form">
    ${register ? `${select('Tipo de cuenta', 'rol', [['BUSCADOR','Busco alquilar'], ['INMOBILIARIA','Soy una inmobiliaria']])}
      ${input('<span id="registro-nombre-label">Nombre</span>', 'nombre', 'required maxlength="100" autocomplete="given-name"')}
      <div class="registration-fields">
        ${input('Nombre de contacto', 'nombre_contacto', 'maxlength="100" autocomplete="given-name"')}
        ${input('Apellido', 'apellido', 'required maxlength="100" autocomplete="family-name"')}
      </div>
      ${fieldWithFeedback('Teléfono', 'telefono', 'type="tel" required maxlength="32" autocomplete="tel" placeholder="+54 9 11 1234-5678"')}` : ''}
    ${fieldWithFeedback('Correo', 'email', 'type="email" required maxlength="255" autocomplete="email" placeholder="nombre@ejemplo.com"')}
    ${passwordField('Contraseña', 'password', 'account-password', register ?
      'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"')}
    ${register ? passwordField('Repetí la contraseña', 'password_confirmacion', 'account-password-confirmation',
      'minlength="8" autocomplete="new-password"', 'confirmación de contraseña') : ''}
    ${submitButton(register ? 'Crear cuenta e ingresar' : 'Ingresar')}</form>
    <button class="quiet" id="toggle-account">${register ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>`);
  const form = dialogBody.querySelector('#login-form');
  if (register) {
    const contactName = form.elements.nombre_contacto;
    const updateRole = () => {
      const agency = form.elements.rol.value === 'INMOBILIARIA';
      form.querySelector('#registro-nombre-label').textContent = agency ? 'Nombre de la inmobiliaria' : 'Nombre';
      form.elements.nombre.autocomplete = agency ? 'organization' : 'given-name';
      contactName.closest('label').hidden = !agency;
      contactName.disabled = !agency;
      contactName.required = agency;
    };
    form.elements.rol.onchange = updateRole;
    updateRole();
  }
  const validateContact = setupAccountContactValidation(form, register);
  setupPasswordToggles(form);
  submit(form, async (data) => {
    if (!validateContact()) return;
    const credentials = { email: data.get('email'), password: data.get('password') };
    if (register) {
      if (data.get('password_confirmacion') !== credentials.password) throw new Error('Las contraseñas no coinciden.');
      await api('/auth/registro', 'POST', Object.fromEntries(data));
    }
    token = (await api('/auth/login', 'POST', credentials)).access_token;
    setUser(await api('/usuarios/me'), token);
    dialog.close();
    await route();
  });
  dialogBody.querySelector('#toggle-account').onclick = () => openAccount(!register);
  if (!dialog.open) dialog.showModal();
  dialogBody.querySelector('#login-form input')?.focus();
}
account.onclick = () => {
  if (!user) openAccount();
  else if (accountPanel.hidden) openAccountPanel();
  else closeAccountPanel();
};
const accountMenu = account.parentElement;
document.addEventListener('pointerdown', (event) => {
  if (!accountMenu.contains(event.target)) closeAccountPanel();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || accountPanel.hidden) return;
  event.preventDefault();
  closeAccountPanel(true);
});
accountMenu.addEventListener('focusout', (event) => {
  if (event.relatedTarget && !accountMenu.contains(event.relatedTarget)) closeAccountPanel();
});
dialog.querySelector('.close').onclick = () => dialog.close();
main.addEventListener('click', (event) => {
  const login = event.target.closest('[data-login]');
  if (login) {
    if (user) location.hash = '#cuenta?seccion=ingreso';
    else openAccount();
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) copyLink(copy);
});

function readFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(favoriteStorageKey) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => Number.isSafeInteger(id) && id > 0) : []);
  } catch {
    return new Set();
  }
}

function favoriteButton(listing) {
  const saved = favorites.has(listing.id);
  return `<button type="button" class="favorite-button" data-favorite="${listing.id}"
    aria-label="Guardar aviso de ${h(listing.titulo)}" aria-pressed="${saved}"
    title="${saved ? 'Quitar de guardados' : 'Guardar aviso'}"><span aria-hidden="true">${saved ? '♥' : '♡'}</span></button>`;
}

function toggleFavorite(button) {
  const id = Number(button.dataset.favorite);
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  try { localStorage.setItem(favoriteStorageKey, JSON.stringify([...favorites])); }
  catch { /* Los guardados quedan disponibles durante esta visita. */ }
  const saved = favorites.has(id);
  button.setAttribute('aria-pressed', String(saved));
  button.title = saved ? 'Quitar de guardados' : 'Guardar aviso';
  button.firstElementChild.textContent = saved ? '♥' : '♡';
}

function searchLink() {
  return (searchOperation === 'venta' ? '#comprar' : '#buscar') + (filters.size ? '?' + filters : '');
}

function sharedFavoritesLink(ids) {
  return '#guardados?avisos=' + [...ids].join(',');
}

function setSearchFilters(next, forSale = searchOperation === 'venta') {
  const unavailable = forSale ?
    ['tipo_garantia', 'alquiler_min', 'alquiler_max', 'costo_real_min', 'costo_real_max'] :
    ['precio_min', 'precio_max'];
  filters = new URLSearchParams([...next].filter(([key, value]) =>
    Object.hasOwn(searchFilterLabels, key) && !unavailable.includes(key) && value &&
    (key !== 'descendente' || value === 'true') &&
    (key !== 'orden' || (forSale ? ['precio', 'precio_m2'] : ['alquiler', 'costo_real', 'precio_m2']).includes(value))));
  if (!filters.has('orden')) filters.delete('descendente');
}

function filterChips() {
  const orderLabels = {alquiler: 'Alquiler', precio: 'Precio de venta', costo_real: 'Costo mensual', precio_m2: 'Precio por m²'};
  return [...filters].filter(([key]) => key !== 'descendente').map(([key, value]) => {
    let text = searchFilterLabels[key] + ' ' + value;
    if (key === 'zona' || key === 'moneda') text = value;
    if (key === 'ambientes') text = value + (value === '1' ? ' ambiente' : ' ambientes');
    if (key === 'permite_mascotas') text = value === 'true' ? 'Acepta mascotas' : 'Sin mascotas';
    if (key === 'orden') text = (orderLabels[value] || value) + (filters.has('descendente') ? ' ↓' : ' ↑');
    if (key.endsWith('_min') || key.endsWith('_max')) text = searchFilterLabels[key] + ' ' + number(value);
    return `<button type="button" class="filter-chip" data-remove-filter="${key}" aria-label="Quitar filtro ${h(text)}">
      ${h(text)} <span aria-hidden="true">×</span></button>`;
  }).join('');
}

async function copyLink(button) {
  const output = button.parentElement.querySelector('[data-copy-status]');
  const url = new URL(button.dataset.copy, location.href).href;
  try {
    await navigator.clipboard.writeText(url);
    output.textContent = 'Enlace copiado.';
  } catch {
    result(output, `<label>Copiá el enlace<input type="url" readonly value="${h(url)}"></label>`);
    output.querySelector('input').select();
  }
}

const isSale = (listing) => listing.operacion === 'venta';
const askingPrice = (listing) => isSale(listing) ? listing.precio_venta : listing.precio_alquiler;
const monthlyCost = (listing) => isSale(listing) ? null : api('/publicaciones/' + listing.id + '/costo-real');
const sponsoredBadge = '<span class="sponsored-badge">Patrocinado</span>';

function listingCard(listing, cost, canCompare = true) {
  const p = listing.propiedad;
  const cover = listing.fotos?.[0];
  const detail = `#publicacion/${listing.id}`;
  return `<article class="card listing-card${listing.patrocinada ? ' listing-sponsored' : ''}">
    ${cover ? `<div class="listing-media">
      <a class="listing-photo-link" href="${detail}" aria-label="Ver publicación de ${h(listing.titulo)}">
        <img class="listing-cover" src="/api${h(cover.url)}" alt="" loading="lazy">
      </a>
      ${listing.patrocinada ? sponsoredBadge : ''}
    </div>` : ''}
    <div class="listing-labels">
      <p class="eyebrow">${h(p.zona)} · ${h(p.tipo)}</p>
      ${listing.patrocinada && !cover ? sponsoredBadge : ''}
    </div>
    <div class="listing-title"><h3>${h(listing.titulo)}</h3>${favoriteButton(listing)}</div>
    <p class="muted meta">${h(metadata(p))}</p>
    <div class="row"><small>${isSale(listing) ? 'Precio de venta' : 'Alquiler publicado'}</small><strong class="money">${h(money(askingPrice(listing)))}</strong></div>
    ${isSale(listing) ? '<p><span class="tag">En venta</span></p>' : `
      <div class="row"><small>Costo mensual informado</small><strong class="money cost">${h(money(cost?.total))}</strong></div>
      <p><span class="tag">${h(adjustment(listing))}</span>${cost?.faltantes.length ? ' <small>Con datos faltantes</small>' : ''}</p>`}
    <div class="actions"><a class="quiet" href="${detail}">${isSale(listing) ? 'Ver propiedad' : 'Ver costos y proyección'}</a>
      ${canCompare ? `<button type="button" class="compare-toggle" data-compare="${listing.id}" aria-label="Comparar ${h(listing.titulo)}"
        data-operation="${isSale(listing) ? 'venta' : 'alquiler'}"
        aria-pressed="${compared.has(listing.id)}">${compared.has(listing.id) ? '✓ Seleccionado' : '+ Comparar'}</button>` : ''}</div>
  </article>`;
}

async function showListingCards(container, listings, { comparison, onFavorite } = {}) {
  const costs = await Promise.allSettled(listings.map(monthlyCost));
  if (!container.isConnected) return;

  result(container, `<div class="cards">${listings.map((listing, index) =>
    listingCard(listing, costs[index].value, Boolean(comparison))).join('')}</div>`);
  container.onclick = (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) {
      toggleFavorite(favorite);
      onFavorite?.(favorite);
    }
    comparison?.select(event);
  };
  comparison?.update();
}

const comparisonTray = `<div id="compare-tray" class="compare-tray" hidden>
  <div><strong id="compare-count"></strong><small id="compare-status" role="status"></small></div>
  <div class="actions">
    <button class="outline" type="button" id="clear-comparison">Vaciar</button>
    <button class="btn" type="button" id="open-comparison">Comparar avisos</button>
  </div>
</div>`;

function setupComparison(results, focusAfterClear) {
  const tray = main.querySelector('#compare-tray');
  const status = tray.querySelector('#compare-status');
  const action = tray.querySelector('#open-comparison');

  function update() {
    tray.hidden = !compared.size;
    action.disabled = compared.size < 2;
    tray.querySelector('#compare-count').textContent = `${compared.size} de ${maxComparedListings} avisos seleccionados`;
    const operation = compared.values().next().value;
    status.textContent = compared.size === 1 ? `Elegí otro aviso de ${operation || 'la misma operación'}.` : '';
    for (const button of results.querySelectorAll('[data-compare]')) {
      const selected = compared.has(Number(button.dataset.compare));
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '✓ Seleccionado' : '+ Comparar';
    }
  }

  function select(event) {
    const button = event.target.closest('[data-compare]');
    if (!button) return;
    const id = Number(button.dataset.compare);
    if (compared.has(id)) {
      compared.delete(id);
      update();
      return;
    }
    const operation = button.dataset.operation;
    const selectedOperation = compared.values().next().value;
    if (selectedOperation && operation !== selectedOperation) {
      status.textContent = `Ya elegiste avisos de ${selectedOperation}. Vaciá la selección para comparar avisos de ${operation}.`;
      return;
    }
    if (compared.size >= maxComparedListings) {
      status.textContent = 'Podés comparar hasta 3 avisos. Quitá uno para agregar otro.';
      return;
    }
    compared.set(id, operation);
    update();
  }

  action.onclick = openComparison;
  tray.querySelector('#clear-comparison').onclick = () => {
    compared.clear();
    update();
    focusAfterClear.focus({ preventScroll: true });
  };
  update();
  return { update, select };
}

function catalogOptions(values) {
  return [...new Set(values.filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b, 'es-AR', { numeric: true }));
}

function populateCatalogFilter(control, options) {
  const selected = control.value || filters.get(control.name) || '';
  const defaultOption = control.options[0];
  control.replaceChildren(defaultOption, ...options.map((value) => new Option(value, value)));
  if (selected && !options.includes(selected)) {
    const unavailable = new Option(selected + ' (sin avisos)', selected);
    unavailable.disabled = true;
    control.add(unavailable);
  }
  control.value = selected;
}

const resultsPageSize = 9;
const selectSponsored = (listings) => listings.filter((p) => p.patrocinada)
  .sort((a, b) => b.id - a.id).slice(0, 3);

function spreadSponsored(listings) {
  const ordered = listings.filter((p) => !p.patrocinada);
  const sponsored = listings.filter((p) => p.patrocinada);
  const gaps = ordered.length + 1;
  sponsored.forEach((listing, index) => {
    const start = Math.floor(index * gaps / sponsored.length);
    const end = Math.floor((index + 1) * gaps / sponsored.length);
    const gap = start + Math.floor(Math.random() * (end - start));
    ordered.splice(gap + index, 0, listing);
  });
  return ordered;
}

function sponsoredListings(featured) {
  if (!featured.length) return '';
  return `<h2 id="sponsored-title">Avisos patrocinados</h2>
    <div class="sponsored-list">
      ${featured.map((p) => {
        const photo = p.fotos?.[0];
        return `<a class="sponsored-card" href="#publicacion/${p.id}">
          ${photo ? `<img src="/api${h(photo.url)}" alt="" loading="lazy">` : ''}
          <div class="sponsored-info">
            <div class="listing-labels"><small>${h(p.propiedad.zona)}</small>${sponsoredBadge}</div>
            <h3>${h(p.titulo)}</h3>
            <strong>${h(money(askingPrice(p)))}</strong>
          </div>
        </a>`;
      }).join('')}
    </div>`;
}

async function search(version, returningToResults) {
  const forSale = searchOperation === 'venta';
  const catalog = '/publicaciones?operacion=' + searchOperation;
  result(main, `<section class="hero"><div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="eyebrow">${forSale ? 'Propiedades en venta en CABA' : 'Alquileres en CABA'}</p>
      <h1>${forSale ? 'Encontrá tu próximo <em>hogar en CABA</em>' : '¿Cuánto te cuesta <em>vivir acá?</em>'}</h1>
      <p>${forSale ? 'Explorá propiedades en venta por barrio, compará sus precios y contactá al anunciante para coordinar una visita.' :
        'Compará el alquiler con el costo mensual de vivir ahí. Mirá cuánto necesitás para entrar y cómo podrían cambiar los gastos con los ajustes.'}</p>
      <button class="btn hero-cta" type="button">${forSale ? 'Explorar propiedades en venta' : 'Explorar alquileres'} <span aria-hidden="true">↓</span></button>
      <div class="hero-neighborhoods" role="group" aria-label="Buscar por barrio" hidden></div>
    </div>
    <aside class="hero-data" id="featured" aria-live="polite">
      <div class="hero-feature-empty"><small>Cargando publicación…</small></div>
    </aside>
  </div></section>
  <section class="wrap content">
  <section id="sponsored-listings" class="sponsored-strip" aria-labelledby="sponsored-title" hidden></section>
  <div class="filters">
    <div class="section-head"><h2>${forSale ? 'Buscar propiedades en venta' : 'Buscar alquileres'}</h2></div>
    <form id="filters">
      ${select('Barrio', 'zona', [['', 'Todos los barrios']])}
      ${select('Ambientes', 'ambientes', [['', 'Todos los ambientes']])}
      ${select('Mascotas', 'permite_mascotas', [['','Indistinto'],['true','Acepta mascotas'],['false','No acepta mascotas']])}
      ${select('Moneda', 'moneda', [['','Todas'], ...currency])}
      <details><summary>Rangos y orden</summary><div class="fields">
        ${forSale ? `
          ${input('Precio de venta mínimo', 'precio_min', 'type="number" min="0" step="0.01"')}
          ${input('Precio de venta máximo', 'precio_max', 'type="number" min="0" step="0.01"')}` : `
        ${select('Garantía', 'tipo_garantia', [['', 'Todas las garantías']])}
        ${input('Alquiler mínimo', 'alquiler_min', 'type="number" min="0" step="0.01"')}
        ${input('Alquiler máximo', 'alquiler_max', 'type="number" min="0" step="0.01"')}
        ${input('Costo mensual mínimo', 'costo_real_min', 'type="number" min="0" step="0.01"')}
        ${input('Costo mensual máximo', 'costo_real_max', 'type="number" min="0" step="0.01"')}`}
        ${select('Ordenar por', 'orden', [['','Predeterminado'], ...(forSale ?
          [['precio','Precio de venta']] : [['alquiler','Alquiler'], ['costo_real','Costo mensual']]), ['precio_m2','Precio por m²']])}
        ${select('Sentido', 'descendente', [['false','Menor a mayor'],['true','Mayor a menor']])}
        <small class="full">Para filtrar u ordenar montos, elegí una moneda.</small>
      </div></details>
      <div class="actions"><button class="btn">Buscar</button><button class="quiet" type="reset">Limpiar</button></div>
    </form>
  </div>
  <div class="results-toolbar">
    <div id="active-filters" class="filter-chips" aria-label="Filtros activos"></div>
    <div class="actions">
      <a class="quiet" href="#guardados" id="saved-link">Guardados (${favorites.size})</a>
      <div class="share-control"><button class="quiet" type="button" id="share-search">Copiar búsqueda</button>
        <span data-copy-status role="status"></span></div>
    </div>
  </div>
  <div id="results" tabindex="-1"></div>
  <div class="results-pagination" hidden>
    <button class="outline" type="button">Cargar más</button>
  </div>
  ${comparisonTray}</section>`);
  const form = main.querySelector('#filters');
  const results = main.querySelector('#results');
  const pagination = main.querySelector('.results-pagination');
  const more = pagination.querySelector('button');
  const featured = main.querySelector('#featured');
  const sponsored = main.querySelector('#sponsored-listings');
  const quickZones = main.querySelector('.hero-neighborhoods');
  const chips = main.querySelector('#active-filters');
  const savedLink = main.querySelector('#saved-link');
  const share = main.querySelector('#share-search');
  const comparison = setupComparison(results, savedLink);
  const allListings = api(catalog);
  let listings = [];
  let shown = 0;
  function syncForm() {
    for (const key of Object.keys(searchFilterLabels)) {
      const control = form.elements[key];
      if (control) control.value = filters.get(key) || (key === 'descendente' ? 'false' : '');
    }
  }
  syncForm();
  if ([...filters].some(([key, value]) => form.elements[key].closest('details') && value !== 'false')) {
    form.querySelector('details').open = true;
  }
  let revision = 0;
  function updateToolbar() {
    sponsored.hidden = filters.size > 0 || !sponsored.hasChildNodes();
    savedLink.textContent = `Guardados (${favorites.size})`;
    result(chips, filterChips());
    share.dataset.copy = searchLink();
    comparison.update();
  }

  async function showMore(limit, current = revision) {
    const batch = listings.slice(shown, limit);
    const cards = results.querySelector('.cards');
    more.disabled = true;
    const costs = await Promise.allSettled(batch.map(monthlyCost));
    if (version !== routeVersion || current !== revision) return;
    const previous = cards.childElementCount;
    cards.insertAdjacentHTML('beforeend', batch.map((p, i) => listingCard(p, costs[i].value)).join(''));
    shown += batch.length;
    resultsProgress = { link: searchLink(), shown, ids: listings.map((p) => p.id) };
    results.querySelector('[data-results-count]').textContent = `Mostrando ${shown} de ${listings.length}`;
    if (costs.some((item) => item.status === 'rejected')) {
      results.querySelector('[data-results-warning]').hidden = false;
    }
    if (document.activeElement === more) {
      cards.children[previous]?.querySelector('a')?.focus({ preventScroll: true });
    }
    pagination.hidden = shown >= listings.length;
    more.disabled = false;
  }
  more.onclick = () => showMore(shown + resultsPageSize);

  async function load(initial = false) {
    const current = ++revision;
    shown = 0;
    pagination.hidden = true;
    updateToolbar();
    result(results, '<p role="status">Buscando publicaciones…</p>');
    try {
      const found = await (filters.size ? api(catalog + '&' + filters) : initial ? allListings : api(catalog));
      if (version !== routeVersion || current !== revision) return;
      const featuredListings = filters.size ? [] : selectSponsored(found);
      if (!filters.size) {
        result(sponsored, sponsoredListings(featuredListings));
        sponsored.hidden = !featuredListings.length;
      }
      const progress = initial && returningToResults && resultsProgress?.link === searchLink()
        ? resultsProgress : null;
      listings = found;
      if (!filters.size) {
        listings = spreadSponsored(found);
        if (progress) {
          const positions = new Map(progress.ids.map((id, index) => [id, index]));
          listings.sort((a, b) =>
            (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
        }
      } else if (!filters.has('orden')) {
        listings.sort((a, b) => Number(b.patrocinada) - Number(a.patrocinada));
      }
      result(results, `<div class="section-head"><h2>Resultados</h2><small role="status" data-results-count></small></div>` +
        '<p class="notice warn" data-results-warning hidden>Algunos costos no se pudieron consultar.</p>' +
        (listings.length ? '<div class="cards"></div>' :
          note('No encontramos publicaciones con esos filtros.')));
      if (!listings.length) return;
      await showMore(progress?.shown ?? resultsPageSize, current);
    } catch (error) {
      if (version === routeVersion && current === revision) result(results, note(error.message, 'error'));
    }
  }
  function applyFilters(next) {
    setSearchFilters(next);
    history.replaceState(history.state, '', searchLink());
    share.parentElement.querySelector('[data-copy-status]').textContent = '';
    syncForm();
    load();
  }
  form.onsubmit = (event) => { event.preventDefault(); applyFilters(new FormData(form)); };
  form.onreset = (event) => { event.preventDefault(); applyFilters([]); };
  chips.onclick = (event) => {
    const chip = event.target.closest('[data-remove-filter]');
    if (!chip) return;
    const key = chip.dataset.removeFilter;
    const next = new URLSearchParams(filters);
    next.delete(key);
    if (key === 'moneda') {
      for (const dependent of ['orden', 'alquiler_min', 'alquiler_max', 'costo_real_min', 'costo_real_max', 'precio_min', 'precio_max']) next.delete(dependent);
    }
    applyFilters(next);
    (chips.querySelector('button') || form.elements.zona).focus({preventScroll: true});
  };
  results.onclick = (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) {
      toggleFavorite(favorite);
      savedLink.textContent = `Guardados (${favorites.size})`;
    }
    comparison.select(event);
  };
  main.querySelector('.hero-cta').onclick = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
  };
  quickZones.onclick = (event) => {
    const button = event.target.closest('[data-zone]');
    if (!button) return;
    form.elements.zona.value = button.dataset.zone;
    form.requestSubmit();
    form.elements.zona.focus();
  };
  const featuredLoad = (async () => {
    try {
      const listings = await allListings;
      if (version !== routeVersion) return;
      const neighborhoods = catalogOptions(listings.map((listing) => listing.propiedad.zona));
      populateCatalogFilter(form.elements.zona, neighborhoods);
      populateCatalogFilter(form.elements.ambientes, catalogOptions(listings.map((listing) => listing.propiedad.ambientes)));
      if (!forSale) populateCatalogFilter(form.elements.tipo_garantia,
        catalogOptions(listings.map((listing) => listing.tipo_garantia_aceptada)));
      result(quickZones, neighborhoods.slice(0, 5).map((zone) =>
        `<button type="button" data-zone="${h(zone)}">${h(zone)}</button>`).join(''));
      quickZones.hidden = !neighborhoods.length;
      const p = listings.find((item) => !item.patrocinada && item.fotos?.length) ||
        listings.find((item) => !item.patrocinada) || listings[0];
      if (!p) {
        result(featured, '<div class="hero-feature-empty"><p>Elegí un barrio para explorar las publicaciones.</p></div>');
        return;
      }
      const cost = await monthlyCost(p);
      if (version !== routeVersion) return;
      const cover = p.fotos?.[0];
      const isExample = ['semilla', 'demo-fotos', 'demo-venta'].includes(p.fuente);
      result(featured, `
        ${cover ? `<img class="hero-photo" src="/api${h(cover.url)}" alt="Foto de la propiedad en ${h(p.propiedad.zona)}" fetchpriority="high">` : ''}
        <div class="hero-feature-body">
          <div class="hero-feature-head">
            <div><h2>${h(p.propiedad.zona)}</h2><small>${h(metadata(p.propiedad))}</small></div>
            ${p.patrocinada ? sponsoredBadge :
              isExample ? '<span class="tag">Aviso de ejemplo</span>' : ''}
          </div>
          <dl class="hero-prices">
            <div><dt>${forSale ? 'Precio de venta' : 'Alquiler publicado'}</dt><dd>${h(money(askingPrice(p)))}</dd></div>
            ${forSale ? '' : `<div><dt>Costo mensual informado</dt><dd>${h(money(cost.total))}</dd></div>`}
          </dl>
          <a href="#publicacion/${p.id}">${forSale ? 'Ver propiedad' : 'Ver desglose'} <span aria-hidden="true">↗</span></a>
        </div>`);
    } catch {
      result(featured, note('No pudimos cargar la publicación destacada.'));
    }
  })();
  await Promise.all([load(true), featuredLoad]);
}

async function savedListingsPage(queryString, version) {
  const params = new URLSearchParams(queryString);
  const isShared = params.has('avisos');
  const ids = isShared ? new Set(params.get('avisos').split(',')
    .filter((id) => /^\d+$/.test(id)).map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)) : favorites;

  result(main, `<div class="wrap content">
    <a class="back" href="${h(searchLink())}">Volver a publicaciones</a>
    <div class="section-head saved-page-heading">
      <div><h1>${isShared ? 'Guardados compartidos' : 'Avisos guardados'}</h1>
        <p class="muted" id="saved-count" aria-live="polite"></p></div>
      <div class="actions">
        ${isShared ? '<a class="quiet" href="#guardados">Mis guardados</a>' : ''}
        <div class="share-control"><button class="btn" type="button" id="share-saved" disabled>Copiar enlace de guardados</button>
          <span data-copy-status role="status"></span></div>
      </div>
    </div>
    <div id="saved-results"></div>
    ${comparisonTray}
  </div>`);

  const output = main.querySelector('#saved-results');
  const share = main.querySelector('#share-saved');
  const count = main.querySelector('#saved-count');
  const back = main.querySelector('.back');
  const comparison = setupComparison(output, back);
  const visibleIds = new Set();

  function updateSavedPage() {
    const size = visibleIds.size;
    count.textContent = `${size} ${size === 1 ? 'aviso' : 'avisos'}`;
    share.disabled = !size;
    share.dataset.copy = sharedFavoritesLink(visibleIds);
    if (!size) result(output, note(isShared ?
      'Los avisos de este enlace ya no están disponibles.' :
      'Tocá el corazón de una publicación para guardarla acá.'));
  }

  if (!ids.size) {
    updateSavedPage();
    return;
  }
  result(output, note('Cargando avisos guardados…'));
  const listings = await api('/publicaciones');
  if (version !== routeVersion) return;
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const selected = [...ids].map((id) => byId.get(id)).filter(Boolean);
  for (const listing of selected) visibleIds.add(listing.id);
  updateSavedPage();
  if (!selected.length) return;

  await showListingCards(output, selected, {
    comparison,
    onFavorite(button) {
      if (isShared) return;
      visibleIds.delete(Number(button.dataset.favorite));
      button.closest('article').remove();
      share.parentElement.querySelector('[data-copy-status]').textContent = '';
      updateSavedPage();
      (output.querySelector('[data-favorite]') || back).focus({ preventScroll: true });
    },
  });
}

async function openComparison() {
  const request = ++comparisonRequest;
  const panel = document.querySelector('#compare-dialog');
  const sourceUrl = location.href;
  const output = panel.querySelector('#compare-body');
  let pressedOutside = false;
  function isBackdrop(event) {
    if (event.target !== panel) return false;
    const { left, right, top, bottom } = panel.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  }
  panel.onpointerdown = (event) => { pressedOutside = isBackdrop(event); };
  panel.onclick = (event) => {
    if (pressedOutside && isBackdrop(event)) panel.close();
    pressedOutside = false;
  };
  panel.querySelector('.close').onclick = () => panel.close();
  panel.onclose = () => {
    if (!panel.open && location.href === sourceUrl && history.state?.returnComparison) {
      history.replaceState({ ...history.state, returnComparison: null }, '');
    }
  };
  const ids = [...compared.keys()];
  result(output, note('Cargando comparación…'));
  panel.showModal();

  const records = await Promise.allSettled(ids.map(async (id) => {
    const path = '/publicaciones/' + id;
    const listing = await api(path);
    const [monthly, entry] = await Promise.all([
      monthlyCost(listing), isSale(listing) ? null : api(path + '/costo-entrada'),
    ]);
    return {listing, monthly, entry};
  }));
  if (!panel.open || request !== comparisonRequest) return;
  const choices = records.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  if (choices.length < 2) {
    result(output, note('Necesitás dos avisos disponibles para comparar.', 'warn'));
    return;
  }

  const forSale = isSale(choices[0].listing);
  if (choices.some(({listing}) => isSale(listing) !== forSale)) {
    result(output, note('Elegí avisos de la misma operación para compararlos.', 'warn'));
    return;
  }

  const operation = forSale ? 'venta' : 'alquiler';
  for (const {listing} of choices) compared.set(listing.id, operation);
  const missingText = (cost) => cost.faltantes.length ? cost.faltantes.map(label).join(', ') : 'Sin faltantes';
  const rows = [
    ['Barrio', ({listing}) => listing.propiedad.zona],
    [forSale ? 'Precio de venta' : 'Alquiler publicado', ({listing}) => money(askingPrice(listing))],
    ...(!forSale ? [
    ['Costo mensual informado', ({monthly}) => money(monthly.total), 'comparison-monthly'],
    ['Costo de entrada informado', ({entry}) => money(entry.total)],
    ['Gastos mensuales faltantes', ({monthly}) => missingText(monthly)],
    ['Gastos de entrada faltantes', ({entry}) => missingText(entry)],
    ] : []),
  ];
  result(output, `
    ${choices.length < ids.length ? note('Un aviso ya no está disponible.', 'warn') : ''}
    ${new Set(choices.map(({listing}) => askingPrice(listing).moneda)).size > 1 ?
      note('Hay avisos en distintas monedas. Cada importe se muestra en su moneda original.') : ''}
    <div class="comparison-table table-wrap" tabindex="0" role="region" aria-label="Tabla de comparación">
      <table><thead><tr><th scope="col">Detalle</th>${choices.map(({listing}) => {
        const cover = listing.fotos?.[0];
        return `<th scope="col"><a class="comparison-listing" href="#publicacion/${listing.id}">
          ${cover ? `<img class="comparison-cover" src="/api${h(cover.url)}" alt="">` :
            '<span class="comparison-cover comparison-no-photo">Sin foto</span>'}
          <span>${h(listing.titulo)}</span>
        </a></th>`;
      }).join('')}</tr></thead>
      <tbody>${rows.map(([title, value, style = '']) => `<tr class="${style}"><th scope="row">${title}</th>${choices.map((choice) =>
        `<td>${h(value(choice))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </div>`);
  for (const link of output.querySelectorAll('.comparison-listing')) {
    link.onclick = (event) => {
      if (!isSameTabClick(event)) return;
      event.preventDefault();
      history.replaceState({
        ...history.state, returnComparison: { ids, operation, scrollY: window.scrollY },
      }, '');
      history.pushState({ comparisonBack: sourceUrl }, '', link.href);
      route();
    };
  }
}

function isSameTabClick(event) {
  return event.button === 0 && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
}
function costPanel(title, cost, tone) {
  return `<section class="panel ${tone}"><h2>${title}</h2><strong class="value">${h(money(cost.total))}</strong>
    ${Object.entries(cost.componentes_informados).map(([key, value]) =>
      `<div class="row"><span>${h(label(key))}</span><strong class="money">${h(money(value))}</strong></div>`).join('')}
    ${missing(cost.faltantes)}</section>`;
}

function accountPage(params) {
  if (!user) {
    result(main, `<div class="wrap content"><h1>Mi cuenta</h1>
      <section class="panel">${loginPrompt('Ingresá para ver tus datos.')}</section></div>`);
    return;
  }

  const agency = user.rol === 'INMOBILIARIA';
  result(main, `<div class="wrap content">
    <a class="back" href="${h(searchLink())}">Volver a publicaciones</a>
    <div class="section-head"><h1>Mi cuenta</h1><span class="tag">${h(roleNames[user.rol])}</span></div>
    <div class="pair account-page-panels">
      <section class="panel teal"><h2>Datos de la cuenta</h2>
        <form id="account-profile-form">
          ${input(agency ? 'Nombre de la inmobiliaria' : 'Nombre', 'nombre', `required maxlength="100" value="${h(user.nombre)}" autocomplete="${agency ? 'organization' : 'given-name'}"`)}
          ${agency ? input('Nombre de contacto', 'nombre_contacto', `maxlength="100" value="${h(user.nombre_contacto)}" autocomplete="given-name"`) : ''}
          ${input('Apellido', 'apellido', `maxlength="100" value="${h(user.apellido)}" autocomplete="family-name"`)}
          ${input('Correo electrónico', 'email', `type="email" value="${h(user.email)}" readonly`)}
          ${input('Teléfono', 'telefono', `type="tel" maxlength="32" value="${h(user.telefono)}" autocomplete="tel"`)}
          ${submitButton('Guardar mis datos')}
        </form>
      </section>
      <section class="panel"><h2>Ingreso de referencia</h2>
        <p class="muted">Lo usamos para calcular qué parte de tu ingreso representa el alquiler.</p>
        <form id="income-form">
          ${input('Ingreso mensual de referencia', 'monto', `type="number" min="0.01" step="0.01" required value="${h(user.ingreso_referencia?.monto)}"`)}
          ${select('Moneda', 'moneda', currency)}${submitButton('Guardar ingreso')}
        </form>
      </section>
    </div>
  </div>`);
  const profile = main.querySelector('#account-profile-form');
  submit(profile, async (data, output) => {
    data.delete('email');
    const fields = Object.fromEntries([...data].map(([key, value]) => [key, value.trim() || null]));
    const updated = await api('/usuarios/me', 'PUT', fields);
    setUser(updated, token);
    profile.elements.telefono.value = updated.telefono ?? '';
    result(output, note('Guardamos tus datos.'));
  });
  const income = main.querySelector('#income-form');
  income.elements.moneda.value = user.ingreso_referencia?.moneda || 'ARS';
  submit(income, async (data, output) => {
    setUser(await api('/usuarios/me/ingreso-referencia', 'PUT', Object.fromEntries(data)), token);
    result(output, note('Guardamos tu ingreso.'));
  });
  if (params.get('seccion') === 'ingreso') income.elements.monto.focus();
}

function photoInput() {
  return `<div class="photo-picker">
    <label class="photo-select">
      <input class="photo-select-input" name="fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <span class="photo-select-icon" aria-hidden="true">+</span>
      <span class="photo-select-copy">
        <strong>Elegir fotos</strong>
        <small>Podés seleccionar varias a la vez.</small>
      </span>
      <span class="photo-select-arrow" aria-hidden="true">↗</span>
    </label>
    <p class="photo-picker-count muted" aria-live="polite"></p>
    <div class="photo-picker-error" aria-live="polite"></div>
    <ol class="photo-previews" aria-label="Orden de las fotos seleccionadas"></ol>
  </div>`;
}

function validatePhotos(photos, available) {
  if (photos.length > available) {
    throw new Error(`Podés guardar hasta ${maxListingPhotos} fotos por publicación.`);
  }
  if (photos.some((photo) => photo.size > 5 * 1024 * 1024)) {
    throw new Error('Cada foto puede pesar hasta 5 MB.');
  }
}

function setupPhotoPicker(form, alreadySaved = 0) {
  const picker = form.querySelector('.photo-picker');
  const input = picker.querySelector('input');
  const count = picker.querySelector('.photo-picker-count');
  const error = picker.querySelector('.photo-picker-error');
  const list = picker.querySelector('.photo-previews');
  const selected = [];
  let dragging;

  function render() {
    count.textContent = `Fotos seleccionadas: ${selected.length} de ${maxListingPhotos - alreadySaved}` +
      (selected.length > 1 ? ' · Arrastrá las fotos o usá las flechas para ordenarlas.' : '.');
    result(list, selected.map(({ file, url }, index) => {
      const position = alreadySaved + index + 1;
      return `<li class="photo-preview" data-position="${index}">
        <div class="photo-preview-image">
          <img src="${h(url)}" alt="" draggable="false">
          <span class="tag">${position === 1 ? 'Portada' : 'Foto ' + position}</span>
          <span class="photo-grip" draggable="true" title="Arrastrar para mover" aria-hidden="true">⠿</span>
        </div>
        <div class="photo-preview-info">
          <strong title="${h(file.name)}">${h(file.name)}</strong>
          <small>${file.size < 1024 * 1024 ? number(file.size / 1024) + ' KB' : number(file.size / (1024 * 1024)) + ' MB'}</small>
          <div class="photo-preview-controls">
            <button class="quiet" type="button" data-action="earlier" aria-label="Mover foto ${position} antes" ${index === 0 ? 'disabled' : ''}>←</button>
            <button class="quiet" type="button" data-action="later" aria-label="Mover foto ${position} después" ${index === selected.length - 1 ? 'disabled' : ''}>→</button>
            <button class="quiet" type="button" data-action="remove" aria-label="Quitar foto ${position}">Quitar</button>
          </div>
        </div>
      </li>`;
    }).join(''));
  }

  function move(from, to) {
    if (from === to) return;
    selected.splice(to, 0, ...selected.splice(from, 1));
    render();
  }

  input.onchange = () => {
    const files = Array.from(input.files);
    input.value = '';
    try {
      validatePhotos(files, maxListingPhotos - alreadySaved - selected.length);
      selected.push(...files.map((file) => ({ file, url: URL.createObjectURL(file) })));
      result(error, '');
      render();
    } catch (problem) {
      result(error, note(problem.message, 'error'));
    }
  };

  list.onclick = (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const index = Number(button.closest('[data-position]').dataset.position);
    const action = button.dataset.action;
    let to = index;
    if (action === 'remove') {
      const [photo] = selected.splice(index, 1);
      URL.revokeObjectURL(photo.url);
      result(error, '');
      render();
      to = Math.min(index, selected.length - 1);
    } else {
      to = index + (action === 'earlier' ? -1 : 1);
      move(index, to);
    }
    const card = list.querySelector(`[data-position="${to}"]`);
    (card?.querySelector(`[data-action="${action}"]:not(:disabled)`) ||
      card?.querySelector('[data-action="remove"]') || input).focus();
  };

  list.ondragstart = (event) => {
    const grip = event.target.closest('.photo-grip');
    if (!grip || selected.length < 2) {
      event.preventDefault();
      return;
    }
    dragging = Number(grip.closest('[data-position]').dataset.position);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragging));
  };
  list.ondragover = (event) => {
    const card = event.target.closest('[data-position]');
    if (dragging === undefined || !card) return;
    event.preventDefault();
    list.querySelector('.photo-drop-target')?.classList.remove('photo-drop-target');
    card.classList.toggle('photo-drop-target', Number(card.dataset.position) !== dragging);
  };
  list.ondragend = () => {
    dragging = undefined;
    list.querySelector('.photo-drop-target')?.classList.remove('photo-drop-target');
  };
  list.ondrop = (event) => {
    const card = event.target.closest('[data-position]');
    if (dragging === undefined || !card) return;
    event.preventDefault();
    const from = dragging;
    list.ondragend();
    move(from, Number(card.dataset.position));
  };

  releasePhotoPreviews = () => selected.forEach(({ url }) => URL.revokeObjectURL(url));
  render();
  return () => selected.map(({ file }) => file);
}

async function uploadPhotos(path, photos) {
  const data = new FormData();
  for (const photo of photos) data.append('fotos', photo);
  await api(path + '/fotos', 'POST', data);
}

function publicationActions(p) {
  return `<div class="detail-utilities" role="group" aria-label="Guardar y compartir este aviso">
    ${favoriteButton(p)}
    <div class="share-control"><button class="quiet" type="button" data-copy="#publicacion/${p.id}">Copiar enlace</button>
      <span data-copy-status role="status"></span></div>
  </div>`;
}

function publicationFeatures(publication) {
  const { ambientes, metros_cuadrados, permite_mascotas } = publication.propiedad;
  const features = [
    ['M4 21h16M6 21V5l10-2v18m0-16h2v16m-5-9v1', roomLabel(ambientes)],
    ['M4 4h16v16H4zM8 16l8-8m-5 0h5v5',
      metros_cuadrados != null ? number(metros_cuadrados) + ' m²' : null],
    ['M8.5 21c-2.5 0-3.2-2.3-1.6-4l2.8-3a3 3 0 0 1 4.6 0l2.8 3c1.6 1.7.9 4-1.6 4-1.4 0-2.1-1-3.5-1s-2.1 1-3.5 1ZM5 9a1.7 2.1 0 1 0 0 4.2A1.7 2.1 0 1 0 5 9Zm4-5a1.7 2.1 0 1 0 0 4.2A1.7 2.1 0 1 0 9 4Zm6 0a1.7 2.1 0 1 0 0 4.2A1.7 2.1 0 1 0 15 4Zm4 5a1.7 2.1 0 1 0 0 4.2A1.7 2.1 0 1 0 19 9Z',
      permite_mascotas == null ? null : permite_mascotas ? 'Acepta mascotas' : 'No acepta mascotas'],
    ['M3 19h18M5 15l5-5 4 3 5-7m-5 0h5v5',
      publication.tipo_ajuste ? 'Ajuste ' + adjustment(publication) : null],
  ];

  return `<ul class="panel publication-features" role="list" aria-label="Características de la publicación">
    ${features.filter(([, label]) => label).map(([path, label]) => `<li>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>
      <span>${h(label)}</span>
    </li>`).join('')}
  </ul>`;
}

function publicationPhotos(p) {
  const photos = p.fotos || [];
  const canEdit = canManagePublication(p);
  if (!photos.length && !canEdit) return `<div class="detail-toolbar">${publicationActions(p)}</div>`;

  const previews = photos.slice(0, 3);
  const galleryLabel = photos.length === 1 ? 'Ampliar foto' : `Ver las ${photos.length} fotos`;
  return `<section class="publication-photos" aria-labelledby="publication-photos-title">
    <div class="detail-toolbar photo-toolbar">
      <h2 id="publication-photos-title">Fotos de la propiedad</h2>
      ${publicationActions(p)}
    </div>
    ${previews.length ? `<div class="photo-mosaic photo-mosaic-${previews.length}">${previews.map((photo, index) => `
      <button type="button" class="gallery-trigger" data-gallery-open="${index}"
        aria-label="${index === 0 ? galleryLabel : 'Ampliar foto ' + (index + 1)}">
        <img src="/api${h(photo.url)}" alt="" ${index === 0 ? '' : 'loading="lazy"'}>
        ${index === 0 ? `<span class="gallery-cta"><span aria-hidden="true">⤢</span> ${galleryLabel}</span>` : ''}
      </button>`).join('')}</div>` : ''}
    <div id="photo-message" aria-live="polite"></div>
    ${canEdit ? photoManagement(p, !photos.length || photoUploadError?.id === p.id) : ''}
  </section>`;
}

function photoManagement(p, open, privatePhotos = false) {
  const photos = p.fotos || [];
  return `<details class="panel photo-management" ${open ? 'open' : ''}>
    <summary>Administrar fotos</summary>
    ${photos.length ? `<div class="photo-management-list">${photos.map((photo, index) => `
        <figure>
          <img ${privatePhotos ?
            `data-private-photo="${photo.id}"` : `src="/api${h(photo.url)}"`} alt="" loading="lazy">
          <figcaption><span>${index === 0 ? 'Portada' : 'Foto ' + (index + 1)}</span>
            <button type="button" class="quiet" data-delete-photo="${photo.id}"
              aria-label="Eliminar foto ${index + 1}">Eliminar</button>
          </figcaption>
        </figure>`).join('')}</div>` : ''}
      ${photos.length < maxListingPhotos ? `<form id="photo-form">
        <p class="muted"><small>JPG, PNG o WebP de hasta 5 MB cada una.</small></p>
        ${photoInput()}
        ${submitButton('Agregar fotos')}
      </form>` : ''}
    </details>`;
}

function setupPublicationPhotos(p, path, refreshManagedPhotos) {
  async function refreshPhotos(control) {
    if (!control.isConnected) return;
    if (refreshManagedPhotos) {
      await refreshManagedPhotos();
      return;
    }
    const previousHash = location.hash;
    await route();
    if (location.hash === previousHash) {
      main.querySelector('.photo-management')?.setAttribute('open', '');
    }
  }

  for (const button of main.querySelectorAll('[data-gallery-open]')) {
    button.onclick = () => openGallery(p, Number(button.dataset.galleryOpen));
  }
  if (photoUploadError?.id === p.id) {
    const output = main.querySelector('#photo-message');
    if (output) result(output, note(photoUploadError.message, 'warn'));
    photoUploadError = undefined;
  }
  const form = main.querySelector('#photo-form');
  if (form) {
    const getPhotos = setupPhotoPicker(form, p.fotos.length);
    submit(form, async () => {
      const photos = getPhotos();
      if (!photos.length) throw new Error('Elegí al menos una foto para agregar.');
      await uploadPhotos(path, photos);
      await refreshPhotos(form);
    });
  }

  for (const button of main.querySelectorAll('[data-delete-photo]')) {
    button.onclick = async () => {
      if (!window.confirm('¿Eliminar esta foto de la publicación?')) return;
      const output = main.querySelector('#photo-message');
      button.disabled = true;
      try {
        await api(path + '/fotos/' + button.dataset.deletePhoto, 'DELETE');
        await refreshPhotos(button);
      } catch (error) {
        result(output, note(error.message, 'error'));
      } finally {
        button.disabled = false;
      }
    };
  }
}

function loadManagedPhotos(path) {
  const images = main.querySelectorAll('[data-private-photo]');
  if (!images.length) return;
  const controller = new AbortController();
  const urls = [];
  releaseManagedPhotos = () => {
    controller.abort();
    for (const url of urls) URL.revokeObjectURL(url);
  };
  for (const image of images) {
    fetch('/api' + path + '/fotos/' + image.dataset.privatePhoto, {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Foto no disponible.');
      const file = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file);
      urls.push(url);
      image.src = url;
    }).catch(() => {
      if (!controller.signal.aborted) image.alt = 'Foto no disponible';
    });
  }
}

function openGallery(listing, start) {
  const panel = document.querySelector('#gallery-dialog');
  const photos = listing.fotos;
  const image = panel.querySelector('#gallery-image');
  const frame = panel.querySelector('.gallery-photo');
  const zoomReset = panel.querySelector('.gallery-reset-zoom');
  const count = panel.querySelector('#gallery-count');
  const arrows = panel.querySelectorAll('[data-gallery-step]');
  const thumbnails = panel.querySelector('#gallery-thumbs');
  let index = start;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let pointer;
  let pressedOutside = false;

  panel.querySelector('#gallery-title').textContent = listing.titulo;
  thumbnails.hidden = photos.length < 2;
  result(thumbnails, photos.length < 2 ? '' : photos.map((photo, position) =>
    `<button type="button" class="gallery-thumb" data-gallery-index="${position}" aria-label="Ver foto ${position + 1}">
      <img src="/api${h(photo.url)}" alt="" loading="lazy">
    </button>`).join(''));
  const choices = [...thumbnails.children];

  function limitOffset(offset, size, center, viewport) {
    const start = size / 2 - center;
    const end = viewport - size / 2 - center;
    return Math.max(Math.min(start, end), Math.min(Math.max(start, end), offset));
  }

  function applyZoom() {
    if (zoom > 1) {
      const rect = frame.getBoundingClientRect();
      const viewport = document.documentElement;
      offsetX = limitOffset(offsetX, image.offsetWidth * zoom, rect.left + rect.width / 2, viewport.clientWidth);
      offsetY = limitOffset(offsetY, image.offsetHeight * zoom, rect.top + rect.height / 2, viewport.clientHeight);
    }
    image.style.transform = zoom === 1 ? '' : `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
    image.classList.toggle('zoomed', zoom > 1);
    zoomReset.hidden = zoom === 1;
    zoomReset.textContent = Math.round(zoom * 100) + '%';
  }

  function resetZoom() {
    zoom = 1;
    offsetX = offsetY = 0;
    pointer = undefined;
    image.classList.remove('panning');
    applyZoom();
  }

  function render() {
    resetZoom();
    image.src = '/api' + photos[index].url;
    image.alt = `Foto ${index + 1} de ${listing.titulo}`;
    count.textContent = `${index + 1} de ${photos.length}`;
    for (const arrow of arrows) arrow.hidden = photos.length < 2;
    choices.forEach((button, position) => {
      if (position === index) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    choices[index]?.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  }

  function move(step) {
    if (photos.length < 2) return;
    index = (index + step + photos.length) % photos.length;
    render();
  }

  function isBackdrop(event) {
    return event.target === panel || event.target.matches('.gallery-stage, .gallery-photo');
  }

  panel.onpointerdown = (event) => { pressedOutside = isBackdrop(event); };
  panel.onclick = (event) => {
    if (pressedOutside && isBackdrop(event)) panel.close();
    pressedOutside = false;
  };
  panel.querySelector('[data-gallery-close]').onclick = () => panel.close();
  zoomReset.onclick = () => {
    resetZoom();
    panel.querySelector('[data-gallery-close]').focus();
  };
  for (const arrow of arrows) arrow.onclick = () => move(Number(arrow.dataset.galleryStep));
  thumbnails.onclick = (event) => {
    const selected = event.target.closest('[data-gallery-index]');
    if (selected) {
      index = Number(selected.dataset.galleryIndex);
      render();
    }
  };
  panel.onkeydown = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  image.onwheel = (event) => {
    if (event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
    const next = Math.max(1, Math.min(3, zoom * Math.exp(-event.deltaY * unit * .002)));
    if (next === zoom) return;
    if (next === 1) {
      resetZoom();
      return;
    }
    const rect = frame.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    offsetX = x - (x - offsetX) * next / zoom;
    offsetY = y - (y - offsetY) * next / zoom;
    zoom = next;
    applyZoom();
  };
  image.ondblclick = () => { if (zoom > 1) resetZoom(); };
  image.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0 || (zoom === 1 && event.pointerType !== 'touch')) return;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, offsetX, offsetY, pan: zoom > 1};
    image.setPointerCapture(event.pointerId);
    image.classList.toggle('panning', pointer.pan);
  };
  image.onpointermove = (event) => {
    if (!pointer?.pan || pointer.id !== event.pointerId) return;
    offsetX = pointer.offsetX + event.clientX - pointer.x;
    offsetY = pointer.offsetY + event.clientY - pointer.y;
    applyZoom();
  };
  image.onpointerup = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const distance = event.clientX - pointer.x;
    const swipe = !pointer.pan && Math.abs(distance) > 36;
    pointer = undefined;
    image.classList.remove('panning');
    if (swipe) move(distance > 0 ? -1 : 1);
  };
  image.onpointercancel = () => {
    pointer = undefined;
    image.classList.remove('panning');
  };
  panel.showModal();
  render();
}

function whatsappField(number = '') {
  return `<div class="whatsapp-field validated-field">
    ${input('WhatsApp de contacto (opcional)', 'whatsapp',
      `type="tel" maxlength="40" autocomplete="tel" placeholder="+54 9 11 1234-5678" aria-describedby="whatsapp-help whatsapp-error" value="${h(number)}"`)}
    <small id="whatsapp-help">Usá tu número comercial. Para un celular de CABA, el formato es +54 9 11 1234-5678.</small>
    <p id="whatsapp-error" class="field-error" aria-live="polite" hidden></p>
  </div>`;
}

function phoneFormatError(value, showIncomplete) {
  const compact = value.replace(/[ ().-]/g, '');
  if (value && !compact.startsWith('+54')) return 'Empezá con +54, el código de Argentina.';
  if (value && showIncomplete && !/^\+54(?:9)?[1-9][0-9]{9}$/.test(compact)) {
    return 'Revisá el número completo. Por ejemplo, +54 9 11 1234-5678.';
  }
  return '';
}

function setupFieldFeedback(input, feedback, errorFor) {
  function validate(showIncomplete) {
    const message = errorFor(input.value.trim(), showIncomplete);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    feedback.hidden = !message;
    feedback.textContent = message;
    return !message;
  }
  input.oninput = () => validate(input.getAttribute('aria-invalid') === 'true');
  input.onblur = () => validate(true);
  return validate;
}

function setupAccountContactValidation(form, register) {
  const email = form.elements.email;
  const rules = [['email', (value, showIncomplete) => {
    if (!showIncomplete) return '';
    if (!value) return 'Ingresá tu correo electrónico.';
    return email.validity.typeMismatch || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ?
      'Ingresá un correo válido. Por ejemplo, nombre@ejemplo.com.' : '';
  }]];
  if (register) rules.unshift(['telefono', (value, showIncomplete) =>
    !value && showIncomplete ? 'Ingresá tu teléfono con +54 y código de área.' : phoneFormatError(value, showIncomplete)]);

  const fields = rules.map(([name, errorFor]) => {
    const field = form.elements[name];
    const validate = setupFieldFeedback(field, form.querySelector('#' + name + '-error'), errorFor);
    field.addEventListener('invalid', (event) => {
      event.preventDefault();
      validate(true);
      if (field === form.querySelector(':invalid')) field.focus();
    });
    return { field, validate };
  });

  return () => {
    const invalid = fields.filter(({ validate }) => !validate(true));
    invalid[0]?.field.focus();
    return !invalid.length;
  };
}

function setupWhatsAppValidation(form) {
  const input = form.elements.whatsapp;
  const validate = setupFieldFeedback(input, form.querySelector('#whatsapp-error'), phoneFormatError);
  return () => {
    if (validate(true)) return true;
    input.focus();
    return false;
  };
}

function openWhatsAppContact(publication) {
  const { propiedad: property, titulo, id, whatsapp_url: whatsappUrl } = publication;
  result(dialogBody, `<h2 id="dialog-title">Contactá al anunciante</h2>
    <div class="contact-property">
      <strong>${h(titulo)}</strong>
      <small>${h(property.zona)} · Aviso #${h(id)}</small>
    </div>
    <form id="contact-form" class="contact-form">
      <div class="contact-fields">
        ${input('Tu nombre', 'nombre', 'required maxlength="100" autocomplete="name" placeholder="Ej. Lucía Pérez"')}
        ${input('Email (opcional)', 'email', 'type="email" maxlength="254" autocomplete="email" placeholder="nombre@correo.com"')}
      </div>
      ${input('Teléfono (opcional)', 'telefono', 'type="tel" maxlength="30" autocomplete="tel" placeholder="Ej. +54 9 11 1234-5678"')}
      <label>¿Querés agregar algo? (opcional)
        <textarea name="consulta" rows="2" maxlength="500" placeholder="Ej. ¿Podría coordinar una visita esta semana?"></textarea>
      </label>
      <label>Vista previa del mensaje
        <textarea name="mensaje" class="contact-preview" rows="4" readonly></textarea>
      </label>
      <small>Se incluyen los datos que completes. El envío se confirma en WhatsApp.</small>
      <button type="submit" class="btn">Abrir WhatsApp <span aria-hidden="true">↗</span></button>
    </form>`);

  const form = dialogBody.querySelector('#contact-form');
  const { nombre, email, telefono, consulta, mensaje } = form.elements;
  nombre.value = user?.nombre ?? '';

  function updateMessage() {
    const name = nombre.value.trim();
    const greeting = name ? `Hola, mi nombre es ${name}.` : 'Hola, buen día.';
    const contact = [
      email.value.trim() && `Email: ${email.value.trim()}`,
      telefono.value.trim() && `Teléfono: ${telefono.value.trim()}`,
    ].filter(Boolean);

    mensaje.value = [
      `${greeting} Vi en Alquilómetro el aviso «${titulo}» (#${id}) y me interesa ${isSale(publication) ? 'comprar' : 'alquilar'} la propiedad.`,
      '¿Podrían confirmarme si sigue disponible y cómo puedo coordinar una visita?',
      consulta.value.trim(),
      contact.join('\n'),
      'Muchas gracias. Quedo pendiente de su respuesta.',
    ].filter(Boolean).join('\n\n');
  }

  form.oninput = updateMessage;
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!nombre.value.trim()) {
      nombre.value = '';
      nombre.reportValidity();
      return;
    }
    updateMessage();
    const url = new URL(whatsappUrl);
    url.searchParams.set('text', mensaje.value);
    window.open(url.href, '_blank', 'noopener,noreferrer');
    recordListingEvent(publication, 'whatsapp');
  };
  updateMessage();
  dialog.showModal();
  nombre.focus();
}

// Centros de referencia de BA Data y de la estación para Belgrano R.
const neighborhoodCenters = new Map([
  ['belgrano', [-34.5534, -58.4491]],
  ['belgrano r', [-34.5681, -58.4618]],
  ['caballito', [-34.6167, -58.4447]],
  ['nunez', [-34.5427, -58.4626]],
  ['palermo', [-34.5734, -58.4209]],
  ['villa devoto', [-34.6007, -58.5133]],
  ['villa urquiza', [-34.5720, -58.4886]],
]);

function publicationLocation({ zona, latitud_aproximada, longitud_aproximada }) {
  const neighborhood = zona.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const hasAddressLocation = latitud_aproximada != null && longitud_aproximada != null;
  const center = hasAddressLocation ? [latitud_aproximada, longitud_aproximada] :
    neighborhoodCenters.get(neighborhood);
  if (!center) return '';

  const [lat, lon] = center;
  const map = `https://www.openstreetmap.org/#map=15/${lat}/${lon}`;

  return `<section class="panel location-panel" aria-labelledby="location-title">
    <div class="location-heading">
      <div><h2 id="location-title">Ubicación aproximada</h2>
        <p class="muted">${h(zona)} · Ciudad de Buenos Aires</p></div>
      <a class="quiet" href="${h(map)}" target="_blank" rel="noopener noreferrer">Explorar el barrio <span aria-hidden="true">↗</span></a>
    </div>
    <div class="location-map" data-center="${lat},${lon}" data-radius="${hasAddressLocation ? 250 : 380}"
      role="region" aria-label="Mapa de ${h(zona)}" aria-describedby="location-caption"></div>
    <p class="location-caption muted" id="location-caption"><span aria-hidden="true"></span>
      ${hasAddressLocation ? 'El círculo indica la zona aproximada de la propiedad.' :
        'El círculo muestra una referencia general del barrio.'}</p>
  </section>`;
}

function setupPublicationMap() {
  const container = main.querySelector('.location-map');
  if (!container) return;

  const leaflet = window.L;
  if (!leaflet) {
    container.hidden = true;
    main.querySelector('#location-caption').textContent = 'Usá «Explorar el barrio» para ver el mapa.';
    return;
  }

  const center = container.dataset.center.split(',').map(Number);
  let map;
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    map = leaflet.map(container, { scrollWheelZoom: false, zoomControl: false }).setView(center, 15);
    leaflet.control.zoom({ zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
    leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    leaflet.circle(center, {
      radius: Number(container.dataset.radius), color: '#087a68', fillColor: '#38bfa7', fillOpacity: 0.24,
      weight: 2, interactive: false,
    }).addTo(map);
  });
  observer.observe(container);
  releasePublicationMap = () => {
    observer.disconnect();
    map?.remove();
  };
}

function publisherRating(profile) {
  const counts = Object.entries(profile.calificaciones);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return '<p class="publisher-rating muted">Sin calificaciones</p>';

  const average = counts.reduce((sum, [stars, count]) => sum + Number(stars) * count, 0) / total;
  return `<details class="publisher-rating">
    <summary><span aria-hidden="true">★</span> ${number(average)} de 5 · ${total} ${total === 1 ? 'calificación' : 'calificaciones'}</summary>
    <ul>${[5, 4, 3, 2, 1].map((stars) => `<li>${stars} ${stars === 1 ? 'estrella' : 'estrellas'} <strong>${profile.calificaciones[stars] || 0}</strong></li>`).join('')}</ul>
  </details>`;
}

function publisherCard(profile, isProfile = false) {
  const name = h(profile.nombre);
  const link = '#publicador/' + profile.id;
  const initials = profile.nombre.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return `<div class="publisher-card">
    ${profile.foto_url ? `<img class="publisher-avatar" src="/api${h(profile.foto_url)}" alt="">` :
      `<span class="publisher-avatar" aria-hidden="true">${h(initials)}</span>`}
    <div class="publisher-info">
      <p class="eyebrow">${profile.es_inmobiliaria ? 'Inmobiliaria' : 'Anunciante'}</p>
      ${isProfile ? `<h1>${name}</h1>` : `<h2><a href="${link}">${name}</a></h2>`}
      ${publisherRating(profile)}
    </div>
    ${isProfile ? '' : `<a class="quiet publisher-link" href="${link}">Ver sus publicaciones <span aria-hidden="true">↗</span></a>`}
  </div>`;
}

async function loadPublisherCard(publicadorId, panel) {
  try {
    const profile = await api('/publicadores/' + publicadorId);
    if (!panel.isConnected) return;
    result(panel, publisherCard(profile));
    panel.hidden = false;
  } catch {
    // El resto de la ficha sigue disponible si falla la consulta del perfil.
  }
}

async function publisherPage(id, version) {
  const path = '/publicadores/' + id;
  const [profile, listings] = await Promise.all([api(path), api(path + '/publicaciones')]);
  if (version !== routeVersion) return;

  result(main, `<div class="wrap content">
    <a class="back" href="${h(searchLink())}">Volver a publicaciones</a>
    <section class="panel publisher-panel" aria-label="Perfil del anunciante">
      ${publisherCard(profile, true)}
      <details class="publisher-edit">
        <summary>${user?.id === profile.id ? 'Cambiar foto de perfil' : 'Calificar al anunciante'}</summary>
        ${user?.id === profile.id ? `<form class="fields" id="publisher-photo">
          ${input('Foto de perfil', 'foto', 'type="file" required accept="image/jpeg,image/png,image/webp"')}
          ${submitButton('Guardar foto')}</form>` : user ? `<form class="fields" id="publisher-rating">
          ${select('Puntuación', 'estrellas', [['5', '5 estrellas'], ['4', '4 estrellas'], ['3', '3 estrellas'], ['2', '2 estrellas'], ['1', '1 estrella']])}
          ${submitButton('Guardar mi calificación')}</form>` : loginPrompt('Ingresá para dejar una calificación.')}
      </details>
    </section>
    <div class="section-head"><h2>Publicaciones</h2><small>${listings.length} ${listings.length === 1 ? 'aviso' : 'avisos'}</small></div>
    <div id="publisher-listings" aria-live="polite">${note('Cargando publicaciones…')}</div>
  </div>`);

  const photo = main.querySelector('#publisher-photo');
  if (photo) submit(photo, async (data) => {
    await api(path + '/foto', 'PUT', data);
    if (photo.isConnected) await route();
  });
  const rating = main.querySelector('#publisher-rating');
  if (rating) submit(rating, async (data, output) => {
    await api(path + '/calificacion', 'PUT', { estrellas: Number(data.get('estrellas')) });
    const updated = await api(path);
    if (!rating.isConnected) return;
    const previous = main.querySelector('.publisher-info .publisher-rating');
    previous.outerHTML = publisherRating(updated);
    result(output, note('Guardamos tu calificación.'));
  });

  const results = main.querySelector('#publisher-listings');
  if (listings.length) await showListingCards(results, listings);
  else result(results, note('Este anunciante todavía no tiene publicaciones.'));
}

function similarListings(current, listings) {
  const property = current.propiedad;
  const price = Number(askingPrice(current).monto);
  return listings
    .filter((listing) => listing.id !== current.id &&
      listing.propiedad.tipo === property.tipo &&
      listing.operacion === current.operacion &&
      askingPrice(listing).moneda === askingPrice(current).moneda)
    .map((listing) => ({
      listing,
      sameNeighborhood: listing.propiedad.zona === property.zona,
      roomsDifference: Math.abs(listing.propiedad.ambientes - property.ambientes),
      priceDifference: Math.abs(Number(askingPrice(listing).monto) - price),
    }))
    .filter(({ roomsDifference, priceDifference }) => roomsDifference <= 1 && priceDifference <= price * 0.3)
    .sort((a, b) => Number(b.sameNeighborhood) - Number(a.sameNeighborhood) ||
      a.roomsDifference - b.roomsDifference || a.priceDifference - b.priceDifference || a.listing.id - b.listing.id)
    .slice(0, 9)
    .map(({ listing }) => listing);
}

function setupSimilarCarousel(panel, viewport) {
  const previous = panel.querySelector('[data-similar-prev]');
  const next = panel.querySelector('[data-similar-next]');
  const controls = previous.parentElement;
  const cards = viewport.querySelector('.cards');

  function updateControls() {
    const end = viewport.scrollWidth - viewport.clientWidth;
    controls.hidden = end <= 1;
    previous.disabled = viewport.scrollLeft <= 1;
    next.disabled = viewport.scrollLeft >= end - 1;
  }

  function move(direction) {
    const [first, second] = cards.children;
    if (second) viewport.scrollBy({ left: direction * (second.offsetLeft - first.offsetLeft) });
  }

  previous.onclick = () => move(-1);
  next.onclick = () => move(1);
  viewport.onscroll = updateControls;
  const observer = new ResizeObserver(updateControls);
  observer.observe(viewport);
  releaseSimilarCarousel = () => observer.disconnect();
  updateControls();
}

async function loadSimilarListings(current, panel) {
  try {
    const params = new URLSearchParams({ moneda: askingPrice(current).moneda, operacion: current.operacion });
    const listings = similarListings(current, await api('/publicaciones?' + params));
    if (!panel.isConnected || !listings.length) return;

    const viewport = panel.querySelector('.similar-listings');
    await showListingCards(viewport, listings);
    if (!panel.isConnected) return;
    panel.hidden = false;
    setupSimilarCarousel(panel, viewport);
  } catch {
    // La ficha sigue disponible si no se pueden cargar las recomendaciones.
  }
}

function descriptionField(value = '') {
  return `<label>Descripción (opcional)
    <textarea name="descripcion" maxlength="1200" rows="5" aria-describedby="description-hint"
      placeholder="Contá cómo se distribuyen los ambientes, qué se destaca del lugar y qué servicios hay cerca.">${h(value)}</textarea>
  </label>
  <small id="description-hint">Hasta 1.200 caracteres.</small>`;
}

function publicationDescription(p) {
  const canEdit = canManagePublication(p);
  if (!p.descripcion && !canEdit) return '';
  return `<section class="panel publication-description" aria-labelledby="description-title">
    <h2 id="description-title">Sobre esta propiedad</h2>
    <p class="description-copy" ${p.descripcion ? '' : 'hidden'}>${h(p.descripcion)}</p>
    ${canEdit ? `<details>
      <summary>${p.descripcion ? 'Editar descripción' : 'Agregar descripción'}</summary>
      <form id="description-form" class="description-form">
        ${descriptionField(p.descripcion)}${submitButton('Guardar descripción')}
      </form>
    </details>` : ''}
  </section>`;
}

function salePricePanel(p) {
  const expenses = saleExpenseKeys.filter((key) => p[key] != null);
  return `<section class="panel teal sale-price">
    <h2>Precio de venta</h2><strong class="value">${h(money(p.precio_venta))}</strong>
    ${expenses.length ? `<dl class="sale-expenses">${expenses.map((key) => `
      <div class="row"><dt>${h(listingCostLabels[key])}</dt><dd class="money">${h(money(p[key]))}</dd></div>
    `).join('')}</dl>` : ''}
  </section>`;
}

async function publication(id, version) {
  const comparisonBack = history.state?.comparisonBack;
  const path = '/publicaciones/' + id;
  const p = await api(path);
  if (version !== routeVersion) return;
  const forSale = isSale(p);
  const [monthly, entry] = await Promise.all([monthlyCost(p), forSale ? null : api(path + '/costo-entrada')]);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content">
    <a class="back" href="${h(comparisonBack || publicationBackLink || (forSale && searchOperation !== 'venta' ? '#comprar' : searchLink()))}">${comparisonBack ? 'Volver a la comparación' :
      publicationBackLink ? 'Volver a guardados' : 'Volver a publicaciones'}</a>
    <div class="detail-head">
      <div class="detail-title">
        <div class="listing-labels">
          <p class="eyebrow">${h(p.propiedad.zona)} · ${h(p.propiedad.tipo)}${forSale ? ' · En venta' : ''}</p>
          ${p.patrocinada ? sponsoredBadge : ''}
        </div>
        <h1>${h(p.titulo)}</h1>
      </div>
      ${canManagePublication(p) || p.whatsapp_url ? `<div class="actions detail-actions">
        ${canManagePublication(p) ? `<a class="quiet" href="#mis-publicaciones/${p.id}">Editar publicación</a>` : ''}
        ${p.whatsapp_url ? '<button type="button" class="btn detail-contact">Consultar por WhatsApp</button>' : ''}
      </div>` : ''}
    </div>
    ${publicationPhotos(p)}
    ${publicationFeatures(p)}
    ${forSale ? salePricePanel(p) :
      `<div class="pair">${costPanel('Costo mensual real', monthly, 'teal')}${costPanel('Costo de entrada', entry, 'gold')}</div>`}
    <div class="stack">
    ${publicationDescription(p)}
    ${publicationLocation(p.propiedad)}
    ${forSale ? '' : `<section class="panel night" id="income-panel"><h2>Impacto sobre tus ingresos</h2></section>
    <section class="panel"><h2>Proyección a 12 y 24 meses</h2><p class="muted">Estimación según el tipo de ajuste informado y el escenario elegido.</p>
    ${!user ? loginPrompt('Ingresá para consultar la proyección.') : `<form class="fields" id="projection">
      ${input('Ajuste cada (meses)', 'meses_periodicidad', 'type="number" min="1" max="24" value="6" required')}
      ${p.tipo_ajuste === 'INDICE' ? input('Variación mensual del índice (%)', 'tasa_mensual', 'type="number" min="0" step="any" placeholder="Promedio de la serie" value="2.5"') : ''}
      ${submitButton('Proyectar costos')}</form>`}
    </section>`}
    <section class="panel publisher-panel" id="publication-publisher" aria-label="Quién publica el aviso" hidden></section>
    <section class="similar-panel" id="publication-similar" aria-labelledby="similar-title" hidden>
      <h2 id="similar-title">Propiedades similares</h2>
      <div class="similar-carousel">
        <div class="similar-controls" role="group" aria-label="Recorrer recomendaciones" hidden>
          <button type="button" data-similar-prev aria-label="Propiedad anterior" aria-controls="similar-listings"></button>
          <button type="button" data-similar-next aria-label="Propiedad siguiente" aria-controls="similar-listings"></button>
        </div>
        <div class="similar-listings" id="similar-listings" tabindex="0" role="group" aria-label="Avisos recomendados"></div>
      </div>
    </section>
    </div></div>`);
  setupPublicationPhotos(p, path);
  if (comparisonBack) main.querySelector('.back').onclick = (event) => {
    if (!isSameTabClick(event)) return;
    event.preventDefault();
    history.back();
  };
  recordListingEvent(p, 'visita');
  setupPublicationMap();
  loadPublisherCard(p.publicador_id, main.querySelector('#publication-publisher'));
  loadSimilarListings(p, main.querySelector('#publication-similar'));
  const save = main.querySelector('.detail-utilities [data-favorite]');
  save.onclick = () => toggleFavorite(save);
  const contactButton = main.querySelector('.detail-contact');
  if (contactButton) contactButton.onclick = () => openWhatsAppContact(p);
  const descriptionForm = main.querySelector('#description-form');
  if (descriptionForm) submit(descriptionForm, async (data, output) => {
    const description = data.get('descripcion').trim();
    await api(path + '/descripcion', 'PATCH', { descripcion: description || null });
    if (!descriptionForm.isConnected) return;
    const panel = descriptionForm.closest('.publication-description');
    const copy = panel.querySelector('.description-copy');
    copy.textContent = description;
    copy.hidden = !description;
    panel.querySelector('summary').textContent = description ? 'Editar descripción' : 'Agregar descripción';
    result(output, note('Descripción guardada.'));
  });
  const form = main.querySelector('#projection');
  if (form) submit(form, async (data, output) => {
    result(output, note('Calculando proyección…'));
    const projection = await api(path + '/proyeccion?' + query(data));
    result(output, (projection.escenario ? note('Variación mensual usada: ' + pct(projection.escenario.tasa_mensual_porcentual) + '.') : '') +
      table(['Horizonte', 'Alquiler', 'Costo mensual', '% del ingreso'], projection.meses.map((m) =>
        ['Mes ' + m.mes, money(m.alquiler), money(m.costo_mensual), pct(m.porcentaje_ingreso)])) +
      projection.meses.map((m) => `<p><small>Mes ${m.mes}: ${h(m.formula)}</small></p>`).join('') + missing(projection.faltantes));
  });
  const income = main.querySelector('#income-panel');
  if (!income) return;
  if (!user || !user.ingreso_referencia) {
    income.insertAdjacentHTML('beforeend', user ?
      '<p>Cargá tu ingreso mensual de referencia para ver qué parte representa este alquiler.</p><button class="quiet" data-login>Cargar ingreso</button>' :
      loginPrompt('Ingresá para comparar el costo mensual con tu ingreso.'));
    return;
  }
  try {
    const analysis = await api(path + '/analisis');
    income.insertAdjacentHTML('beforeend', `<div class="metrics">
      ${metric('Ingreso mensual', money(analysis.ingreso_referencia))}
      ${metric('Costo mensual', money(analysis.costo_real.total))}
      ${metric('Parte de tu ingreso', pct(analysis.porcentaje_ingreso))}
      </div><div class="impact" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(analysis.porcentaje_ingreso)))}%"></span></div>
      <button class="quiet" data-login>Editar ingreso</button>`);
  } catch (error) {
    income.insertAdjacentHTML('beforeend', note(error.message, 'warn') + '<button class="quiet" data-login>Editar ingreso</button>');
  }
}

function metric(title, value) {
  return `<div class="metric"><small>${title}</small><strong class="value">${h(value)}</strong></div>`;
}

function listingStates(p) {
  return {
    activa: 'Activa',
    pausada: 'Pausada',
    cerrada: isSale(p) ? 'Vendida' : 'Alquilada',
  };
}

function listingStateMenu(p) {
  return `<span class="listing-state" data-state="${h(p.estado)}">
    <select data-listing-status="${p.id}" aria-label="Estado de ${h(p.titulo)}">
      ${Object.entries(listingStates(p)).map(([state, label]) => `
        <option value="${state}" ${state === p.estado ? 'selected' : ''}>${label}</option>
      `).join('')}
    </select>
  </span>`;
}

function listingQuota({ activas, limite }) {
  const full = limite !== null && activas >= limite;
  return `<section class="panel listing-quota" aria-label="Cupo de avisos">
    <div><h2>Cupo de avisos activos</h2>
      <p class="muted">${full ? 'Pausá o cerrá un aviso para publicar o reactivar otro.' :
        'Los avisos pausados o cerrados liberan un lugar.'}</p></div>
    <div class="listing-quota-use">
      <strong>${limite === null ? `${number(activas)} · Sin límite` : `${number(activas)} de ${number(limite)}`}</strong>
      ${limite === null ? '' : `<progress value="${Math.min(activas, limite)}" max="${limite}" aria-label="Cupo utilizado"></progress>`}
    </div>
  </section>`;
}

async function newListing(version) {
  if (canPublish()) {
    const quota = await api('/publicaciones/mis/cupo');
    if (version !== routeVersion) return;
    if (quota.limite !== null && quota.activas >= quota.limite) {
      result(main, `<div class="wrap content"><h1>Nueva publicación</h1>
        ${listingQuota(quota)}
        <a class="btn" href="#mis-publicaciones">Ir a Mis publicaciones</a>
      </div>`);
      return;
    }
  }
  publish();
}

async function myListings(id, version, fromAdmin = false) {
  if (!canPublish()) {
    result(main, `<div class="wrap content"><h1>Mis publicaciones</h1>
      <div class="panel">${user ? note('Esta cuenta no puede publicar avisos.') :
        loginPrompt('Ingresá con tu cuenta de anunciante para administrar tus avisos.')}</div></div>`);
    return;
  }
  const path = '/publicaciones/mis';
  if (id) {
    const listing = await api(path + '/' + id);
    if (version === routeVersion) publish(listing, fromAdmin);
    return;
  }
  const [listings, quota] = await Promise.all([api(path), api(path + '/cupo')]);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content">
    <div class="section-head my-listings-head"><h1>Mis publicaciones</h1>
      <a class="btn" href="#publicar">Nueva publicación</a>
    </div>
    <div id="listing-quota" aria-live="polite">${listingQuota(quota)}</div>
    ${listings.length ? '<p class="muted listing-metrics-hint">Las métricas son acumuladas. Se cuenta una visita y un clic a WhatsApp por aviso y pestaña. Un clic indica intención de contacto.</p>' : ''}
    ${listings.length ? `<div class="cards">${listings.map((p) => `<article class="card managed-listing">
      <div class="section-head">
        <p class="eyebrow">${isSale(p) ? 'Venta' : 'Alquiler'}</p>
        ${listingStateMenu(p)}
      </div>
      ${p.patrocinada ? `<p>${sponsoredBadge}</p>` : ''}
      <h2>${h(p.titulo)}</h2><p class="muted">${h(p.propiedad.zona)} · ${h(p.propiedad.tipo)}</p>
      <p class="money">${h(money(askingPrice(p)))}</p>
      <dl class="listing-metrics">
        <div><dt>Visitas al aviso</dt><dd>${number(p.visitas)}</dd></div>
        <div><dt>Clics a WhatsApp</dt><dd>${number(p.clics_whatsapp)}</dd></div>
      </dl>
      <div class="actions"><a class="quiet" href="#mis-publicaciones/${p.id}">Administrar aviso</a>
        <a href="#publicacion/${p.id}" data-public-listing ${p.estado === 'activa' ? '' : 'hidden'}>Ver aviso</a>
      </div>
      <div class="listing-status-message" aria-live="polite"></div>
    </article>`).join('')}</div>` : '<p class="empty">Todavía no tenés avisos publicados.</p>'}
  </div>`);
  const quotaPanel = main.querySelector('#listing-quota');
  setupListingStateMenus(main, (previous, estado) => {
    quota.activas += Number(estado === 'activa') - Number(previous === 'activa');
    result(quotaPanel, listingQuota(quota));
  });
}

function setupListingStateMenus(container, onChanged) {
  for (const menu of container.querySelectorAll('[data-listing-status]')) {
    const pill = menu.closest('.listing-state');
    const card = menu.closest('.managed-listing, tr');
    const message = card.querySelector('.listing-status-message');
    menu.onchange = async () => {
      const previous = pill.dataset.state;
      const estado = menu.value;
      if (previous === estado) return;
      const restoreFocus = document.activeElement === menu;
      menu.disabled = true;
      result(message, '');
      try {
        await api('/publicaciones/mis/' + menu.dataset.listingStatus + '/estado', 'PATCH', { estado });
        pill.dataset.state = estado;
        card.querySelector('[data-public-listing]').hidden =
          estado !== 'activa' || card.hasAttribute('data-anunciante-suspendido');
        onChanged(previous, estado);
      } catch (error) {
        menu.value = previous;
        result(message, note(error.message, 'error'));
      } finally {
        menu.disabled = false;
        if (restoreFocus && document.activeElement === document.body) menu.focus({ preventScroll: true });
      }
    };
  }
}

function adminOverview(data) {
  const counts = data.publicaciones_por_estado;
  return `<div class="admin-metrics">
    ${[
      ['Cuentas', data.cuentas], ['Inmobiliarias', data.inmobiliarias.length],
      ['Avisos visibles', (counts.activa ?? 0) - data.avisos_ocultos], ['Pausados', counts.pausada ?? 0],
      ['Alquilados o vendidos', counts.cerrada ?? 0],
    ].map(([title, value]) => `<div class="panel">${metric(title, number(value))}</div>`).join('')}
  </div>`;
}

function adminAgencyList(agencies) {
  if (!agencies.length) return '<p class="empty">Todavía no hay inmobiliarias.</p>';
  return `<div class="table-wrap admin-table">
    <table>
      <thead><tr><th scope="col">Inmobiliaria</th><th scope="col">Estado</th>
        <th scope="col">Cupo</th><th scope="col">Acciones</th></tr></thead>
      <tbody>${agencies.map((agency) => `<tr>
        <td><strong>${h(agency.nombre)}</strong><small>${h(agency.email)}</small></td>
        <td><span class="agency-status ${agency.habilitada ? '' : 'suspended'}">
          ${agency.habilitada ? 'Habilitada' : 'Suspendida'}
        </span></td>
        <td>${number(agency.activas)} de ${number(agency.limite)}</td>
        <td><button class="quiet" type="button" data-agency="${agency.id}"
          data-enable="${!agency.habilitada}" data-name="${h(agency.nombre)}"
          aria-label="${agency.habilitada ? 'Suspender' : 'Reactivar'} ${h(agency.nombre)}">
          ${agency.habilitada ? 'Suspender' : 'Reactivar'}
        </button></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function confirmAgencySuspension(name) {
  result(dialogBody, `<h2 id="dialog-title">Suspender inmobiliaria</h2>
    <p><strong>${h(name)}</strong> perderá el acceso. Sus avisos quedarán ocultos hasta que reactives la cuenta.</p>
    <form method="dialog">
      <div class="actions">
        <button type="submit" class="quiet" value="cancelar" autofocus>Cancelar</button>
        <button type="submit" class="btn" value="suspender">Suspender</button>
      </div>
    </form>`);
  dialog.returnValue = '';
  const decision = new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'suspender'), { once: true });
  });
  dialog.showModal();
  return decision;
}

function adminResults({ avisos, total, por_pagina }, page) {
  const pages = Math.max(1, Math.ceil(total / por_pagina));
  if (!avisos.length) return '<p class="empty">No hay avisos con estos filtros.</p>';
  return `<div class="table-wrap admin-table">
    <table>
      <thead><tr>${['Aviso', 'Anunciante', 'Precio', 'Estado', 'Patrocinio', 'Visitas', 'Clics WhatsApp', 'Acciones']
        .map((title) => `<th scope="col">${title}</th>`).join('')}</tr></thead>
      <tbody>${avisos.map((p) => `<tr ${p.anunciante_habilitado ? '' : 'data-anunciante-suspendido'}>
        <td><strong>${h(p.titulo)}</strong><small>${h(p.zona)} · ${isSale(p) ? 'Venta' : 'Alquiler'}</small></td>
        <td>${h(p.anunciante)}${p.anunciante_habilitado ? '' : '<small>Cuenta suspendida</small>'}</td>
        <td class="money">${h(money(p.precio))}</td>
        <td>${listingStateMenu(p)}<div class="listing-status-message" aria-live="polite"></div></td>
        <td>
          <span class="listing-state listing-sponsorship" data-sponsored="${p.patrocinada}">
            <select data-listing-sponsorship="${p.id}" aria-label="Patrocinio de ${h(p.titulo)}">
              <option value="false" ${p.patrocinada ? '' : 'selected'}>Normal</option>
              <option value="true" ${p.patrocinada ? 'selected' : ''}>Patrocinado</option>
            </select>
          </span>
          <div class="sponsorship-message" role="status"></div>
        </td>
        <td>${number(p.visitas)}</td><td>${number(p.clics_whatsapp)}</td>
        <td><div class="admin-row-actions">
          <a class="quiet" href="#mis-publicaciones/${p.id}?origen=admin">Editar aviso</a>
          <a href="#publicacion/${p.id}" data-public-listing ${p.estado === 'activa' && p.anunciante_habilitado ? '' : 'hidden'}>Ver aviso</a>
        </div></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="admin-pagination actions">
    <small>${number(total)} avisos · Página ${page} de ${pages}</small>
    <button class="quiet" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Anterior</button>
    <button class="quiet" type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Siguiente</button>
  </div>`;
}

function setupSponsorshipMenus(container) {
  for (const menu of container.querySelectorAll('[data-listing-sponsorship]')) {
    const pill = menu.closest('.listing-sponsorship');
    const message = pill.nextElementSibling;
    menu.onchange = async () => {
      const previous = pill.dataset.sponsored;
      const selected = menu.value;
      const restoreFocus = document.activeElement === menu;
      menu.disabled = true;
      result(message, '');
      try {
        await api('/admin/publicaciones/' + menu.dataset.listingSponsorship + '/patrocinio', 'PATCH',
          { patrocinada: selected === 'true' });
        pill.dataset.sponsored = selected;
      } catch (error) {
        menu.value = previous;
        result(message, note(error.message, 'error'));
      } finally {
        menu.disabled = false;
        if (restoreFocus && document.activeElement === document.body) menu.focus({ preventScroll: true });
      }
    };
  }
}

async function adminPage(version) {
  if (user?.rol !== 'ADMIN') {
    result(main, `<div class="wrap content"><h1>Panel de administración</h1>
      <div class="panel">${user ? note('Este panel es exclusivo para administradores.') :
        loginPrompt('Ingresá con tu cuenta administradora.')}</div></div>`);
    return;
  }
  const [overview, listings] = await Promise.all([
    api('/admin/resumen'), api('/admin/publicaciones'),
  ]);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content admin-page">
    <h1>Panel de administración</h1>
    <div id="admin-overview">${adminOverview(overview)}</div>
    <div id="admin-message" aria-live="polite"></div>
    <section class="panel admin-agencies"><h2>Inmobiliarias</h2>
      <details class="admin-agency-create"><summary>Dar de alta inmobiliaria</summary>
        <form class="fields" id="admin-agency-form" autocomplete="off">
          ${input('Nombre de la inmobiliaria', 'nombre', 'required maxlength="100" autocomplete="off"')}
          ${input('Correo de acceso', 'email', 'type="email" required maxlength="255" autocomplete="off"')}
          ${passwordField('Contraseña', 'password', 'admin-agency-password',
            'required minlength="8" maxlength="128" autocomplete="new-password"')}
          ${passwordField('Repetí la contraseña', 'password_confirmacion', 'admin-agency-confirmation',
            'required minlength="8" maxlength="128" autocomplete="new-password"', 'confirmación de contraseña')}
          ${submitButton('Crear inmobiliaria')}
        </form>
      </details>
      <div id="admin-agency-message" aria-live="polite"></div>
      <div id="admin-agency-list">${adminAgencyList(overview.inmobiliarias)}</div>
    </section>
    <section class="panel"><h2>Publicaciones</h2>
      <form class="fields admin-filters" id="admin-filters">
        ${input('Buscar aviso', 'buscar', 'type="search" maxlength="100" placeholder="Título, barrio o anunciante"')}
        ${select('Estado', 'estado', [['', 'Todos'], ['activa', 'Activa'], ['pausada', 'Pausada'], ['cerrada', 'Alquilada o vendida']])}
        ${select('Operación', 'operacion', [['', 'Todas'], ['alquiler', 'Alquiler'], ['venta', 'Venta']])}
        <div class="actions"><button type="submit" class="btn">Aplicar filtros</button></div>
      </form>
      <div id="admin-results"></div>
    </section>
  </div>`);
  const form = main.querySelector('#admin-filters');
  const output = main.querySelector('#admin-results');
  const overviewPanel = main.querySelector('#admin-overview');
  const message = main.querySelector('#admin-message');
  const agencyList = main.querySelector('#admin-agency-list');
  const agencyMessage = main.querySelector('#admin-agency-message');
  const agencyForm = main.querySelector('#admin-agency-form');
  let request = 0;
  let overviewRequest = 0;
  let applied = new URLSearchParams();

  async function updateOverview(agencyId) {
    const revision = ++overviewRequest;
    try {
      const overview = await api('/admin/resumen');
      if (version !== routeVersion || revision !== overviewRequest) return;
      result(overviewPanel, adminOverview(overview));
      result(agencyList, adminAgencyList(overview.inmobiliarias));
      if (agencyId) agencyList.querySelector(`[data-agency="${agencyId}"]`)?.focus({ preventScroll: true });
    } catch (error) {
      if (version === routeVersion && revision === overviewRequest) result(message, note(error.message, 'error'));
    }
  }
  function showResults(listings, page) {
    result(output, adminResults(listings, page));
    for (const button of output.querySelectorAll('[data-page]')) {
      button.onclick = () => loadResults(Number(button.dataset.page));
    }
    setupListingStateMenus(output, () => {
      void updateOverview();
      if (applied.has('estado')) void loadResults(1);
    });
    setupSponsorshipMenus(output);
  }
  async function loadResults(page) {
    const revision = ++request;
    const params = new URLSearchParams(applied);
    params.set('pagina', page);
    output.setAttribute('aria-busy', 'true');
    try {
      const listings = await api('/admin/publicaciones?' + params);
      if (version === routeVersion && revision === request) {
        showResults(listings, page);
        result(message, '');
      }
    } catch (error) {
      if (version === routeVersion && revision === request) result(message, note(error.message, 'error'));
    } finally {
      if (revision === request) output.removeAttribute('aria-busy');
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    applied = query(new FormData(form));
    void loadResults(1);
  };
  setupPasswordToggles(agencyForm);
  submit(agencyForm, async (data, output) => {
    await api('/admin/inmobiliarias', 'POST', Object.fromEntries(data));
    agencyForm.reset();
    result(output, note('Inmobiliaria creada.'));
    await updateOverview();
  });
  agencyList.onclick = async (event) => {
    const button = event.target.closest('[data-agency]');
    if (!button || button.disabled) return;
    const habilitada = button.dataset.enable === 'true';
    const id = button.dataset.agency;
    if (!habilitada && !await confirmAgencySuspension(button.dataset.name)) return;
    if (!agencyList.isConnected) return;
    button.disabled = true;
    result(agencyMessage, '');
    try {
      await api('/admin/inmobiliarias/' + id + '/estado', 'PATCH', { habilitada });
      result(agencyMessage, note(habilitada ? 'Inmobiliaria reactivada.' : 'Inmobiliaria suspendida.'));
      await Promise.all([updateOverview(id), loadResults(1)]);
    } catch (error) {
      result(agencyMessage, note(error.message, 'error'));
    } finally {
      button.disabled = false;
    }
  };
  showResults(listings, 1);
}

function listingAvailability(p) {
  return `<section class="panel managed-listing-settings"><h2>Disponibilidad</h2>
    ${p.publicador_habilitado ? '' : note('La inmobiliaria está suspendida. El aviso se mantiene oculto.', 'warn')}
    <form id="managed-state-form">
      ${select('Estado del aviso', 'estado', Object.entries(listingStates(p)))}
      <p class="muted"><small>Solo los avisos activos aparecen en la búsqueda y se pueden abrir desde un enlace público.</small></p>
      ${submitButton('Guardar estado')}
    </form>
  </section>`;
}

function setupListingManagement(p) {
  const path = '/publicaciones/mis/' + p.id;
  const stateForm = main.querySelector('#managed-state-form');
  const publicLink = main.querySelector('#managed-public-link');
  stateForm.elements.estado.value = p.estado;
  submit(stateForm, async (data, output) => {
    const estado = data.get('estado');
    await api(path + '/estado', 'PATCH', { estado });
    publicLink.hidden = estado !== 'activa' || !p.publicador_habilitado;
    result(output, note('Estado actualizado.'));
  });

  const photosPanel = main.querySelector('#managed-photos');
  const refreshPhotos = async () => {
    const listing = await api(path);
    if (photosPanel.isConnected) showPhotos(listing);
  };
  function showPhotos(listing) {
    releasePhotoPreviews?.();
    releasePhotoPreviews = undefined;
    releaseManagedPhotos?.();
    releaseManagedPhotos = undefined;
    result(photosPanel, `<div id="photo-message" aria-live="polite"></div>
      ${photoManagement(listing, true, true)}`);
    setupPublicationPhotos(listing, '/publicaciones/' + p.id, refreshPhotos);
    loadManagedPhotos(path);
  }
  showPhotos(p);
}

function listingCostFields(keys) {
  return keys.map((key) => input(
    `<span>${h(listingCostLabels[key])} (<span data-expense-currency="${key}"></span>)</span>`,
    key, optionalAmount,
  )).join('');
}

function fillListingForm(form, p) {
  const price = askingPrice(p);
  const fields = {
    ...p.propiedad,
    titulo: p.titulo,
    operacion: p.operacion,
    precio_publicado: price.monto,
    moneda: price.moneda,
    duracion_contrato_meses: p.duracion_contrato_meses,
    tipo_garantia_aceptada: p.tipo_garantia_aceptada,
    tipo_ajuste: p.tipo_ajuste,
    tasa_ajuste: p.tasa_ajuste,
    serie_codigo: p.serie_codigo,
    ...Object.fromEntries(Object.keys(listingCostLabels).map((key) => [key, p[key]?.monto])),
  };
  for (const [name, value] of Object.entries(fields)) {
    const control = form.elements.namedItem(name);
    if (!control || value == null) continue;
    if (control.tagName === 'SELECT' && !Array.from(control.options).some((item) => item.value === String(value))) {
      control.add(new Option(value, value));
    }
    control.value = value;
  }
}

function publish(listing = null, fromAdmin = false) {
  if (!canPublish()) {
    result(main, `<div class="wrap content"><h1>Nueva publicación</h1><div class="panel">
      ${user ? '<p>Esta operación está reservada a cuentas inmobiliarias y de administración.</p>' :
        loginPrompt('Ingresá con una cuenta inmobiliaria para publicar.')}
    </div></div>`);
    return;
  }

  const expensesOnlyForRent = Object.keys(listingCostLabels).filter((key) => !saleExpenseKeys.includes(key));
  const canSponsor = user?.rol === 'ADMIN';
  const backLink = fromAdmin ? '#admin' : listing ? '#mis-publicaciones' : '#buscar';
  result(main, `<div class="wrap content"><a class="back" href="${backLink}">
      ${fromAdmin ? 'Volver al panel de administración' : listing ? 'Volver a Mis publicaciones' : 'Volver a publicaciones'}
    </a>
    <div class="section-head my-listings-head"><h1>${listing ? 'Editar publicación' : 'Nueva publicación'}</h1>
      ${listing ? `<div class="actions">
        <a class="quiet" id="managed-public-link" href="#publicacion/${listing.id}"
          ${listing.estado === 'activa' && listing.publicador_habilitado ? '' : 'hidden'}>Ver aviso público</a>
        <button type="submit" class="btn" form="publish-form" data-top-submit>Guardar cambios</button>
      </div>` : ''}
    </div>
    ${listing ? '<div id="listing-save-message" aria-live="polite"></div>' : ''}
    <form id="publish-form" class="stack" ${listing ? 'data-top-output="listing-save-message"' : ''}>
      <section class="panel teal"><h2>Datos de la propiedad</h2><div class="fields">
        ${select('Operación', 'operacion', [['alquiler','Alquilar'], ['venta','Vender']], listing ? 'disabled' : '')}
        <div class="full">
          ${input('Título del aviso', 'titulo', 'required maxlength="100" placeholder="Ej. Departamento luminoso de 2 ambientes en Villa Devoto" aria-describedby="title-hint"')}
          <small id="title-hint">Es el nombre público del aviso. Evitá poner la calle y la altura en el título o la descripción.</small>
        </div>
        ${input('Dirección para el mapa', 'direccion', 'required minlength="5" maxlength="200" placeholder="Ej. Av. Rivadavia 5500" aria-describedby="address-hint"')}
        ${select('Barrio', 'zona', [['', 'Elegí un barrio o zona'],
          ...catalogOptions([...cabaNeighborhoods, ...cabaSubareas]).map((zone) => [zone, zone]),
        ], 'required')}
        ${select('Tipo de propiedad', 'tipo', propertyTypes)}
        ${input('Ambientes', 'ambientes', 'type="number" min="1" max="10" required')}
        ${input('Superficie (m²)', 'metros_cuadrados', 'type="number" min="0.01" max="999999.99" step="0.01"')}
        ${select('Mascotas', 'permite_mascotas', [['','Sin informar'], ['true','Acepta mascotas'], ['false','No acepta mascotas']])}
        <small class="full" id="address-hint">Ingresá calle y altura. La dirección queda fuera del aviso público y se consulta a USIG para ubicar el área aproximada en CABA.</small>
      </div></section>
      <section class="panel description-form"><h2>Sobre esta propiedad</h2>
        ${descriptionField(listing?.descripcion ?? '')}
      </section>
      <section class="panel gold"><h2 id="publish-price-title">Alquiler y gastos</h2>
        <div class="fields">
          ${input('<span id="publish-price-label">Alquiler mensual</span>', 'precio_publicado', 'type="number" min="0.01" max="9999999999.99" step="0.01" required')}
          ${select('Moneda del precio', 'moneda', currency)}
        </div>
        ${listing ? '<p class="muted"><small>Cambiar la moneda del precio no convierte los importes.</small></p>' : ''}
        <p class="muted">Dejá en blanco los gastos que todavía no conozcas. Usá 0 si el gasto está confirmado en cero.</p>
        <div class="fields">${listingCostFields(saleExpenseKeys)}</div>
        <div class="publish-rental-fields" data-rental-fields>
          <div class="fields">
          ${input('Duración del contrato (meses)', 'duracion_contrato_meses', 'type="number" min="1" max="36"')}
          ${listingCostFields(expensesOnlyForRent)}
          ${select('Garantía aceptada', 'tipo_garantia_aceptada', [['', 'Sin informar'],
            ...rentalGuarantees.map((guarantee) => [guarantee, guarantee]),
          ])}
        </div></div></section>
      <section class="panel" data-rental-fields><h2>Ajuste del alquiler</h2><div class="fields">
        ${select('Tipo de ajuste', 'tipo_ajuste', [['','Sin informar'], ['INDICE','Por índice'], ['FIJO','Porcentaje fijo']])}
        ${indexFields()}
        ${input('Tasa fija por ajuste (%)', 'tasa_ajuste', 'type="number" min="0" step="any"')}
      </div></section>
      <section class="panel"><h2>Contacto</h2>
        ${whatsappField(listing?.whatsapp ?? '')}
      </section>
      ${listing ? '' : `<section class="panel"><h2>Fotos de la propiedad</h2>
        <p class="muted">Opcional. Hasta ${maxListingPhotos} fotos JPG, PNG o WebP de 5 MB cada una. La primera queda como portada.</p>
        ${photoInput()}
      </section>`}
      ${canSponsor ? `<section class="panel sponsor-setting">
        <label><input name="patrocinada" type="checkbox" ${listing?.patrocinada ? 'checked' : ''}>
          Mostrar como patrocinado</label>
        <small>Mientras esté activo, lleva el cartel Patrocinado y tiene prioridad en el orden predeterminado. También puede ocupar uno de los tres lugares de la franja inicial.</small>
      </section>` : ''}
      ${submitButton(listing ? 'Guardar cambios' : 'Publicar')}
    </form>
    ${listing ? `<div class="stack listing-management">
      <div id="managed-photos"></div>${listingAvailability(listing)}
    </div>` : ''}
  </div>`);

  const form = main.querySelector('#publish-form');
  if (listing) fillListingForm(form, listing);
  const getPhotos = listing ? () => [] : setupPhotoPicker(form);
  const validateWhatsApp = setupWhatsAppValidation(form);
  let savedListing = listing;
  const originalCurrency = () => savedListing && askingPrice(savedListing).moneda;
  function expenseCurrency(key) {
    const savedCurrency = savedListing?.[key]?.moneda;
    if (form.elements.operacion.value === 'venta') return savedCurrency ?? 'ARS';
    return savedCurrency && savedCurrency !== originalCurrency() ? savedCurrency : form.elements.moneda.value;
  }
  function updateExpenseCurrencies() {
    for (const item of form.querySelectorAll('[data-expense-currency]')) {
      item.textContent = expenseCurrency(item.dataset.expenseCurrency);
    }
  }
  function updatePropertyFields() {
    const rooms = form.elements.ambientes;
    const showRooms = !propertyTypesWithoutRooms.has(form.elements.tipo.value);
    rooms.disabled = !showRooms;
    rooms.required = showRooms;
    rooms.closest('label').hidden = !showRooms;
  }
  const updateAdjustmentFields = setupAdjustmentFields(form);
  function updateOperationFields() {
    const forSale = form.elements.operacion.value === 'venta';
    form.querySelector('#publish-price-title').textContent = forSale ? 'Precio de venta y gastos' : 'Alquiler y gastos';
    form.querySelector('#publish-price-label').textContent = forSale ? 'Precio de la propiedad' : 'Alquiler mensual';
    for (const group of form.querySelectorAll('[data-rental-fields]')) {
      group.hidden = forSale;
      for (const control of group.querySelectorAll('input, select')) control.disabled = forSale;
    }
    updateAdjustmentFields();
    updateExpenseCurrencies();
  }
  form.elements.operacion.onchange = updateOperationFields;
  form.elements.tipo.onchange = updatePropertyFields;
  form.elements.moneda.onchange = updateExpenseCurrencies;
  updatePropertyFields();
  updateOperationFields();
  if (listing) setupListingManagement(listing);

  submit(form, async (data, output) => {
    if (!validateWhatsApp()) return;
    const photos = getPhotos();
    const value = (name) => data.get(name)?.trim() || null;
    const title = value('titulo');
    if (!title) throw new Error('Ingresá un título para el aviso.');
    const amount = (name, moneda) => value(name) === null ? null : { monto: value(name), moneda };
    const pets = value('permite_mascotas');
    const duration = value('duracion_contrato_meses');
    const operation = form.elements.operacion.value;
    const costs = Object.fromEntries(Object.keys(listingCostLabels).map((key) => [
      key, form.elements[key].disabled ? savedListing?.[key] ?? null : amount(key, expenseCurrency(key)),
    ]));
    const publication = await api(listing ? '/publicaciones/' + listing.id : '/publicaciones', listing ? 'PUT' : 'POST', {
      titulo: title,
      operacion: operation,
      propiedad: {
        direccion: value('direccion'), zona: value('zona'), tipo: value('tipo'),
        ambientes: Number(value('ambientes') ?? 0), metros_cuadrados: value('metros_cuadrados'),
        permite_mascotas: pets === null ? null : pets === 'true',
      },
      [operation === 'venta' ? 'precio_venta' : 'precio_alquiler']: amount('precio_publicado', value('moneda')),
      ...costs,
      duracion_contrato_meses: duration === null ? null : Number(duration),
      tipo_garantia_aceptada: value('tipo_garantia_aceptada'),
      tipo_ajuste: value('tipo_ajuste'), tasa_ajuste: value('tasa_ajuste'),
      serie_codigo: selectedIndex(data),
      whatsapp: value('whatsapp'),
      descripcion: value('descripcion'),
      ...(listing ? { fuente: listing.fuente } : {}),
      ...(canSponsor ? { patrocinada: data.has('patrocinada') } : {}),
    });
    if (listing) {
      savedListing = publication;
      updateExpenseCurrencies();
      result(output, note('Cambios guardados.'));
      return;
    }
    if (photos.length) {
      result(output, note('Subiendo fotos…'));
      try {
        await uploadPhotos('/publicaciones/' + publication.id, photos);
      } catch (error) {
        photoUploadError = {
          id: publication.id,
          message: 'El aviso se publicó, pero no se pudieron guardar las fotos. ' +
            error.message + ' Podés volver a cargarlas acá.',
        };
      }
    }
    if (!form.isConnected) return;
    setSearchFilters([]);
    location.hash = '#publicacion/' + publication.id;
  });
}

async function contracts(version) {
  if (!user) {
    result(main, `<div class="wrap content"><h1>Mis contratos</h1><div class="panel">${loginPrompt('Ingresá para registrar un contrato o verificar un ajuste.')}</div></div>`);
    return;
  }
  const records = await api('/contratos');
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content"><h1>Mis contratos</h1><p class="muted">Consultá el calendario y compará un importe informado con el ajuste calculado.</p>
    <div class="stack"><section class="panel"><details ${records.length ? '' : 'open'}>
      <summary>Registrar contrato</summary><form id="contract-form" class="fields">
      ${input('Fecha de inicio', 'fecha_inicio', 'type="date" required')}
      ${input('Duración (meses)', 'duracion_meses', 'type="number" min="1" max="120" value="12" required')}
      ${input('Alquiler inicial', 'monto', 'type="number" min="0.01" step="0.01" placeholder="500000" required')}
      ${select('Moneda', 'moneda', currency)}
      ${select('Tipo de ajuste', 'tipo_ajuste', [['INDICE','Por índice'], ['FIJO','Porcentaje fijo']])}
      ${input('Ajuste cada (meses)', 'meses_periodicidad', 'type="number" min="1" max="60" value="3" required')}
      ${indexFields()}
      ${input('Tasa fija por ajuste (%)', 'tasa_ajuste', 'type="number" min="0" step="0.01" required')}
      ${submitButton('Registrar contrato')}</form></details></section>
    <section><h2>Contratos registrados</h2>${records.length ? '<div class="cards">' + records.map((c) =>
      `<article class="card"><p class="eyebrow">Contrato #${c.id}</p><h3>${h(money(c.monto_base))}</h3>
      <p class="muted">${h(date(c.fecha_inicio))} al ${h(date(c.fecha_fin))}<br>${h(adjustment(c))} cada ${c.meses_periodicidad} meses</p>
      <a class="quiet" href="#contrato/${c.id}">Ver contrato</a></article>`).join('') + '</div>' :
      '<p class="empty">Todavía no hay contratos registrados.</p>'}</section></div></div>`);
  const form = main.querySelector('#contract-form');
  setupAdjustmentFields(form);
  submit(form, async (data) => {
    const c = await api('/contratos', 'POST', {
      fecha_inicio: data.get('fecha_inicio'), duracion_meses: Number(data.get('duracion_meses')),
      monto_base: { monto: data.get('monto'), moneda: data.get('moneda') },
      tipo_ajuste: data.get('tipo_ajuste'), meses_periodicidad: Number(data.get('meses_periodicidad')),
      tasa_ajuste: data.get('tasa_ajuste'), serie_codigo: selectedIndex(data),
    });
    location.hash = '#contrato/' + c.id;
  });
}

async function contract(id, version) {
  if (!user) return contracts(version);
  const path = '/contratos/' + id;
  const c = await api(path);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content"><a class="back" href="#contratos">Volver a mis contratos</a>
    <p class="eyebrow">Seguimiento de alquiler</p><h1>Contrato #${c.id}</h1>
    <div class="stack"><section class="panel teal"><div class="metrics">
      ${metric('Alquiler inicial', money(c.monto_base))}${metric('Inicio', date(c.fecha_inicio))}
      ${metric('Ajuste', adjustment(c))}</div><p class="muted">Cada ${c.meses_periodicidad} meses · Fin del contrato: ${h(date(c.fecha_fin))}</p></section>
    <section class="panel"><h2>Calendario de ajustes</h2><div id="calendar" aria-live="polite"></div>
      <form id="adjustment" class="fields">${input('Consultar ajuste vigente al', 'fecha', 'type="date" required')}${submitButton('Consultar ajuste')}</form></section>
    <section class="panel night"><h2>Verificar un ajuste</h2><p>Compará el importe informado con el que calcula Alquilómetro.</p>
      <form id="verification" class="fields">
        ${input('Fecha a verificar', 'fecha_ajuste', 'type="date" required')}
        ${input('Importe informado (' + h(c.monto_base.moneda) + ')', 'monto', 'type="number" min="0.01" step="0.01" required')}
        ${submitButton('Verificar')}</form></section>
    <section class="panel"><h2>Historial de verificaciones</h2><div id="history" aria-live="polite"></div></section></div></div>`);
  const history = main.querySelector('#history');
  const calendar = main.querySelector('#calendar');
  async function historyLoad() {
    try {
      const entries = await api(path + '/verificaciones');
      result(history, entries.length ? table(['Fecha', 'Resultado', 'Informado', 'Esperado', 'Diferencia'],
        entries.map((v) => [date(v.fecha_ajuste), v.resultado, money(v.informado), money(v.esperado), money(v.diferencia)])) :
        '<p class="muted">Todavía no hay verificaciones.</p>');
    } catch (error) { result(history, note(error.message, 'error')); }
  }
  submit(main.querySelector('#adjustment'), async (data, output) => {
    const a = await api(path + '/ajuste?' + query(data));
    result(output, metric('Alquiler ajustado', money(a.monto_ajustado)) + note(a.formula));
  });
  submit(main.querySelector('#verification'), async (data, output) => {
    const v = await api(path + '/verificaciones', 'POST', {
      fecha_ajuste: data.get('fecha_ajuste'),
      monto_informado: { monto: data.get('monto'), moneda: c.monto_base.moneda },
    });
    result(output, note(v.resultado + ' · ' + v.explicacion, v.resultado === 'CORRECTO' ? '' : 'warn') +
      `<div class="metrics">${metric('Informado', money(v.informado))}
      ${metric('Esperado', money(v.esperado))}
      ${metric('Diferencia (' + pct(v.diferencia_porcentual) + ')', money(v.diferencia))}</div>
      <p><small>${h(v.formula)}</small></p>`);
    await historyLoad();
  });
  async function calendarLoad() {
    try {
      const entries = await api(path + '/calendario');
      result(calendar, entries.length ? table(['Fecha', 'Estado', 'Alquiler ajustado'], entries.map((a) =>
        [date(a.fecha), a.estado, money(a.resultado?.monto_ajustado)])) : '<p>No hay ajustes programados.</p>');
      if (entries.length) {
        const usable = entries.filter((item) => item.resultado);
        const example = usable[1] ?? usable[0] ?? entries[0];
        if (version === routeVersion) {
          main.querySelector('#adjustment').elements.fecha.value ||= example.fecha;
          main.querySelector('#verification').elements.fecha_ajuste.value ||= example.fecha;
        }
      }
    } catch (error) { result(calendar, note(error.message, 'error')); }
  }
  await Promise.all([calendarLoad(), historyLoad()]);
}

const legalPages = {
  terminos: {
    title: 'Términos y condiciones',
    sections: [
      ['Cómo funciona Alquilómetro', 'Podés buscar y comparar avisos de alquiler y venta, guardar publicaciones y consultar estimaciones de costos y ajustes. Las consultas sobre un inmueble se coordinan directamente con quien publicó el aviso.'],
      ['Información de los avisos', 'Quien publica debe contar con autorización para ofrecer el inmueble y compartir el material del aviso. Los precios, gastos y condiciones informados pueden cambiar. Confirmalos con el anunciante antes de tomar una decisión.'],
      ['Costos y proyecciones', 'Los totales se calculan con los gastos informados. Si falta algún importe, el total puede ser parcial. Las proyecciones dependen de los datos y supuestos que se muestran en cada cálculo.'],
    ],
  },
  privacidad: {
    title: 'Política de privacidad',
    sections: [
      ['Datos que usás en el sitio', 'Tu cuenta guarda datos de registro y perfil. Si cargás un ingreso de referencia, se usa para calcular qué proporción representarían los costos del alquiler. Si registrás un contrato, sus datos se usan para consultar ajustes y guardar las verificaciones.'],
      ['Publicaciones y mapas', 'Los avisos muestran los datos que publicás para describir el inmueble y el contacto que elegís compartir. La dirección cargada para ubicar el aviso se consulta a USIG y el mapa público muestra una zona aproximada. Los mapas usan OpenStreetMap.'],
      ['Consultas por WhatsApp', 'El formulario prepara un mensaje con los datos que completás y lo abre en WhatsApp. Ahí podés revisarlo antes de enviárselo al anunciante. WhatsApp aplica sus propias condiciones y políticas.'],
      ['Tus derechos', 'Podés solicitar acceso, rectificación, actualización o supresión de tus datos en los casos previstos por la Ley 25.326. El canal de privacidad de Alquilómetro está pendiente de confirmación. <a href="https://www.argentina.gob.ar/aaip/datospersonales/derechos">Consultá tus derechos en la AAIP</a>.'],
    ],
  },
  cookies: {
    title: 'Cookies y almacenamiento',
    sections: [
      ['Sesión y avisos guardados', 'Usamos el almacenamiento de sesión del navegador para mantener tu sesión activa y el almacenamiento local para recordar los avisos guardados en ese navegador.'],
      ['Métricas de los avisos', 'Guardamos en la pestaña si ya contaste como visita o clic a WhatsApp para evitar repetir el conteo al recargar. El portal registra el tipo de evento y el aviso para actualizar los totales.'],
      ['Cómo borrar estos datos', 'Podés cerrar sesión desde Mi cuenta y borrar los datos almacenados del sitio desde la configuración de tu navegador. Al hacerlo también se eliminan los avisos guardados en ese navegador.'],
      ['Servicios externos', 'Al abrir Instagram o WhatsApp, el servicio externo aplica sus propias políticas. El mapa solicita imágenes a OpenStreetMap y la interfaz carga la biblioteca de mapas Leaflet desde jsDelivr.'],
    ],
  },
};

function legalPage({ title, sections }) {
  result(main, `<article class="wrap content legal-content">
    <a class="back" href="#buscar">Volver a Alquilómetro</a>
    <h1>${h(title)}</h1>
    <p class="muted">Versión preliminar</p>
    <div class="panel legal-sections">
      ${sections.map(([heading, copy]) => `<section><h2>${h(heading)}</h2><p>${copy}</p></section>`).join('')}
    </div>
  </article>`);
  main.focus({ preventScroll: true });
}

async function route() {
  closeAccountPanel();
  const comparePanel = document.querySelector('#compare-dialog');
  if (comparePanel.open) comparePanel.close();
  releaseSimilarCarousel?.();
  releaseSimilarCarousel = undefined;
  releasePublicationMap?.();
  releasePublicationMap = undefined;
  releasePhotoPreviews?.();
  releasePhotoPreviews = undefined;
  releaseManagedPhotos?.();
  releaseManagedPhotos = undefined;
  const version = ++routeVersion;
  const [fragment, filterQuery] = location.hash.slice(1).split('?', 2);
  const [page, id] = fragment.split('/');
  const documentPage = Object.hasOwn(legalPages, page) ? legalPages[page] : null;
  const tab = documentPage ? page : ['contrato', 'contratos'].includes(page) ? 'contratos' :
    ['publicar', 'cuenta', 'comprar', 'mis-publicaciones', 'admin'].includes(page) ? page : 'buscar';
  const isPublication = page === 'publicacion' && /^\d+$/.test(id);
  const isPublisher = page === 'publicador' && /^\d+$/.test(id);
  const view = isPublication ? 'publicacion' : isPublisher ? 'publicador' : page === 'guardados' ? 'guardados' : tab;
  const isCatalog = ['buscar', 'comprar'].includes(view);
  const comparisonToRestore = (isCatalog || view === 'guardados') && history.state?.returnComparison;
  if (comparisonToRestore) {
    compared.clear();
    for (const id of comparisonToRestore.ids) compared.set(id, comparisonToRestore.operation);
  }
  const returningToResults = currentView === 'publicacion' && isCatalog;
  if (['buscar', 'comprar'].includes(currentView) && isPublication) resultsScrollY = window.scrollY;
  if (isPublication && currentView !== 'publicacion') {
    publicationBackLink = currentView === 'guardados' ? savedPageLink : undefined;
  }
  if (view === 'guardados') savedPageLink = location.hash;
  currentView = view;
  if (isCatalog) {
    searchOperation = view === 'comprar' ? 'venta' : 'alquiler';
    setSearchFilters(new URLSearchParams(filterQuery));
  }
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  result(main, '<div class="wrap content"><p role="status">Cargando…</p></div>');
  window.scrollTo(0, 0);
  try {
    if (documentPage) legalPage(documentPage);
    else if (isPublication) await publication(id, version);
    else if (isPublisher) await publisherPage(id, version);
    else if (view === 'guardados') await savedListingsPage(filterQuery, version);
    else if (view === 'cuenta') accountPage(new URLSearchParams(filterQuery));
    else if (view === 'admin') await adminPage(version);
    else if (view === 'mis-publicaciones') {
      const fromAdmin = user?.rol === 'ADMIN' && new URLSearchParams(filterQuery).get('origen') === 'admin';
      await myListings(/^\d+$/.test(id) ? id : null, version, fromAdmin);
    }
    else if (page === 'contrato' && /^\d+$/.test(id)) await contract(id, version);
    else if (page === 'contratos') await contracts(version);
    else if (page === 'publicar') await newListing(version);
    else {
      await search(version, returningToResults);
      if (returningToResults && version === routeVersion) {
        window.scrollTo({top: resultsScrollY, behavior: 'instant'});
      }
    }
    if (comparisonToRestore && version === routeVersion) {
      window.scrollTo({ top: comparisonToRestore.scrollY, behavior: 'instant' });
      await openComparison();
    }
  } catch (error) {
    if (version === routeVersion) result(main, `<div class="wrap content">${note(error.message, 'error')}
      <a class="quiet" href="#buscar">Ir a publicaciones</a></div>`);
  }
}

function setupScrollHeader() {
  let referenceY = Math.max(0, window.scrollY);

  window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY);
    if (y <= header.offsetHeight) {
      header.classList.remove('top-hidden');
      referenceY = y;
      return;
    }

    const distance = y - referenceY;
    if (Math.abs(distance) < 12) return;
    header.classList.toggle('top-hidden', distance > 0);
    referenceY = y;
  }, { passive: true });
}

if (token) {
  try { setUser(await api('/usuarios/me'), token); }
  catch { setUser(null); }
}
setupScrollHeader();
document.querySelector('#footer-back-to-top').onclick = () => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
  header.querySelector('.brand').focus({ preventScroll: true });
};
// Los resultados se reconstruyen después de navegar, así que restauramos su
// posición una vez que el listado y la portada terminaron de renderizar.
history.scrollRestoration = 'manual';
window.addEventListener('hashchange', route);
await route();
