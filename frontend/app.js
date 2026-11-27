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
let releaseListingCarousel;
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
const maxListingPhotoMB = 15;
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
  ['UVA', 'UVA · Unidad de Valor Adquisitivo'],
  ['UVI', 'UVI · Unidad de Vivienda'],
  ['CER', 'CER · Coeficiente de Estabilización de Referencia'],
  ['CVS', 'CVS · Coeficiente de Variación Salarial'],
  ['RIPTE', 'RIPTE · Salarios de trabajadores estables'],
  ['ICC', 'ICC · Costo de la construcción (INDEC)'],
];
const favoriteStorageKey = 'alquilometro-favoritos';
let favorites = readFavorites();
const compared = new Map();
const searchFilterLabels = {
  zona: 'Barrio', ambientes: 'Ambientes', permite_mascotas: 'Mascotas', moneda: 'Moneda',
  tipo_garantia: 'Garantía', alquiler_min: 'Alquiler desde', alquiler_max: 'Alquiler hasta',
  costo_real_min: 'Costo mensual desde', costo_real_max: 'Costo mensual máximo',
  costo_entrada_max: 'Máximo para entrar',
  precio_min: 'Precio desde', precio_max: 'Precio hasta',
  orden: 'Orden', descendente: 'Sentido',
};
const canManageListings = () => ['INMOBILIARIA', 'ADMIN'].includes(user?.rol);
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
    const error = new Error(detail || 'La API devolvió un error (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return data;
}

function setUser(profile, accessToken = null) {
  if (profile?.id !== user?.id) favorites = profile ? new Set() : readFavorites();
  user = profile;
  token = accessToken;
  if (token) sessionStorage.setItem('alquilometro-token', token);
  else sessionStorage.removeItem('alquilometro-token');
  document.querySelector('#account-name').textContent = profile ? profile.nombre : 'Ingresar';
  const initial = document.querySelector('#account-initial');
  initial.textContent = profile?.nombre.trim().slice(0, 1).toUpperCase() ?? '';
  initial.hidden = !profile;
  if (profile) {
    account.setAttribute('aria-controls', 'account-panel');
    account.setAttribute('aria-expanded', String(!accountPanel.hidden));
  } else {
    closeAccountPanel();
    account.removeAttribute('aria-controls');
    account.removeAttribute('aria-expanded');
  }
  document.querySelector('#listings-menu').hidden = !canManageListings();
  document.querySelector('#plans-link').hidden = profile?.rol !== 'INMOBILIARIA';
  document.querySelector('#admin-link').hidden = profile?.rol !== 'ADMIN';
  mostrarAvisoDeAbono();
}

function abonoPorVencer(profile) {
  if (profile?.rol !== 'INMOBILIARIA' || !profile.abono_vigente || !profile.abono_vigente_hasta) return false;
  const fechaLimite = new Date(fechaActualArgentina() + 'T00:00:00Z');
  fechaLimite.setUTCDate(fechaLimite.getUTCDate() + 3);
  return profile.abono_vigente_hasta <= fechaLimite.toISOString().slice(0, 10);
}

function mostrarAvisoDeAbono() {
  const banner = document.querySelector('#renewal-banner');
  banner.hidden = true;
  if (user?.rol !== 'INMOBILIARIA') return;

  const corte = user.abono_ocultar_desde;
  let titulo;
  let detalle;
  if (abonoPorVencer(user)) {
    titulo = 'Tu abono está por vencer';
    detalle = 'Está vigente hasta el ' + date(user.abono_vigente_hasta) + '.';
  } else if (!user.abono_vigente && corte) {
    titulo = user.abono_vigente_hasta ? 'Tu abono venció' : 'Tu inmobiliaria todavía no tiene un abono';
    detalle = fechaActualArgentina() < corte
      ? 'Tus avisos activos se ocultarán el ' + date(corte) + ' si no regularizás el abono.'
      : 'Tus avisos ya no aparecen en las búsquedas. Entrá a Planes y pagos para renovar.';
  } else {
    return;
  }

  banner.querySelector('#renewal-banner-title').textContent = titulo;
  banner.querySelector('#renewal-banner-date').textContent = detalle;
  banner.hidden = false;
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
      await handler(new FormData(form), output, event.submitter);
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

function indexFields(currentIndex = null) {
  const choices = [['', 'Elegí un índice'], ...adjustmentIndexes];
  if (currentIndex && !choices.some(([code]) => code === currentIndex)) {
    choices.push([currentIndex, currentIndex + ' · Índice del aviso']);
  }
  return `<div data-index-choice>
    ${select('Índice de ajuste', 'serie_codigo', choices,
      'aria-describedby="index-history-hint"')}
    <small id="index-history-hint">Para calcular el ajuste usamos el historial disponible del índice elegido.</small>
  </div>`;
}

function setupAdjustmentFields(form) {
  const { tipo_ajuste } = form.elements;
  function update() {
    const mode = tipo_ajuste.disabled ? '' : tipo_ajuste.value;
    const byIndex = mode === 'INDICE';
    for (const [field, visible] of [
      ['serie_codigo', byIndex],
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
  update();
  return update;
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
    ${canManageListings() ? '<a class="quiet" href="#planes">Planes y pagos</a>' : ''}
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

function openAccount(register = false, role = 'BUSCADOR') {
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
    <div class="actions">
      <button class="quiet" type="button" id="toggle-account">${register ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
      ${register ? '' : '<button class="text-action" type="button" id="forgot-password">Olvidé mi contraseña</button>'}
    </div>`);
  const form = dialogBody.querySelector('#login-form');
  if (register) {
    form.elements.rol.value = role;
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
    await loadAccountFavorites();
    dialog.close();
    await route();
    if (user?.rol === 'INMOBILIARIA' && !user.abono_vigente && !dialog.open) {
      showAgencyPlanOffer();
    }
    if (abonoPorVencer(user) && !dialog.open) {
      result(dialogBody, `<h2 id="dialog-title">Tu abono está por vencer</h2>
        <p>Está vigente hasta el <strong>${h(date(user.abono_vigente_hasta))}</strong>.</p>
        <a class="btn" href="#planes">Ver renovación</a>`);
      dialogBody.querySelector('a').onclick = () => dialog.close();
      dialog.showModal();
    }
    if (user?.rol === 'ADMIN') void showPaymentAlerts(routeVersion);
  });
  dialogBody.querySelector('#toggle-account').onclick = () => openAccount(!register);
  dialogBody.querySelector('#forgot-password')?.addEventListener('click', openRecovery);
  if (!dialog.open) dialog.showModal();
  dialogBody.querySelector('#login-form input')?.focus();
}

function openRecovery() {
  result(dialogBody, `<h2 id="dialog-title">Recuperar contraseña</h2>
    <p>Ingresá el correo de tu cuenta para recibir un enlace.</p>
    <form id="recovery-form">
      ${input('Correo', 'email', 'type="email" required maxlength="255" autocomplete="email"')}
      ${submitButton('Enviar enlace')}
    </form><button class="text-action" type="button" id="recovery-back">Volver al ingreso</button>`);
  const form = dialogBody.querySelector('#recovery-form');
  submit(form, async (data, output) => {
    const response = await api('/auth/recuperar', 'POST', { email: data.get('email').trim() });
    result(output, note(response.mensaje));
  });
  dialogBody.querySelector('#recovery-back').onclick = () => openAccount();
  if (!dialog.open) dialog.showModal();
  form.elements.email.focus();
}

function resetPasswordPage(resetToken) {
  const usable = /^[A-Za-z0-9_-]{43}$/.test(resetToken ?? '');
  if (usable) history.replaceState(history.state, '', '#recuperar');
  const attributes = 'required minlength="8" maxlength="128" autocomplete="new-password"';
  result(main, `<div class="wrap content"><section class="panel reset-password-page">
    <h1>Restablecer contraseña</h1>
    ${usable ? `<form id="reset-password-form">
      ${passwordField('Nueva contraseña', 'password', 'reset-password', attributes)}
      ${passwordField('Repetí la nueva contraseña', 'confirmation', 'reset-confirmation', attributes)}
      ${submitButton('Guardar contraseña')}
    </form>` : note('Abrí el enlace que te llegó por correo o pedí uno nuevo.')}
    <button class="text-action" type="button" id="request-reset">Pedir un enlace nuevo</button>
  </section></div>`);
  main.querySelector('#request-reset').onclick = openRecovery;
  const form = main.querySelector('#reset-password-form');
  if (!form) return;
  setupPasswordToggles(form);
  submit(form, async (data) => {
    const password = data.get('password');
    if (password !== data.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
    await api('/auth/restablecer', 'POST', { token: resetToken, password });
    setUser(null);
    result(main.querySelector('.reset-password-page'), `<h1>Contraseña actualizada</h1>
      <p>Ya podés ingresar con la contraseña nueva.</p><button class="btn" type="button" data-login>Ingresar</button>`);
  });
}

function showAgencyPlanOffer() {
  result(dialogBody, `<div class="agency-plan-offer">
    <div class="agency-plan-intro">
      <h2 id="dialog-title">Dale más visibilidad a tus propiedades</h2>
      <p>Elegí cómo mostrar tu cartera y destacá los avisos que más te interesa mover.</p>
    </div>
    <div class="agency-plan-benefits">
      <p><strong>Gestioná tus avisos en un solo lugar</strong>
        <span>Actualizá precios, fotos y disponibilidad de tus alquileres y ventas.</span></p>
      <p><strong>Medí qué propiedades generan interés</strong>
        <span>Consultá las visitas y los clics a WhatsApp de cada aviso.</span></p>
      <p><strong>Destacá las propiedades que elijas</strong>
        <span>Al destacarlo, tu aviso puede aparecer entre los primeros resultados cuando coincide con la búsqueda.</span></p>
      <a class="btn" href="#planes">Ver planes y precios <span aria-hidden="true">→</span></a>
    </div>
  </div>`);
  dialogBody.querySelector('a').onclick = () => dialog.close();
  dialog.showModal();
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

async function loadAccountFavorites() {
  const id = user?.id;
  if (!id) return;
  try {
    const saved = await api('/usuarios/me/guardados');
    if (user?.id === id) favorites = new Set(saved);
  } catch {
    // Un problema con los guardados no interrumpe la sesión.
  }
}

async function toggleFavorite(button) {
  const id = Number(button.dataset.favorite);
  const saved = !favorites.has(id);
  const cuenta = user?.id;
  if (cuenta) {
    button.disabled = true;
    try {
      await api('/usuarios/me/guardados/' + id, saved ? 'PUT' : 'DELETE');
    } catch (error) {
      button.title = error.message;
      if (!button.nextElementSibling?.matches('[data-favorite-feedback]')) {
        button.insertAdjacentHTML('afterend', '<small data-favorite-feedback role="status"></small>');
      }
      button.nextElementSibling.textContent = error.message;
      return false;
    } finally {
      button.disabled = false;
    }
    if (user?.id !== cuenta) return false;
  }
  if (saved) favorites.add(id);
  else favorites.delete(id);
  if (!cuenta) {
    try { localStorage.setItem(favoriteStorageKey, JSON.stringify([...favorites])); }
    catch { /* Los guardados quedan disponibles durante esta visita. */ }
  }
  if (button.nextElementSibling?.matches('[data-favorite-feedback]')) button.nextElementSibling.remove();
  button.setAttribute('aria-pressed', String(saved));
  button.title = saved ? 'Quitar de guardados' : 'Guardar aviso';
  button.firstElementChild.textContent = saved ? '♥' : '♡';
  return true;
}

function searchLink() {
  return (searchOperation === 'venta' ? '#comprar' : '#buscar') + (filters.size ? '?' + filters : '');
}

function sharedFavoritesLink(ids) {
  return '#guardados?avisos=' + [...ids].join(',');
}

function saveCurrentSearch() {
  if (!user) {
    openAccount();
    return;
  }
  const link = searchLink();
  const name = (searchOperation === 'venta' ? 'Comprar' : 'Alquilar') +
    (filters.has('zona') ? ' en ' + filters.get('zona') : '');
  result(dialogBody, `<h2 id="dialog-title">Guardar búsqueda</h2>
    <form>
      ${input('Nombre de la búsqueda', 'nombre', `required maxlength="100" value="${h(name)}"`)}
      ${submitButton('Guardar búsqueda')}
    </form>`);
  submit(dialogBody.querySelector('form'), async (data) => {
    await api('/usuarios/me/busquedas', 'PUT', { nombre: data.get('nombre').trim(), enlace: link });
    result(dialogBody, `<h2 id="dialog-title">Búsqueda guardada</h2>
      <a class="btn" href="#guardados">Ver mis guardados</a>`);
    dialogBody.querySelector('a').onclick = () => dialog.close();
  });
  dialog.showModal();
}

function setSearchFilters(next, forSale = searchOperation === 'venta') {
  const unavailable = forSale ?
    ['tipo_garantia', 'alquiler_min', 'alquiler_max', 'costo_real_min', 'costo_real_max', 'costo_entrada_max'] :
    ['precio_min', 'precio_max'];
  filters = new URLSearchParams([...next].filter(([key, value]) =>
    Object.hasOwn(searchFilterLabels, key) && !unavailable.includes(key) && value &&
    (key !== 'descendente' || value === 'true') &&
    (key !== 'orden' || (forSale ? ['precio', 'precio_m2'] : ['alquiler', 'costo_real', 'precio_m2']).includes(value))));
  if (!filters.has('orden')) filters.delete('descendente');
  if (!filters.has('moneda') && (filters.has('costo_real_max') || filters.has('costo_entrada_max'))) {
    filters.set('moneda', 'ARS');
  }
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
const sponsoredBadge = '<span class="sponsored-badge">Destacado</span>';

function listingCostRow(title, cost, className = '') {
  const pending = cost?.faltantes ?? [];
  return `<div class="listing-cost-row">
    <div class="listing-cost-line"><small>${title}</small><strong class="money ${className}">${h(money(cost?.total))}</strong></div>
    ${pending.length ? `<small class="listing-cost-pending">Por confirmar · ${h(pending.map(label).join(', '))}</small>` :
      cost ? '' : '<small class="listing-cost-pending">El total no está disponible.</small>'}
  </div>`;
}

function listingCard(listing, canCompare = true) {
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
      ${listingCostRow('Costo mensual informado', listing.costo_mensual, 'cost')}
      <p><span class="tag">${h(adjustment(listing))}</span></p>`}
    <div class="actions"><a class="quiet" href="${detail}">${isSale(listing) ? 'Ver propiedad' : 'Ver costos y proyección'}</a>
      ${canCompare ? `<button type="button" class="compare-toggle" data-compare="${listing.id}" aria-label="Comparar ${h(listing.titulo)}"
        data-operation="${isSale(listing) ? 'venta' : 'alquiler'}"
        aria-pressed="${compared.has(listing.id)}">${compared.has(listing.id) ? '✓ Seleccionado' : '+ Comparar'}</button>` : ''}</div>
  </article>`;
}

function showListingCards(container, listings, { comparison, onFavorite } = {}) {
  result(container, `<div class="cards">${listings.map((listing) =>
    listingCard(listing, Boolean(comparison))).join('')}</div>`);
  container.onclick = async (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) {
      if (await toggleFavorite(favorite)) onFavorite?.(favorite);
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
  .sort((a, b) => b.id - a.id);

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
  return `<h2 id="sponsored-title">Destacados</h2>
    <div class="sponsored-carousel">
    ${carouselControls('sponsored-list', 'Recorrer destacados')}
    <div class="sponsored-list" id="sponsored-list" tabindex="0" role="group" aria-labelledby="sponsored-title">
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
    </div></div>`;
}

async function search(version, returningToResults) {
  const forSale = searchOperation === 'venta';
  const catalog = '/publicaciones?operacion=' + searchOperation;
  result(main, `<section class="hero"><div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="eyebrow">${forSale ? 'Propiedades en venta en CABA' : 'Alquileres en CABA'}</p>
      <h1>${forSale ? 'Encontrá tu lugar <em>en Buenos Aires.</em>' : 'Tu próximo hogar, <em>con cuentas claras.</em>'}</h1>
      <p>${forSale ? 'Compará propiedades por barrio y precio. Cuando encuentres una que te guste, contactá al anunciante para coordinar una visita.' :
        'Compará alquileres por su costo mensual, mirá cuánto necesitás para entrar y estimá cómo puede cambiar el precio con los ajustes.'}</p>
      <div class="hero-actions">
        <button class="btn hero-cta" type="button">${forSale ? 'Explorar propiedades en venta' : 'Explorar alquileres'} <span aria-hidden="true">↓</span></button>
        ${!user ? '<button class="hero-agency" type="button" data-agency-register>Publicar como inmobiliaria <span aria-hidden="true">→</span></button>' :
          user.rol === 'INMOBILIARIA' ? '<a class="hero-agency" href="#mis-publicaciones">Gestionar mis avisos <span aria-hidden="true">→</span></a>' : ''}
      </div>
      <div class="hero-neighborhoods" role="group" aria-label="Buscar por barrio" hidden></div>
    </div>
    <aside class="hero-data" id="featured" aria-live="polite">
      <div class="hero-feature-empty"><small>Cargando publicación…</small></div>
    </aside>
  </div></section>
  <section class="wrap content catalog-content">
  <section id="sponsored-listings" class="sponsored-strip" aria-labelledby="sponsored-title" hidden></section>
  <section class="filters" aria-labelledby="search-title">
    <header class="search-heading"><h2 id="search-title">${forSale ? 'Buscar propiedades en venta' : 'Buscar alquileres'}</h2></header>
    <form id="filters">
      <div class="search-fields${forSale ? '' : ' search-fields-rent'}">
      ${select('Barrio', 'zona', [['', 'Todos los barrios']])}
      ${select('Ambientes', 'ambientes', [['', 'Todos los ambientes']])}
      ${select('Mascotas', 'permite_mascotas', [['','Indistinto'],['true','Acepta mascotas'],['false','No acepta mascotas']])}
      ${select('Moneda', 'moneda', [['','Todas'], ...currency])}
      ${forSale ? '' : input('Costo mensual máximo', 'costo_real_max',
        'type="number" min="0" step="0.01" placeholder="Ej. 700000" aria-describedby="budget-hint"')}
      ${forSale ? '' : input('Máximo para entrar', 'costo_entrada_max',
        'type="number" min="0" step="0.01" placeholder="Ej. 1500000" aria-describedby="budget-hint"')}
      ${forSale ? '' : '<small class="full" id="budget-hint">El costo mensual suma el alquiler y los gastos informados. El máximo para entrar muestra avisos con todos los gastos de entrada informados. Si no elegís moneda, se usa ARS para estos topes.</small>'}
      </div>
      <details class="search-advanced"><summary>Más filtros y orden</summary><div class="fields">
        ${forSale ? `
          ${input('Precio de venta mínimo', 'precio_min', 'type="number" min="0" step="0.01"')}
          ${input('Precio de venta máximo', 'precio_max', 'type="number" min="0" step="0.01"')}` : `
        ${select('Garantía', 'tipo_garantia', [['', 'Todas las garantías']])}
        ${input('Alquiler mínimo', 'alquiler_min', 'type="number" min="0" step="0.01"')}
        ${input('Alquiler máximo', 'alquiler_max', 'type="number" min="0" step="0.01"')}
        ${input('Costo mensual mínimo', 'costo_real_min', 'type="number" min="0" step="0.01"')}`}
        ${select('Ordenar por', 'orden', [['','Predeterminado'], ...(forSale ?
          [['precio','Precio de venta']] : [['alquiler','Alquiler'], ['costo_real','Costo mensual']]), ['precio_m2','Precio por m²']])}
        ${select('Sentido', 'descendente', [['false','Menor a mayor'],['true','Mayor a menor']])}
        <small class="full">Para filtrar u ordenar montos, elegí una moneda.</small>
      </div></details>
      <div class="search-actions">
        <button class="search-reset" type="reset">Limpiar filtros</button>
        <button class="btn search-submit" type="submit">Ver resultados <span aria-hidden="true">→</span></button>
      </div>
    </form>
  </section>
  <div class="results-toolbar">
    <div id="active-filters" class="filter-chips" aria-label="Filtros activos"></div>
    <div class="actions">
      <a class="quiet" href="#guardados" id="saved-link">Guardados (${favorites.size})</a>
      <button type="button" class="quiet" id="save-search" hidden>Guardar búsqueda</button>
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
  const saveSearch = main.querySelector('#save-search');
  saveSearch.onclick = saveCurrentSearch;
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
    saveSearch.hidden = !filters.size;
    comparison.update();
  }

  function showMore(limit) {
    const batch = listings.slice(shown, limit);
    const cards = results.querySelector('.cards');
    more.disabled = true;
    const previous = cards.childElementCount;
    cards.insertAdjacentHTML('beforeend', batch.map((p) => listingCard(p)).join(''));
    shown += batch.length;
    resultsProgress = { link: searchLink(), shown, ids: listings.map((p) => p.id) };
    results.querySelector('[data-results-count]').textContent = `Mostrando ${shown} de ${listings.length}`;
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
        const carousel = sponsored.querySelector('.sponsored-list');
        if (carousel) setupListingCarousel(sponsored, carousel, carousel);
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
        (listings.length ? '<div class="cards"></div>' :
          note(filters.has('costo_entrada_max') ? 'No encontramos avisos con todos los gastos de entrada informados que coincidan con estos filtros.' :
            'No encontramos publicaciones con esos filtros.')));
      if (!listings.length) return;
      showMore(progress?.shown ?? resultsPageSize);
    } catch (error) {
      if (version === routeVersion && current === revision) result(results, note(error.message, 'error'));
    }
  }
  function applyFilters(next) {
    next = query(next);
    setSearchFilters(next);
    history.replaceState(history.state, '', searchLink());
    share.parentElement.querySelector('[data-copy-status]').textContent = '';
    syncForm();
    return load();
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    return applyFiltersAndScroll(new FormData(form));
  };
  form.onreset = (event) => { event.preventDefault(); applyFilters([]); };
  chips.onclick = (event) => {
    const chip = event.target.closest('[data-remove-filter]');
    if (!chip) return;
    const key = chip.dataset.removeFilter;
    const next = new URLSearchParams(filters);
    next.delete(key);
    if (key === 'moneda') {
      for (const dependent of ['orden', 'alquiler_min', 'alquiler_max', 'costo_real_min', 'costo_real_max', 'costo_entrada_max', 'precio_min', 'precio_max']) next.delete(dependent);
    }
    applyFilters(next);
    (chips.querySelector('button') || form.elements.zona).focus({preventScroll: true});
  };
  results.onclick = async (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) {
      if (await toggleFavorite(favorite)) savedLink.textContent = `Guardados (${favorites.size})`;
    }
    comparison.select(event);
  };
  function scrollToResults() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
  }
  async function applyFiltersAndScroll(data) {
    const loading = applyFilters(data);
    const current = revision;
    await loading;
    if (version === routeVersion && current === revision) scrollToResults();
  }
  main.querySelector('.hero-cta').onclick = scrollToResults;
  main.querySelector('[data-agency-register]')?.addEventListener('click', () => openAccount(true, 'INMOBILIARIA'));
  quickZones.onclick = (event) => {
    const button = event.target.closest('[data-zone]');
    if (!button) return;
    form.elements.zona.value = button.dataset.zone;
    if (!form.reportValidity()) return;
    return applyFiltersAndScroll(new FormData(form));
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
      result(quickZones, '<span>Explorá por barrio</span>' + neighborhoods.slice(0, 5).map((zone) =>
        `<button type="button" data-zone="${h(zone)}">${h(zone)}</button>`).join(''));
      quickZones.hidden = !neighborhoods.length;
      const p = listings.find((item) => !item.patrocinada && item.fotos?.length) ||
        listings.find((item) => !item.patrocinada) || listings[0];
      if (!p) {
        result(featured, '<div class="hero-feature-empty"><p>Por ahora no hay propiedades publicadas en esta sección.</p></div>');
        return;
      }
      const cost = p.costo_mensual;
      const cover = p.fotos?.[0];
      const isExample = ['semilla', 'demo-fotos', 'demo-venta'].includes(p.fuente);
      result(featured, `
        ${cover ? `<div class="hero-visual"><img class="hero-photo" src="/api${h(cover.url)}" alt="Foto de la propiedad en ${h(p.propiedad.zona)}" fetchpriority="high"></div>` : ''}
        <div class="hero-feature-body">
          <div class="hero-feature-head">
            <div><h2>${h(p.propiedad.zona)}</h2><small>${h(metadata(p.propiedad))}</small></div>
            ${p.patrocinada ? sponsoredBadge :
              isExample ? '<span class="tag">Aviso de ejemplo</span>' : ''}
          </div>
          <dl class="hero-prices${forSale ? ' hero-prices-sale' : ''}">
            <div><dt>${forSale ? 'Precio de venta' : 'Alquiler publicado'}</dt><dd>${h(money(askingPrice(p)))}</dd></div>
            ${forSale ? '' : `<div><dt>Costo mensual informado</dt><dd>${h(money(cost?.total))}</dd></div>`}
          </dl>
          <div class="hero-feature-foot">
            ${cost?.faltantes?.length ? '<small>Hay gastos sin informar</small>' : ''}
            <a href="#publicacion/${p.id}">${forSale ? 'Ver propiedad' : 'Ver desglose'} <span aria-hidden="true">→</span></a>
          </div>
        </div>`);
    } catch {
      result(featured, note('No pudimos cargar la publicación destacada.'));
    }
  })();
  await Promise.all([load(true), featuredLoad]);
}

async function loadSavedSearches(panel) {
  if (!user) return;
  const output = panel.querySelector('[data-saved-searches]');
  try {
    const searches = await api('/usuarios/me/busquedas');
    if (!output.isConnected) return;
    result(output, searches.length ? `<ul class="saved-search-list">${searches.map(({ nombre, enlace }) => `
      <li><a class="quiet" href="${h(enlace)}">${h(nombre)}</a>
      <button type="button" class="quiet" data-remove-search="${h(enlace)}"
        aria-label="Quitar búsqueda ${h(nombre)}">Quitar</button></li>`).join('')}</ul>`
      : '<p class="muted">Aplicá filtros en el catálogo y tocá «Guardar búsqueda» para retomarla después.</p>');
  } catch (error) {
    if (output.isConnected) result(output, note(error.message, 'error'));
  }
}

async function loadSavedAlerts(panel) {
  try {
    const alerts = await api('/usuarios/me/alertas');
    if (!panel.isConnected) return;
    const items = alerts.busquedas.map((search) => `<li><a href="${h(search.enlace)}">${h(search.nombre)}</a>
      <span>${number(search.nuevos)} ${search.nuevos === 1 ? 'aviso nuevo' : 'avisos nuevos'}</span></li>`);
    items.push(...alerts.precios.map((item) => `<li><a href="#publicacion/${item.aviso_id}">${h(item.titulo)}</a>
      <span>Bajó de ${h(money(item.precio_anterior))} a <strong>${h(money(item.precio_actual))}</strong></span></li>`));
    result(panel, items.length ? `<ul class="activity-list">${items.join('')}</ul>
      <button class="quiet" type="button">Marcar novedades como vistas</button><div role="status"></div>` :
      '<p class="muted">Cuando haya avisos nuevos que coincidan con tus búsquedas o baje el precio de un guardado, lo vas a ver acá.</p>');
    const button = panel.querySelector('button');
    if (button) button.onclick = async () => {
      button.disabled = true;
      try {
        await api('/usuarios/me/alertas/vistas', 'POST', alerts);
        if (panel.isConnected) await loadSavedAlerts(panel);
      } catch (error) {
        result(panel.querySelector('[role="status"]'), note(error.message, 'error'));
        button.disabled = false;
      }
    };
  } catch (error) {
    if (panel.isConnected) result(panel, note(error.message, 'error'));
  }
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
    ${!isShared && user ? '<section class="panel saved-searches"><h2>Novedades de tus guardados</h2><div id="saved-alerts" aria-live="polite">Cargando…</div></section>' : ''}
    ${isShared ? '' : `<section class="panel saved-searches" id="saved-searches">
      <h2>Búsquedas guardadas</h2>
      ${user ? '<div data-saved-searches aria-live="polite">Cargando…</div>' :
        loginPrompt('Ingresá para guardar búsquedas y sincronizar tus favoritos.')}
      ${user && [...readFavorites()].some((id) => !favorites.has(id)) ?
        '<button class="quiet" type="button" id="import-favorites">Importar avisos de este navegador</button>' : ''}
      <div data-saved-search-status role="status"></div>
    </section>`}
    <div id="saved-results"></div>
    ${comparisonTray}
  </div>`);

  const output = main.querySelector('#saved-results');
  const searchPanel = main.querySelector('#saved-searches');
  if (searchPanel && user) {
    void loadSavedAlerts(main.querySelector('#saved-alerts'));
    void loadSavedSearches(searchPanel);
    searchPanel.onclick = async (event) => {
      const remove = event.target.closest('[data-remove-search]');
      const importing = event.target.closest('#import-favorites');
      if (!remove && !importing) return;
      const status = searchPanel.querySelector('[data-saved-search-status]');
      const button = remove || importing;
      button.disabled = true;
      try {
        if (remove) {
          await api('/usuarios/me/busquedas?' + new URLSearchParams({ enlace: remove.dataset.removeSearch }), 'DELETE');
          await loadSavedSearches(searchPanel);
        } else {
          const browserIds = [...readFavorites()].filter((id) => !favorites.has(id));
          const imported = await Promise.allSettled(browserIds.map((id) =>
            api('/usuarios/me/guardados/' + id, 'PUT')));
          await loadAccountFavorites();
          if (!searchPanel.isConnected) return;
          const count = imported.filter((item) => item.status === 'fulfilled').length;
          await route();
          const feedback = main.querySelector('[data-saved-search-status]');
          if (feedback) result(feedback, note(`Avisos importados: ${count} de ${browserIds.length}.`));
        }
      } catch (error) {
        if (status.isConnected) result(status, note(error.message, 'error'));
      } finally {
        button.disabled = false;
      }
    };
  }
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

  showListingCards(output, selected, {
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

const planNames = { abono: 'Abono inmobiliaria', patrocinio: 'Aviso destacado' };
const mediosPago = { transferencia: 'Transferencia', mercado_pago: 'Mercado Pago', otro: 'Otro' };

function camposConciliacion(referencia) {
  return `${input('Importe acreditado en ARS', 'importe_recibido_ars', 'type="number" min="1" max="2000000000" step="1" required')}
    ${select('Medio de pago', 'medio', Object.entries(mediosPago))}
    ${input('Referencia que figura en la acreditación', 'referencia_acreditada', `required maxlength="100" value="${h(referencia)}"`)}`;
}

function datosConciliacion(data) {
  return {
    importe_recibido_ars: Number(data.get('importe_recibido_ars')),
    medio: data.get('medio'),
    referencia_acreditada: data.get('referencia_acreditada').trim(),
  };
}
const precioPlan = (monto) => money({ monto, moneda: 'ARS' });

function historialPagos(pagos) {
  if (!pagos.length) return '<p class="muted">Todavía no hay pagos registrados.</p>';
  const estados = { pendiente: 'En revisión', confirmado: 'Confirmado', rechazado: 'Requiere corrección' };
  return `<div class="table-wrap"><table>
    <thead><tr><th>Concepto</th><th>Importe</th><th>Fecha</th><th>Referencia</th><th>Estado</th></tr></thead>
    <tbody>${pagos.map((pago) => `<tr>
      <td><strong>${h(planNames[pago.concepto])}</strong>${pago.titulo_aviso ? `<br><small>${h(pago.titulo_aviso)}</small>` : ''}</td>
      <td>${pago.importe_recibido_ars != null ? `<strong>${h(precioPlan(pago.importe_recibido_ars))}</strong><br><small>Acreditado</small>`
        : (pago.importe_ars == null ? '—' : `${h(precioPlan(pago.importe_ars))}<br><small>Esperado</small>`)}</td>
      <td>${h(date(pago.pagado_el || pago.informado_el))}</td>
      <td>${h(pago.referencia_acreditada || pago.referencia || '—')}${pago.medio ? `<br><small>${h(mediosPago[pago.medio])}</small>` : ''}</td>
      <td><strong>${h(estados[pago.estado])}</strong>${pago.motivo ? `<br><small>${h(pago.motivo)}</small>` : ''}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function refreshPaymentHistory() {
  const historial = main.querySelector('#payment-history');
  if (!historial) return;
  try {
    const pagos = await api('/planes/pagos');
    if (historial.isConnected) result(historial, '<h2>Historial de pagos</h2>' + historialPagos(pagos));
  } catch (error) {
    if (historial.isConnected) historial.insertAdjacentHTML('beforeend', note(error.message, 'error'));
  }
}

function estadoDelAbono(precios) {
  if (user?.rol !== 'INMOBILIARIA') return '';
  const hoy = fechaActualArgentina();
  const corte = precios.abono_ocultar_desde;
  if (!corte) return '';
  if (precios.abono_vigente_hasta && precios.abono_vigente_hasta >= hoy) {
    return note('Abono vigente hasta el ' + date(precios.abono_vigente_hasta) + '.');
  }
  if (hoy < corte) {
    return note('Tus avisos siguen visibles hasta que empiece el ' + date(corte) + '. Activá o renová tu abono para evitar la pausa.', 'warn');
  }
  const borrar = precios.abono_eliminar_desde;
  const plazo = borrar ? ' Los avisos guardados se eliminan a partir del ' + date(borrar) + ' si no renovás.' : '';
  const revision = precios.abono_pago_pendiente ? ' La eliminación queda en espera mientras revisamos el pago informado.' : '';
  return note('Tus avisos están ocultos por vencimiento del abono.' + (revision || plazo), 'warn');
}

function datosTransferenciaHTML(pago) {
  return `${pago.modo_prueba ? note('Modo de prueba. No hagas una transferencia real.', 'warn') : ''}
    <dl class="transfer-details">
      ${[['Titular', pago.titular], ['Alias', pago.alias], ['CVU', pago.cvu]].map(([nombre, valor]) =>
        `<div class="row"><dt>${nombre}</dt><dd>${h(valor)}
          ${nombre !== 'Titular' ? `<button class="quiet" type="button" data-transfer-copy="${h(valor)}" aria-label="Copiar ${nombre}">Copiar</button>` : ''}
        </dd></div>`).join('')}
    </dl><div class="transfer-status" role="status"></div>`;
}

function prepararCopiadoTransferencia(content) {
  for (const button of content.querySelectorAll('[data-transfer-copy]')) {
    button.onclick = async () => {
      const status = content.querySelector('.transfer-status');
      try {
        await navigator.clipboard.writeText(button.dataset.transferCopy);
        status.textContent = 'Copiado.';
      } catch {
        status.textContent = 'Podés seleccionar y copiar el dato manualmente.';
      }
    };
  }
}

async function mostrarTransferencia(codigo, version) {
  result(dialogBody, `<div data-transfer-content><h2 id="dialog-title">Pago por transferencia</h2>
    <p role="status">Cargando datos de pago…</p></div>`);
  const content = dialogBody.querySelector('[data-transfer-content]');
  dialog.showModal();
  dialog.addEventListener('close', () => {
    if (!dialog.open && content.isConnected) content.remove();
  }, { once: true });

  try {
    const pago = await api('/planes/' + codigo + '/transferencia');
    if (!dialog.open || !content.isConnected || version !== routeVersion) return;
    result(content, `<h2 id="dialog-title">Pago por transferencia</h2>
      <p class="muted">${planNames[codigo]} · Pesos argentinos</p>
      <strong class="value">${h(precioPlan(pago.importe_ars))}</strong>
      ${datosTransferenciaHTML(pago)}
      <p class="muted">Guardá el comprobante para coordinar la confirmación con Alquilómetro.
        Informá el pago desde la tarjeta de ${planNames[codigo]}.</p>`);
    prepararCopiadoTransferencia(content);
  } catch (error) {
    if (dialog.open && content.isConnected) {
      result(content, '<h2 id="dialog-title">Pago por transferencia</h2>' + note(error.message, 'error'));
    }
  }
}

function planPaymentActions(codigo, checkout) {
  return `<div class="actions plan-actions">
    ${checkout ? `<a class="btn" href="${h(checkout)}" target="_blank" rel="noopener noreferrer">Pagar con Mercado Pago ↗</a>` :
      '<button class="btn" type="button" disabled>Pagar con Mercado Pago</button>'}
    <button class="${checkout ? 'quiet' : 'btn'}" type="button" data-pay-plan="${codigo}"
      aria-label="Pagar por transferencia · ${planNames[codigo]}">Pagar por transferencia</button>
  </div>`;
}

function reportAgencyPayment(button) {
  result(dialogBody, `<h2 id="dialog-title">Informar pago de abono</h2>
    <p>Usá el número de operación que figura en el comprobante.</p>
    <form>
      ${input('Número de operación o referencia', 'referencia', 'required maxlength="100"')}
      ${submitButton('Informar pago')}
    </form>`);
  const form = dialogBody.querySelector('form');
  submit(form, async (data) => {
    await api('/planes/abono/pago', 'POST', { referencia: data.get('referencia').trim() });
    button.disabled = true;
    button.textContent = 'Pago pendiente de revisión';
    void refreshPaymentHistory();
    if (dialog.open && form.isConnected) {
      result(dialogBody, '<h2 id="dialog-title">Pago informado</h2>' +
        note('Recibimos la referencia. Tu abono quedará vigente cuando confirmemos el pago.'));
    }
  });
  dialog.showModal();
}

function sponsorshipListingOption(aviso) {
  const portada = aviso.fotos?.[0];
  const details = [aviso.propiedad.zona, metadata(aviso.propiedad)].filter(Boolean).join(' · ');
  return `<label class="sponsorship-option">
    ${portada ? `<img src="/api${h(portada.url)}" alt="" loading="lazy">` :
      '<span class="sponsorship-no-photo">Sin foto</span>'}
    <span class="sponsorship-option-info">
      <strong>${h(aviso.titulo)}</strong>
      <small>${h(details)}</small>
      <span class="sponsorship-option-price">${isSale(aviso) ? 'Venta' : 'Alquiler'} · ${h(money(askingPrice(aviso)))}</span>
      ${aviso.patrocinio_pendiente ? '<small class="sponsorship-option-pending">Pago pendiente de revisión</small>' : ''}
    </span>
    <input type="radio" name="aviso" value="${aviso.id}" required ${aviso.patrocinio_pendiente ? 'disabled' : ''}>
  </label>`;
}

async function reportSponsorship(version, precios) {
  const cupo = precios.cupo_avisos_activos;
  result(dialogBody, '<h2 id="dialog-title">Destacar un aviso</h2><p role="status">Cargando tus avisos…</p>');
  const loading = dialogBody.querySelector('[role="status"]');
  dialog.showModal();
  try {
    const avisos = await api('/publicaciones/mis');
    if (!dialog.open || !loading.isConnected || version !== routeVersion) return;
    const activos = avisos.filter((p) => p.estado === 'activa').slice(0, cupo);
    const puedeElegir = activos.some((aviso) => !aviso.patrocinio_pendiente);
    result(dialogBody, `<div class="sponsorship-report">
      <h2 id="dialog-title">Destacar un aviso</h2>
      <p class="muted">Acá aparecen hasta ${number(cupo)} avisos activos de tu abono.
        Si no encontrás el que buscás, activalo en <a href="#mis-publicaciones" class="sponsorship-manage-link">Mis publicaciones</a>.
        Si tu cupo está lleno, primero pausá otro aviso para liberar un lugar.</p>
      ${activos.length ? `<form id="sponsorship-report-form">
        <fieldset class="sponsorship-choices">
          <legend>Elegí el aviso que querés destacar</legend>
          <div class="sponsorship-options">${activos.map(sponsorshipListingOption).join('')}</div>
        </fieldset>
        ${puedeElegir ? `<button type="button" class="btn" id="sponsor-continue" disabled>Continuar al pago</button>
          <div id="sponsor-payment-step" hidden>
            <p id="sponsor-payment-summary"></p>
            ${planPaymentActions('patrocinio', precios.patrocinio_mercado_pago_url)}
            <div id="sponsor-transfer-details" aria-live="polite"></div>
            ${input('Número de operación o referencia', 'referencia', 'required maxlength="100" disabled')}
            ${submitButton('Informar pago')}
          </div>` : note('Todos tus avisos activos tienen un pago en revisión.')}
      </form>` : note('Todavía no tenés avisos activos para destacar.')}</div>`);
    dialogBody.querySelector('.sponsorship-manage-link').onclick = () => dialog.close();
    const form = dialogBody.querySelector('#sponsorship-report-form');
    if (!form || !puedeElegir) return;
    const continuar = form.querySelector('#sponsor-continue');
    const paso = form.querySelector('#sponsor-payment-step');
    const datos = form.querySelector('#sponsor-transfer-details');
    let avisoElegido;
    form.querySelector('fieldset').onchange = () => {
      continuar.disabled = !form.querySelector('input[name="aviso"]:checked');
    };
    continuar.onclick = () => {
      const elegido = form.querySelector('input[name="aviso"]:checked');
      avisoElegido = activos.find((aviso) => String(aviso.id) === elegido?.value);
      if (!avisoElegido) return;
      form.querySelector('fieldset').disabled = true;
      continuar.hidden = true;
      form.querySelector('#sponsor-payment-summary').textContent =
        `${avisoElegido.titulo} · ${precioPlan(precios.patrocinio_ars)} · ${precios.patrocinio_dias} días`;
      paso.hidden = false;
      form.elements.referencia.disabled = false;
      paso.querySelector('button:not(:disabled), a')?.focus();
    };
    paso.querySelector('[data-pay-plan]').onclick = async () => {
      result(datos, '<p role="status">Cargando datos…</p>');
      try {
        const pago = await api('/planes/patrocinio/transferencia');
        if (!datos.isConnected || !dialog.open) return;
        result(datos, datosTransferenciaHTML(pago));
        prepararCopiadoTransferencia(datos);
      } catch (error) {
        if (datos.isConnected) result(datos, note(error.message, 'error'));
      }
    };
    submit(form, async (data) => {
      if (!avisoElegido) return;
      await api('/planes/patrocinios/' + avisoElegido.id + '/pago', 'POST', {
        referencia: data.get('referencia').trim(),
      });
      void refreshPaymentHistory();
      if (dialog.open && form.isConnected) {
        result(dialogBody, '<h2 id="dialog-title">Pago informado</h2>' +
          note('El aviso quedó pendiente de revisión. El aviso se destaca cuando confirmemos el pago.'));
      }
    });
  } catch (error) {
    if (dialog.open && loading.isConnected && version === routeVersion) {
      result(dialogBody, '<h2 id="dialog-title">Informar pago de aviso destacado</h2>' + note(error.message, 'error'));
    }
  }
}

async function planesPage(version) {
  if (!canManageListings()) {
    result(main, `<div class="wrap content"><h1>Planes y pagos</h1>
      <div class="panel">${user ? note('Los planes requieren una cuenta de inmobiliaria o administradora.') :
        loginPrompt('Ingresá con tu cuenta de inmobiliaria o administradora para ver los planes.')}</div></div>`);
    return;
  }
  const [precios, historial] = await Promise.all([api('/planes'), api('/planes/pagos')]);
  if (version !== routeVersion) return;
  const avisosOcultos = precios.abono_ocultar_desde && fechaActualArgentina() >= precios.abono_ocultar_desde;
  result(main, `<div class="wrap content planes-page">
    <a class="back" href="#mis-publicaciones">Volver a Mis publicaciones</a>
    <header class="plans-header">
      <h1>Planes y pagos</h1>
      <p>Publicá las propiedades de tu inmobiliaria y dale más visibilidad a los avisos que quieras destacar.</p>
    </header>
    ${precios.modo_prueba ? note('Los importes son de prueba. El pago con Mercado Pago está deshabilitado.', 'warn') : ''}
    ${estadoDelAbono(precios)}
    <div class="pair plans-grid">
      <section class="panel plan-card plan-card-agency">
        <h2>${planNames.abono}</h2>
        <p class="plan-description">Tu cartera de alquileres y ventas, en un solo lugar.</p>
        <p class="plan-price"><strong class="value">${h(precioPlan(precios.abono_mensual_ars))}</strong> <small>por mes</small></p>
        <ul class="plan-benefits">
          <li><strong>Hasta ${number(precios.cupo_avisos_activos)} avisos activos</strong> de alquiler o venta.</li>
          <li>Editá precios, fotos y disponibilidad desde tu panel.</li>
          <li>Consultá las visitas y los clics a WhatsApp de cada aviso.</li>
        </ul>
        ${planPaymentActions('abono', precios.abono_mercado_pago_url)}
        ${user.rol === 'INMOBILIARIA' ? `<button class="quiet report-payment" id="report-agency-payment" type="button"
          ${precios.abono_pago_pendiente ? 'disabled' : ''}>
          ${precios.abono_pago_pendiente ? 'Pago pendiente de revisión' : 'Ya pagué · Informar pago'}
        </button>` : ''}
      </section>
      <section class="panel plan-card plan-card-sponsor">
        <h2>${planNames.patrocinio}</h2>
        <p class="plan-description">Dale un empujón a una propiedad puntual.</p>
        <p class="plan-price"><strong class="value">${h(precioPlan(precios.patrocinio_ars))}</strong> <small>por aviso</small></p>
        <ul class="plan-benefits">
          <li><strong>${number(precios.patrocinio_dias)} días como destacado</strong> para el aviso que elijas.</li>
          <li>Cartel verde ${sponsoredBadge} sobre la foto del aviso.</li>
          <li><strong>Aparecé entre los primeros resultados</strong> en las búsquedas que coincidan con tu aviso, con el orden predeterminado.</li>
        </ul>
        ${user.rol === 'INMOBILIARIA' ? (avisosOcultos
          ? note('Renová el abono para volver a mostrar tus avisos y poder destacarlos.', 'warn')
          : '<button class="btn report-payment" id="report-sponsorship" type="button">Elegir aviso y pagar</button>') : ''}
      </section>
    </div>
    <p class="plans-payment-note">La acreditación del pago se confirma manualmente.</p>
    <section class="panel" id="payment-history"><h2>Historial de pagos</h2>${historialPagos(historial)}</section>
  </div>`);
  for (const button of main.querySelectorAll('[data-pay-plan]')) {
    button.onclick = () => mostrarTransferencia(button.dataset.payPlan, version);
  }
  const report = main.querySelector('#report-sponsorship');
  if (report) report.onclick = () => reportSponsorship(version, precios);
  const reportAgency = main.querySelector('#report-agency-payment');
  if (reportAgency) reportAgency.onclick = () => reportAgencyPayment(reportAgency);
}

function accountPage(params) {
  if (!user) {
    result(main, `<div class="wrap content"><h1>Mi cuenta</h1>
      <section class="panel">${loginPrompt('Ingresá para ver tus datos.')}</section></div>`);
    return;
  }

  const agency = user.rol === 'INMOBILIARIA';
  result(main, `<div class="wrap content">
    <a class="back publication-control" href="${h(searchLink())}"><span class="publication-control-icon" aria-hidden="true">←</span>Volver a publicaciones</a>
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
  if (photos.some((photo) => photo.size > maxListingPhotoMB * 1024 * 1024)) {
    throw new Error(`Cada foto puede pesar hasta ${maxListingPhotoMB} MB.`);
  }
}

function setupPhotoPicker(form, alreadySaved = 0, initialPhotos = []) {
  const picker = form.querySelector('.photo-picker');
  const input = picker.querySelector('input');
  const count = picker.querySelector('.photo-picker-count');
  const error = picker.querySelector('.photo-picker-error');
  const list = picker.querySelector('.photo-previews');
  const selected = initialPhotos.map((file) => ({ file, url: URL.createObjectURL(file) }));
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

async function uploadPhotos(path, photos, { origin, order } = {}) {
  const data = new FormData();
  if (origin && order?.some(Boolean)) {
    data.append('origen_id', origin);
    order.forEach((id, index) => {
      data.append('orden', id);
      if (!id) data.append('fotos', photos[index]);
    });
  } else {
    for (const photo of photos) data.append('fotos', photo);
  }
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
    <summary class="publication-control"><span class="publication-control-icon" aria-hidden="true"></span>Administrar fotos</summary>
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
        <p class="muted"><small>JPG, PNG o WebP de hasta ${maxListingPhotoMB} MB cada una. Se optimizan al subirlas.</small></p>
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
  const zoomIn = panel.querySelector('[data-gallery-zoom="in"]');
  const zoomOut = panel.querySelector('[data-gallery-zoom="out"]');
  const count = panel.querySelector('#gallery-count');
  const arrows = panel.querySelectorAll('[data-gallery-step]');
  const thumbnails = panel.querySelector('#gallery-thumbs');
  let index = start;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  const pointers = new Map();
  let drag;
  let pinch;
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
    zoomIn.disabled = zoom === 3;
    zoomOut.disabled = zoom === 1;
  }

  function resetZoom() {
    zoom = 1;
    offsetX = offsetY = 0;
    pointers.clear();
    drag = pinch = undefined;
    image.classList.remove('panning');
    applyZoom();
  }

  function changeZoom(next, origin, target = origin) {
    zoom = Math.max(1, Math.min(3, next));
    const ratio = zoom / origin.zoom;
    offsetX = zoom === 1 ? 0 : target.x - (origin.x - origin.offsetX) * ratio;
    offsetY = zoom === 1 ? 0 : target.y - (origin.y - origin.offsetY) * ratio;
    applyZoom();
  }

  function zoomAt(next, x = 0, y = 0) {
    changeZoom(next, { x, y, zoom, offsetX, offsetY });
  }

  function pinchGeometry() {
    const [first, second] = pointers.values();
    const rect = frame.getBoundingClientRect();
    return {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      x: (first.x + second.x - rect.width) / 2 - rect.left,
      y: (first.y + second.y - rect.height) / 2 - rect.top,
    };
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
  zoomIn.onclick = () => zoomAt(zoom * 1.4);
  zoomOut.onclick = () => zoomAt(zoom / 1.4);
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
    if (event.key === '+' || event.key === '-') {
      event.preventDefault();
      zoomAt(event.key === '+' ? zoom * 1.4 : zoom / 1.4);
    }
  };
  image.onwheel = (event) => {
    if (event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
    const rect = frame.getBoundingClientRect();
    zoomAt(zoom * Math.exp(-event.deltaY * unit * .002),
      event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  };
  image.ondblclick = () => { if (zoom > 1) resetZoom(); };
  image.onpointerdown = (event) => {
    if (event.button !== 0 || pointers.size === 2) return;
    const touch = event.pointerType === 'touch';
    if (!touch && (zoom === 1 || pointers.size)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    image.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      pinch = { ...pinchGeometry(), zoom, offsetX, offsetY };
      drag = undefined;
    } else {
      drag = { ...point, offsetX, offsetY, swipe: touch && zoom === 1 };
    }
    image.classList.toggle('panning', zoom > 1 && Boolean(drag));
  };
  image.onpointermove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch) {
      const target = pinchGeometry();
      changeZoom(pinch.zoom * target.distance / pinch.distance, pinch, target);
    } else if (drag && zoom > 1) {
      offsetX = drag.offsetX + event.clientX - drag.x;
      offsetY = drag.offsetY + event.clientY - drag.y;
      applyZoom();
    }
  };

  function finishPointer(event) {
    if (!pointers.delete(event.pointerId)) return;
    const swipeDistance = drag?.swipe && event.type === 'pointerup' ? event.clientX - drag.x : 0;
    const verticalDistance = drag ? event.clientY - drag.y : 0;
    const [remaining] = pointers.values();
    // Después de un pellizco, el dedo que queda puede arrastrar sin cambiar de foto.
    drag = remaining ? { ...remaining, offsetX, offsetY, swipe: false } : undefined;
    pinch = undefined;
    image.classList.toggle('panning', Boolean(remaining) && zoom > 1);
    if (Math.abs(swipeDistance) > Math.max(36, Math.abs(verticalDistance))) {
      move(swipeDistance > 0 ? -1 : 1);
    }
  };
  image.onpointerup = finishPointer;
  image.onpointercancel = finishPointer;
  image.onlostpointercapture = finishPointer;
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
  if (listings.length) showListingCards(results, listings);
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

function carouselControls(viewportId, label) {
  return `<div class="carousel-controls" role="group" aria-label="${label}" hidden>
    <button type="button" data-carousel-prev aria-label="Propiedad anterior" aria-controls="${viewportId}"></button>
    <button type="button" data-carousel-next aria-label="Propiedad siguiente" aria-controls="${viewportId}"></button>
  </div>`;
}

function setupListingCarousel(panel, viewport, cards) {
  releaseListingCarousel?.();
  const previous = panel.querySelector('[data-carousel-prev]');
  const next = panel.querySelector('[data-carousel-next]');
  const controls = previous.parentElement;

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
  releaseListingCarousel = () => observer.disconnect();
  updateControls();
}

async function loadSimilarListings(current, panel) {
  try {
    const params = new URLSearchParams({ moneda: askingPrice(current).moneda, operacion: current.operacion });
    const listings = similarListings(current, await api('/publicaciones?' + params));
    if (!panel.isConnected || !listings.length) return;

    const viewport = panel.querySelector('.similar-listings');
    showListingCards(viewport, listings);
    panel.hidden = false;
    setupListingCarousel(panel, viewport, viewport.querySelector('.cards'));
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
      <summary class="publication-control"><span class="publication-control-icon" aria-hidden="true"></span><span data-description-label>${p.descripcion ? 'Editar descripción' : 'Agregar descripción'}</span></summary>
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

const reportReasons = {
  no_disponible: 'La propiedad ya no está disponible',
  precio: 'El precio es incorrecto',
  duplicado: 'El aviso está duplicado',
  otro: 'Otro motivo',
};

function availabilityText(confirmed) {
  const days = confirmed ? Math.round((Date.parse(fechaActualArgentina()) - Date.parse(confirmed)) / 86400000) : Infinity;
  if (days >= 14) return 'Disponibilidad por confirmar';
  if (days <= 0) return 'Disponibilidad confirmada hoy';
  return `Disponibilidad confirmada hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function openListingReport(listing) {
  if (!user) {
    openAccount();
    return;
  }
  result(dialogBody, `<h2 id="dialog-title">Reportar aviso</h2><p>${h(listing.titulo)}</p>
    <form id="listing-report-form">
      ${select('Motivo', 'motivo', [['', 'Elegí un motivo'], ...Object.entries(reportReasons)], 'required')}
      <label>Comentario (opcional)<textarea name="comentario" maxlength="500" rows="3"></textarea></label>
      ${submitButton('Enviar reporte')}
    </form>`);
  submit(dialogBody.querySelector('form'), async (data) => {
    await api(`/actividad/avisos/${listing.id}/reportes`, 'POST', Object.fromEntries(data));
    result(dialogBody, '<h2 id="dialog-title">Reporte enviado</h2><p>Gracias. El equipo de Alquilómetro lo va a revisar.</p>');
  });
  dialog.showModal();
}

function projectionPanel(listing) {
  const byIndex = listing.tipo_ajuste === 'INDICE';
  const title = '<h2>Simulá tu alquiler a 12 y 24 meses</h2>';
  if (!byIndex && listing.tipo_ajuste !== 'FIJO') {
    return `<section class="panel">${title}
      <p class="muted">Este aviso todavía no informa cómo se ajusta el alquiler.</p>
    </section>`;
  }

  return `<section class="panel">
    ${title}
    <p>Compará el costo de hoy con el estimado al cumplirse 12 y 24 meses.</p>
    <p class="muted">${byIndex
      ? `Usá el ritmo de ${h(listing.serie_codigo)} de los últimos 12 meses con datos o probá tu propia tasa.`
      : `La simulación aplica el ${h(pct(listing.tasa_ajuste))} informado cada vez que toca un ajuste.`}</p>
    <p class="muted">La simulación mantiene los gastos informados hoy. Si cargaste tu ingreso, usa ese mismo importe para comparar.</p>
    ${!user ? loginPrompt('Ingresá para simular el costo.') : `<form class="fields" id="projection">
      ${input('Frecuencia del ajuste (meses)', 'meses_periodicidad', 'type="number" min="1" max="24" value="6" required')}
      ${byIndex ? input('Variación mensual del índice (%)', 'tasa_mensual', 'type="number" min="0" step="any" placeholder="En blanco: usa el historial"') : ''}
      ${submitButton('Simular costo mensual')}</form>`}
  </section>`;
}

function projectionFormula(month, projection) {
  const formula = month.formula.replaceAll('monto_base', 'Alquiler inicial');
  const projectedDate = formula.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (projection.serie && projectedDate && month.ajustes_aplicados > 0) {
    const series = projection.serie;
    return `Alquiler inicial × (${series} estimado al ${date(projectedDate)} ÷ ${series} de referencia del ${date(projection.fecha_referencia)})`;
  }
  return formula.replace(/\b\d{4}-\d{2}-\d{2}\b/g, date);
}

function projectionResults(projection) {
  const months = projection.hoy ? [projection.hoy, ...projection.meses] : projection.meses;
  const scenario = projection.escenario;
  const historical = scenario?.origen === 'PROMEDIO_ULTIMOS_12_MESES';
  const interval = projection.meses_periodicidad;
  const firstAdjustment = scenario
    ? ((1 + Number(scenario.tasa_mensual_porcentual) / 100) ** interval - 1) * 100
    : null;
  const source = [projection.serie, projection.fuente_indice].filter(Boolean).join(' · ');
  return `<div class="projection-results">
    ${scenario ? `<div class="projection-scenario">
      <div class="projection-rate">
        <strong>${h(pct(scenario.tasa_mensual_porcentual))}</strong>
        <div><b>${historical ? 'Tasa mensual equivalente' : 'Tasa mensual elegida'}</b>
          ${historical ? '<small>Calculada con los últimos 12 meses del índice</small>' : ''}</div>
      </div>
      ${source ? `<div class="projection-source"><b>${h(source)}</b>
        <small>Último dato usado · ${h(date(projection.fecha_referencia))}</small></div>` : ''}
      <p class="projection-rate-timing">
        El alquiler se ajusta cada <strong>${h(interval)} ${interval === 1 ? 'mes' : 'meses'}</strong>.
        La tasa se acumula mes a mes y el primer ajuste se estima en <strong>${h(pct(firstAdjustment))}</strong>.
      </p>
    </div>` : ''}
    <p class="projection-estimate">Simulación orientativa. Lo que pagues puede variar según el ajuste del contrato y los gastos de ese momento.</p>
    <div class="projection-grid">
      ${months.map((month) => `<article class="projection-month${month.mes === 0 ? ' projection-month-current' : ''}">
        <h3>${month.mes === 0 ? 'Hoy · Mes 0' : 'A ' + h(month.mes) + ' meses'}</h3>
        <p class="projection-month-adjustments">${month.ajustes_aplicados === 0
          ? 'Sin ajustes aplicados'
          : `${h(month.ajustes_aplicados)} ${month.ajustes_aplicados === 1 ? 'ajuste aplicado' : 'ajustes aplicados'}`}</p>
        <dl>
          <div class="projection-total"><dt>${month.mes === 0 ? 'Costo mensual con gastos' : 'Costo mensual estimado con gastos'}</dt>
            <dd>${h(money(month.costo_mensual))}</dd></div>
          <div class="projection-breakdown"><dt>${month.mes === 0 ? 'Alquiler publicado' : 'Alquiler estimado'}</dt>
            <dd>${h(money(month.alquiler))}</dd></div>
          ${month.porcentaje_ingreso != null ? `<div class="projection-breakdown">
            <dt>De tu ingreso de hoy</dt><dd>${h(pct(month.porcentaje_ingreso))}</dd></div>` : ''}
        </dl>
      </article>`).join('')}
    </div>
    ${missing(projection.faltantes)}
    <details class="projection-calculation">
      <summary class="publication-control">
        <span class="publication-control-icon" aria-hidden="true"></span>Ver cómo se calculó
      </summary>
      ${historical ? `<div class="projection-formula projection-history">
        <strong>De dónde sale el ${h(pct(scenario.tasa_mensual_porcentual))} mensual</strong>
        <p>Es la tasa que, aplicada 12 meses seguidos, da la misma variación que tuvo el índice en ese año.</p>
        <p class="projection-history-equation">[(Índice reciente ÷ Índice de hace 12 meses)<sup>1/12</sup> − 1] × 100</p>
      </div>` : ''}
      <div class="projection-grid">
        ${months.map((month) => `<div class="projection-formula">
          <strong>${month.mes === 0 ? 'Hoy · Mes 0' : 'A ' + h(month.mes) + ' meses'}</strong>
          <p>${h(projectionFormula(month, projection))}</p>
        </div>`).join('')}
      </div>
    </details>
  </div>`;
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
    <a class="back publication-control" href="${h(comparisonBack || publicationBackLink || (forSale && searchOperation !== 'venta' ? '#comprar' : searchLink()))}"><span class="publication-control-icon" aria-hidden="true">←</span>${comparisonBack ? 'Volver a la comparación' :
      publicationBackLink ? 'Volver a guardados' : 'Volver a publicaciones'}</a>
    <div class="detail-head">
      <div class="detail-title">
        <div class="listing-labels">
          <p class="eyebrow">${h(p.propiedad.zona)} · ${h(p.propiedad.tipo)}${forSale ? ' · En venta' : ''}</p>
          ${p.patrocinada ? sponsoredBadge : ''}
        </div>
        <h1>${h(p.titulo)}</h1>
        <p class="availability-label">${availabilityText(p.disponibilidad_confirmada)}</p>
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
    ${projectionPanel(p)}`}
    <section class="panel publisher-panel" id="publication-publisher" aria-label="Quién publica el aviso" hidden></section>
    <section class="similar-panel" id="publication-similar" aria-labelledby="similar-title" hidden>
      <h2 id="similar-title">Propiedades similares</h2>
      <div class="similar-carousel">
        <div class="similar-listings" id="similar-listings" tabindex="0" role="group" aria-label="Avisos recomendados"></div>
        ${carouselControls('similar-listings', 'Recorrer recomendaciones')}
      </div>
    </section>
    ${canManagePublication(p) ? '' : '<div class="report-link"><button class="text-action" id="report-listing" type="button">Reportar aviso</button></div>'}
    </div>${p.whatsapp_url ? '<div class="mobile-contact"><button type="button" class="btn detail-contact">Consultar por WhatsApp</button></div>' : ''}</div>`);
  setupPublicationPhotos(p, path);
  main.querySelector('#report-listing')?.addEventListener('click', () => openListingReport(p));
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
  for (const button of main.querySelectorAll('.detail-contact')) {
    button.onclick = () => openWhatsAppContact(p);
  }
  const descriptionForm = main.querySelector('#description-form');
  if (descriptionForm) submit(descriptionForm, async (data, output) => {
    const description = data.get('descripcion').trim();
    await api(path + '/descripcion', 'PATCH', { descripcion: description || null });
    if (!descriptionForm.isConnected) return;
    const panel = descriptionForm.closest('.publication-description');
    const copy = panel.querySelector('.description-copy');
    copy.textContent = description;
    copy.hidden = !description;
    panel.querySelector('[data-description-label]').textContent = description ? 'Editar descripción' : 'Agregar descripción';
    result(output, note('Descripción guardada.'));
  });
  const form = main.querySelector('#projection');
  if (form) submit(form, async (data, output) => {
    result(output, note('Calculando proyección…'));
    const projection = await api(path + '/proyeccion?' + query(data));
    result(output, projectionResults(projection));
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

function listingQuota({ activas, limite, guardadas, limite_guardadas }) {
  const full = limite !== null && activas >= limite;
  return `<section class="panel listing-quota" aria-label="Cupo de avisos">
    <div><h2>Cupo de avisos</h2>
      <p class="muted">${full ? 'Pausá o cerrá un aviso para publicar o reactivar otro.' :
        limite === null ? 'Podés administrar tus avisos desde esta página.' :
          'Lugares disponibles: ' + number(Math.max(0, limite - activas)) + '.'}</p></div>
    <div class="listing-quota-meters">
      <div class="listing-quota-use">
        <strong>${limite_guardadas === null ? `${number(guardadas)} guardados` : `${number(guardadas)} de ${number(limite_guardadas)} guardados`}</strong>
        ${limite_guardadas === null ? '' : `<progress value="${Math.min(guardadas, limite_guardadas)}" max="${limite_guardadas}" aria-label="Cupo de avisos guardados"></progress>`}
        ${limite_guardadas !== null && guardadas >= limite_guardadas ?
          '<small>Eliminá un aviso guardado para poder publicar otro.</small>' : ''}
      </div>
      <div class="listing-quota-use">
        <strong>${limite === null ? `${number(activas)} activos` : `${number(activas)} de ${number(limite)} activos`}</strong>
        ${limite === null ? '' : `<progress value="${Math.min(activas, limite)}" max="${limite}" aria-label="Cupo de avisos activos"></progress>`}
      </div>
    </div>
  </section>`;
}

function listingPlanRequired() {
  return `<section class="panel teal listing-plan-required">
    <h2>Activá tu abono para publicar</h2>
    <p>Cuando confirmemos tu pago, vas a poder publicar y reactivar avisos desde tu cuenta.</p>
    <a class="btn" href="#planes">Ver planes y pagos</a>
  </section>`;
}

async function withDrafts(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('alquilometro-borradores', 1);
    opening.onupgradeneeded = () => {
      const drafts = opening.result.createObjectStore('avisos', { keyPath: 'id' });
      drafts.createIndex('owner', 'owner');
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('avisos', mode);
      const request = operation(transaction.objectStore('avisos'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function renderDrafts(output, message = '') {
  const owner = user.id;
  try {
    const drafts = await withDrafts('readonly', (store) => store.index('owner').getAll(owner));
    if (!output.isConnected || user?.id !== owner) return;
    result(output, (message ? note(message) : '') + (drafts.length ? `<section class="panel draft-list"><h2>Borradores</h2>
      <p class="muted">Guardados en este navegador. Podés retomarlos cuando quieras.</p>
      <ul class="saved-search-list">${drafts.sort((a, b) => b.updated - a.updated).map((draft) => `
        <li><div><a class="quiet" href="#publicar?borrador=${h(draft.id)}">${h(draft.fields.titulo || 'Aviso sin título')}</a>
          <small>${h(draft.fields.zona || '')}</small></div>
          <button type="button" class="quiet draft-remove" data-delete-draft="${h(draft.id)}"
            aria-label="Eliminar borrador ${h(draft.fields.titulo || 'sin título')}">Eliminar borrador</button>
        </li>`).join('')}</ul><div data-draft-status></div></section>` : ''));
    output.onclick = async (event) => {
      const button = event.target.closest('[data-delete-draft]');
      const draft = drafts.find((item) => item.id === button?.dataset.deleteDraft);
      if (!draft || dialog.open) return;
      const accepted = await confirmAction('¿Eliminar este borrador?',
        `Se borrarán los datos y las fotos de <strong>${h(draft.fields.titulo || 'este aviso')}</strong> de este navegador.`,
        'Eliminar borrador', 'draft-delete-confirm');
      if (!accepted || !output.isConnected || user?.id !== owner) return;
      button.disabled = true;
      try {
        await withDrafts('readwrite', (store) => store.delete(draft.id));
        if (!output.isConnected || user?.id !== owner) return;
        await renderDrafts(output, 'Borrador eliminado.');
        (output.querySelector('a') || output).focus({ preventScroll: true });
      } catch {
        const status = output.querySelector('[data-draft-status]');
        if (status) result(status, note('No pudimos eliminar el borrador. Volvé a intentar.', 'error'));
      } finally {
        button.disabled = false;
      }
    };
  } catch {
    if (output.isConnected) result(output, note('No pudimos consultar los borradores de este navegador.', 'warn'));
  }
}

async function duplicateListing(id, owner) {
  const path = '/publicaciones/mis/' + id;
  const listing = await api(path);
  const photos = await Promise.allSettled(listing.fotos.map(async (photo, index) => {
    const response = await fetch('/api' + path + '/fotos/' + photo.id, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) throw new Error('No pudimos copiar la foto.');
    const blob = await response.blob();
    return {
      source: photo.id,
      file: new File([blob], 'Foto ' + (index + 1) + '.' + blob.type.split('/').at(-1), { type: blob.type }),
    };
  }));
  const copied = photos.filter((photo) => photo.status === 'fulfilled').map((photo) => photo.value);
  return {
    id: crypto.randomUUID(), owner, updated: Date.now(),
    fields: { ...listingFormFields(listing), titulo: (listing.titulo + ' (copia)').slice(0, 100) },
    photos: copied.map((photo) => photo.file),
    origin: listing.id,
    photoSources: copied.map((photo) => photo.source),
    missingPhotos: photos.some((photo) => photo.status === 'rejected'),
  };
}

async function newListing(version, params) {
  if (!canManageListings()) return publish();
  const owner = user.id;
  const quota = await api('/publicaciones/mis/cupo');
  if (version !== routeVersion) return;
  let draft;
  const draftId = params.get('borrador');
  const duplicateId = params.get('duplicar');
  if (draftId) {
    draft = await withDrafts('readonly', (store) => store.get(draftId));
    if (version !== routeVersion) return;
    if (draft?.owner !== owner) {
      result(main, `<div class="wrap content">${note('No encontramos este borrador en este navegador.', 'warn')}
        <a class="btn" href="#mis-publicaciones">Volver a Mis publicaciones</a></div>`);
      return;
    }
  } else if (duplicateId && /^\d+$/.test(duplicateId)) {
    draft = await duplicateListing(duplicateId, owner);
    if (version !== routeVersion || user?.id !== owner) return;
    await withDrafts('readwrite', (store) => store.put(draft));
    if (version !== routeVersion) return;
    history.replaceState(history.state, '', '#publicar?borrador=' + draft.id);
  }
  publish(null, false, { quota, draft });
}

function publicationSuggestions(p) {
  const suggestions = [];
  if (!p.fotos.length) suggestions.push('Foto de portada');
  if (!p.descripcion) suggestions.push('Descripción');
  if (!p.whatsapp_url) suggestions.push('WhatsApp de contacto');
  if (p.expensas_mensuales == null) suggestions.push('Expensas');
  if (!isSale(p) && p.abl_mensual == null) suggestions.push('ABL');
  return suggestions.length ? `<p class="listing-suggestions"><strong>Datos para completar</strong>
    <small>${h(suggestions.join(' · '))}</small></p>` : '';
}

function metricsSummary(stats) {
  return `<section class="panel listing-activity"><div class="section-head"><div>
    <h2>Rendimiento de los últimos 30 días</h2><small>Del ${date(stats.desde)} al ${date(stats.hasta)}</small></div></div>
    <div class="pair">${[['Avisos normales', stats.normales], ['Avisos destacados', stats.destacados]].map(([label, data]) => `
      <div><h3>${label}</h3><dl class="listing-metrics">
        <div><dt>Visitas</dt><dd>${number(data.visitas)}</dd></div>
        <div><dt>Clics a WhatsApp</dt><dd>${number(data.clics_whatsapp)}</dd></div>
      </dl></div>`).join('')}</div>
    <p class="muted">Cada visita o clic se cuenta según la visibilidad del aviso en ese momento. Un clic indica intención de contacto.</p>
  </section>`;
}

async function myListings(id, version, fromAdmin = false) {
  if (!canManageListings()) {
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
  const [listings, quota, stats] = await Promise.all([
    api(path), api(path + '/cupo'), api('/actividad/metricas').catch(() => null),
  ]);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content">
    <div class="section-head my-listings-head"><h1>Mis publicaciones</h1>
      <div class="actions">
        ${user.rol === 'INMOBILIARIA' ? '<a class="quiet" href="#planes">Planes y pagos</a>' : ''}
        <a class="btn" href="#publicar">Nueva publicación</a>
      </div>
    </div>
    ${quota.requiere_abono ? listingPlanRequired() : ''}
    <div id="listing-quota" aria-live="polite">${listingQuota(quota)}</div>
    ${stats ? metricsSummary(stats) : ''}
    <div id="managed-drafts" tabindex="-1"></div>
    ${listings.length ? `<form class="panel fields managed-filters" id="managed-filters" aria-label="Filtrar mis publicaciones">
      ${input('Buscar aviso', 'buscar', 'type="search" placeholder="Título o barrio"')}
      ${select('Operación', 'operacion', [['','Todas'], ['alquiler','Alquiler'], ['venta','Venta']])}
      ${select('Estado', 'estado', [['','Todos'], ['activa','Activo'], ['pausada','Pausado'], ['cerrada','Alquilado o vendido']])}
      ${select('Visibilidad', 'patrocinio', [['','Todos'], ['true','Destacado'], ['false','Normal']])}
      <button class="quiet" type="reset">Limpiar filtros</button>
    </form><p id="managed-filter-count" role="status"></p>` : ''}
    ${listings.length ? `<div class="section-head availability-toolbar">
      <small>Seleccioná avisos activos para confirmar varios juntos.</small>
      <button class="quiet" id="confirm-selected" type="button" disabled>Confirmar seleccionados</button>
      <div class="full" id="availability-feedback" role="status"></div>
    </div><p class="muted listing-metrics-hint">Las tarjetas muestran visitas y clics acumulados.</p>` : ''}
    ${listings.length ? `<div class="cards" id="managed-listings">${listings.map((p) => `<article class="card managed-listing"
      data-search="${h(p.titulo + ' ' + p.propiedad.zona)}" data-operation="${h(p.operacion)}" data-sponsored="${p.patrocinada}"
      ${quota.avisos_visibles ? '' : 'data-publicacion-oculta'}>
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
      ${publicationSuggestions(p)}
      <div class="managed-availability" ${p.estado === 'activa' ? '' : 'hidden'}>
        <p class="availability-label">${availabilityText(p.disponibilidad_confirmada)}</p>
        <div class="actions"><label><input type="checkbox" value="${p.id}" aria-label="Seleccionar ${h(p.titulo)}"> Seleccionar</label>
          <button class="text-action" type="button" data-confirm-availability="${p.id}">Sigue disponible</button></div>
      </div>
      <div class="managed-listing-actions">
        <a class="btn" href="#mis-publicaciones/${p.id}">Administrar aviso</a>
        <div class="managed-listing-secondary">
          <a href="#publicar?duplicar=${p.id}">Duplicar como borrador</a>
          <a href="#publicacion/${p.id}" data-public-listing ${p.estado === 'activa' && quota.avisos_visibles ? '' : 'hidden'}>Ver aviso</a>
        </div>
      </div>
      <div class="listing-status-message" aria-live="polite"></div>
    </article>`).join('')}</div>` : '<p class="empty">Todavía no tenés avisos publicados.</p>'}
  </div>`);
  void renderDrafts(main.querySelector('#managed-drafts'));
  const quotaPanel = main.querySelector('#listing-quota');
  const filtersForm = main.querySelector('#managed-filters');
  const cards = [...main.querySelectorAll('.managed-listing')];
  const count = main.querySelector('#managed-filter-count');
  const batch = main.querySelector('#confirm-selected');
  const feedback = main.querySelector('#availability-feedback');
  const managed = main.querySelector('#managed-listings');
  const selected = () => [...managed.querySelectorAll('.managed-availability input:checked')];
  let confirming = false;
  async function confirmAvailability(ids) {
    if (confirming || !ids.length) return;
    confirming = true;
    batch.disabled = true;
    try {
      await api('/actividad/disponibilidad', 'PATCH', { avisos: ids });
      for (const id of ids) {
        const panel = managed.querySelector(`[data-confirm-availability="${id}"]`).closest('.managed-availability');
        panel.querySelector('.availability-label').textContent = availabilityText(fechaActualArgentina());
        panel.querySelector('input').checked = false;
      }
      result(feedback, note(ids.length === 1 ? 'Disponibilidad confirmada.' : `Confirmaste ${number(ids.length)} avisos.`));
    } catch (error) {
      result(feedback, note(error.message, 'error'));
    } finally {
      confirming = false;
      batch.disabled = selected().length === 0;
    }
  }
  if (managed) {
    managed.addEventListener('change', () => { batch.disabled = confirming || selected().length === 0; });
    managed.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm-availability]');
      if (button) void confirmAvailability([Number(button.dataset.confirmAvailability)]);
    });
    batch.onclick = () => confirmAvailability(selected().map((input) => Number(input.value)));
  }
  function applyManagedFilters(values = new FormData(filtersForm)) {
    const normalize = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const search = normalize(values.get('buscar') || '');
    let visible = 0;
    for (const card of cards) {
      card.hidden = !normalize(card.dataset.search).includes(search) ||
        (values.get('operacion') && values.get('operacion') !== card.dataset.operation) ||
        (values.get('estado') && values.get('estado') !== card.querySelector('.listing-state').dataset.state) ||
        (values.get('patrocinio') && values.get('patrocinio') !== card.dataset.sponsored);
      if (!card.hidden) visible++;
    }
    count.textContent = visible ? `${number(visible)} de ${number(cards.length)} avisos` : 'No hay avisos con estos filtros.';
  }
  if (filtersForm) {
    filtersForm.oninput = () => applyManagedFilters();
    filtersForm.onsubmit = (event) => event.preventDefault();
    filtersForm.onreset = () => applyManagedFilters(new FormData());
    applyManagedFilters();
  }
  setupListingStateMenus(main, (previous, estado, card) => {
    quota.activas += Number(estado === 'activa') - Number(previous === 'activa');
    result(quotaPanel, listingQuota(quota));
    const panel = card.querySelector('.managed-availability');
    panel.hidden = estado !== 'activa';
    panel.querySelector('input').checked = false;
    panel.querySelector('.availability-label').textContent = availabilityText(null);
    batch.disabled = confirming || selected().length === 0;
    if (filtersForm) applyManagedFilters();
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
          estado !== 'activa' || card.hasAttribute('data-publicacion-oculta');
        onChanged(previous, estado, card);
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
      ['Cuentas', data.cuentas, 'admin-accounts'],
      ['Inmobiliarias', data.inmobiliarias.length, 'admin-agencies'],
      ['Avisos visibles', (counts.activa ?? 0) - data.avisos_ocultos, 'admin-publications', 'visible'],
      ['Pausados', counts.pausada ?? 0, 'admin-publications', 'pausada'],
      ['Alquilados o vendidos', counts.cerrada ?? 0, 'admin-publications', 'cerrada'],
    ].map(([title, value, section, status = '']) => `<button class="panel admin-metric-link" type="button"
      data-admin-section="${section}" data-status="${status}" aria-controls="${section}">
      <span class="metric"><small>${title}</small><strong class="value">${number(value)}</strong></span>
      <span class="admin-metric-arrow" aria-hidden="true">↗</span>
    </button>`).join('')}
  </div>`;
}

function adminAccountList({ cuentas, total, por_pagina }, page) {
  if (!cuentas.length) return '<p class="empty">No hay cuentas con estos filtros.</p>';
  return `<div class="table-wrap admin-table"><table>
    <thead><tr><th scope="col">Nombre</th><th scope="col">Correo</th>
      <th scope="col">Tipo de cuenta</th><th scope="col">Estado</th></tr></thead>
    <tbody>${cuentas.map((account) => `<tr>
      <td><strong>${h(account.nombre)}</strong></td><td>${h(account.email)}</td>
      <td>${h(roleNames[account.rol])}</td>
      <td>${account.habilitada ? 'Habilitada' : 'Suspendida'}</td>
    </tr>`).join('')}</tbody>
  </table></div>${adminPagination(total, por_pagina, page, 'cuentas')}`;
}

function adminPagination(total, pageSize, page, noun) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="admin-pagination actions">
    <small>${number(total)} ${noun} · Página ${page} de ${pages}</small>
    <button class="quiet" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Anterior</button>
    <button class="quiet" type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Siguiente</button>
  </div>`;
}

async function showPaymentAlerts(version) {
  let avisos;
  let resumen;
  try {
    [avisos, resumen] = await Promise.all([api('/admin/patrocinios'), api('/admin/resumen')]);
  } catch {
    return;
  }
  if (version !== routeVersion || dialog.open || user?.rol !== 'ADMIN') return;
  const vencimientos = avisos.filter((aviso) => aviso.aviso_vencimiento).length;
  const pendientes = avisos.filter((aviso) => aviso.pendiente).length;
  const abonos = resumen.inmobiliarias.filter((agencia) => agencia.abono_referencia_pendiente).length;
  const demorados = resumen.inmobiliarias.filter((agencia) => agencia.abono_revision_demorada).length;
  if (!vencimientos && !pendientes && !abonos) return;
  result(dialogBody, `<h2 id="dialog-title">Pagos y destacados por revisar</h2>
    ${abonos ? `<p>Pagos de abono por confirmar: <strong>${number(abonos)}</strong>.</p>` : ''}
    ${demorados ? note(`${number(demorados)} abonos llevan dos días o más en revisión.`, 'warn') : ''}
    ${pendientes ? `<p>Pagos de avisos destacados por confirmar: <strong>${number(pendientes)}</strong>.</p>` : ''}
    ${vencimientos ? `<p>Destacados que vencen hoy o ya vencieron: <strong>${number(vencimientos)}</strong>.</p>` : ''}
    <a class="btn" href="#admin">Ir al panel</a>`);
  dialogBody.querySelector('a').onclick = () => {
    dialog.close();
    main.querySelector(abonos ? '#admin-agencies' : '#admin-sponsorships')?.scrollIntoView({block: 'start'});
  };
  dialog.showModal();
}

function adminSponsorships(avisos) {
  const pendientes = avisos.filter((aviso) => aviso.pendiente);
  const conPeriodo = avisos.filter((aviso) => aviso.hasta);
  if (!avisos.length) return '<p class="muted">Todavía no hay pagos informados ni destacados con fecha.</p>';
  const descripcion = (aviso) => `<strong>#${aviso.id} · ${h(aviso.titulo)}</strong><small>${h(aviso.inmobiliaria)}</small>`;
  return `
    ${pendientes.length ? `<h3>Pagos por confirmar</h3><div class="admin-sponsorship-list">
      ${pendientes.map((aviso) => `<div class="admin-sponsorship-row">
        <div>${descripcion(aviso)}<small>Operación ${h(aviso.referencia)}</small></div>
        <div class="actions">
          <button class="btn" type="button" data-confirm-sponsorship="${aviso.id}">Confirmar pago</button>
          <button class="quiet" type="button" data-reject-sponsorship="${aviso.id}">Pedir corrección</button>
        </div>
      </div>`).join('')}</div>` : ''}
    ${conPeriodo.length ? `<h3>Fechas y vencimientos</h3><div class="admin-sponsorship-list">
      ${conPeriodo.map((aviso) => `<div class="admin-sponsorship-row">
        <div>${descripcion(aviso)}<small>Del ${h(date(aviso.desde))} al ${h(date(aviso.hasta))}</small></div>
        <div class="actions">
          ${aviso.aviso_vencimiento ? `<span class="agency-status sponsorship-due">${aviso.vencido ? 'Vencido' : 'Vence hoy'}</span>
            <button class="quiet" type="button" data-sponsorship-seen="${aviso.id}">Marcar como visto</button>` : ''}
          ${!aviso.vencido ? `<button class="quiet sponsorship-stop" type="button"
            data-sponsorship-stop="${aviso.id}">Quitar destacado</button>` : ''}
        </div>
      </div>`).join('')}</div>` : ''}`;
}

function fechaActualArgentina() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('/').reverse().join('-');
}

function abonoHasta(fechaPago) {
  const fecha = new Date(fechaPago + 'T00:00:00Z');
  const diaPago = fecha.getUTCDate();
  fecha.setUTCMonth(fecha.getUTCMonth() + 2, 0);
  fecha.setUTCDate(Math.min(diaPago, fecha.getUTCDate()));
  return fecha.toISOString().slice(0, 10);
}

function adminAgencyList(agencies) {
  if (!agencies.length) return '<p class="empty">Todavía no hay inmobiliarias.</p>';
  return `<div class="table-wrap admin-table">
    <table>
      <thead><tr><th scope="col">Inmobiliaria</th><th scope="col">Estado</th>
        <th scope="col">Cupo</th><th scope="col">Abono</th><th scope="col">Acciones</th></tr></thead>
      <tbody>${agencies.map((agency) => `<tr>
        <td><strong>${h(agency.nombre)}</strong><small>${h(agency.email)}</small></td>
        <td><span class="agency-status ${agency.habilitada ? '' : 'suspended'}">
          ${agency.habilitada ? 'Habilitada' : 'Suspendida'}
        </span></td>
        <td>${number(agency.activas)} de ${number(agency.limite)}</td>
        <td>${agency.abono_pagado_el ? `<small>Pagó el ${h(date(agency.abono_pagado_el))}</small>` : ''}
          ${agency.abono_vigente_hasta ? `<small>Hasta el ${h(date(agency.abono_vigente_hasta))}</small>` : ''}
          ${agency.abono_referencia_pendiente ? `<span class="agency-status payment-pending">${agency.abono_revision_demorada ? 'Revisión demorada' : 'Pago por confirmar'}</span>
            <small>Operación ${h(agency.abono_referencia_pendiente)}</small>` :
            agency.abono_vigente_hasta ? '' : '<small>Sin pago registrado</small>'}
          <button class="quiet" type="button" data-agency-abono="${agency.id}" data-name="${h(agency.nombre)}"
            data-until="${h(agency.abono_vigente_hasta)}"
            data-reference="${h(agency.abono_referencia_pendiente)}">
            ${agency.abono_referencia_pendiente ? 'Confirmar pago' : 'Editar abono'}
          </button>
          ${agency.abono_referencia_pendiente ? `<button class="quiet" type="button"
            data-reject-abono="${agency.id}" data-reference="${h(agency.abono_referencia_pendiente)}">Pedir corrección</button>` : ''}
          <button class="quiet" type="button" data-agency-history="${agency.id}" data-name="${h(agency.nombre)}">Historial</button></td>
        <td><button class="quiet" type="button" data-agency="${agency.id}"
          data-enable="${!agency.habilitada}" data-name="${h(agency.nombre)}"
          aria-label="${agency.habilitada ? 'Suspender' : 'Reactivar'} ${h(agency.nombre)}">
          ${agency.habilitada ? 'Suspender' : 'Reactivar'}
        </button></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function confirmAction(title, description, action, buttonClass = '') {
  result(dialogBody, `<h2 id="dialog-title">${h(title)}</h2>
    <p>${description}</p>
    <form method="dialog">
      <div class="actions">
        <button type="submit" class="quiet" value="cancelar" autofocus>Cancelar</button>
        <button type="submit" class="btn ${h(buttonClass)}" value="confirmar">${h(action)}</button>
      </div>
    </form>`);
  dialog.returnValue = '';
  const decision = new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirmar'), { once: true });
  });
  dialog.showModal();
  return decision;
}

function pedirCorreccionPago(path, referencia, alGuardar) {
  result(dialogBody, `<h2 id="dialog-title">Pedir corrección del pago</h2>
    <p>La inmobiliaria verá el motivo en su historial y podrá volver a informar el pago.</p>
    <form><label>Motivo de la corrección<textarea name="motivo" required maxlength="500"></textarea></label>
      ${submitButton('Pedir corrección')}
    </form>`);
  const form = dialogBody.querySelector('form');
  submit(form, async (data) => {
    await api(path, 'PATCH', { referencia, motivo: data.get('motivo').trim() });
    if (form.isConnected && dialog.open) dialog.close();
    await alGuardar();
  });
  dialog.showModal();
}

function confirmAgencySuspension(name) {
  return confirmAction('Suspender inmobiliaria',
    `<strong>${h(name)}</strong> perderá el acceso. Sus avisos quedarán ocultos hasta que reactives la cuenta.`,
    'Suspender');
}

function adminResults({ avisos, total, por_pagina }, page) {
  if (!avisos.length) return '<p class="empty">No hay avisos con estos filtros.</p>';
  return `<div class="table-wrap admin-table">
    <table>
      <thead><tr>${['Aviso', 'Anunciante', 'Precio', 'Estado', 'Visibilidad', 'Visitas', 'Clics WhatsApp', 'Acciones']
        .map((title) => `<th scope="col">${title}</th>`).join('')}</tr></thead>
      <tbody>${avisos.map((p) => `<tr ${p.anunciante_visible ? '' : 'data-publicacion-oculta'}>
        <td><strong>${h(p.titulo)}</strong><small>${h(p.zona)} · ${isSale(p) ? 'Venta' : 'Alquiler'}</small></td>
        <td>${h(p.anunciante)}${p.anunciante_visible ? '' : `<small>${p.anunciante_habilitado ? 'Abono vencido' : 'Cuenta suspendida'}</small>`}</td>
        <td class="money">${h(money(p.precio))}</td>
        <td>${listingStateMenu(p)}<div class="listing-status-message" aria-live="polite"></div></td>
        <td>
          <span class="listing-state listing-sponsorship" data-sponsored="${p.patrocinada}">
            <select data-listing-sponsorship="${p.id}" aria-label="Visibilidad de ${h(p.titulo)}">
              <option value="false" ${p.patrocinada ? '' : 'selected'}>Normal</option>
              <option value="true" ${p.patrocinada ? 'selected' : ''}>Destacado</option>
            </select>
          </span>
          <div class="sponsorship-message" role="status"></div>
        </td>
        <td>${number(p.visitas)}</td><td>${number(p.clics_whatsapp)}</td>
        <td><div class="admin-row-actions">
          <a class="quiet" href="#mis-publicaciones/${p.id}?origen=admin">Editar aviso</a>
          <a href="#publicacion/${p.id}" data-public-listing ${p.estado === 'activa' && p.anunciante_visible ? '' : 'hidden'}>Ver aviso</a>
        </div></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  ${adminPagination(total, por_pagina, page, 'avisos')}`;
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

async function loadAdminReports(panel) {
  try {
    const reports = await api('/admin/reportes');
    if (!panel.isConnected) return;
    result(panel, reports.length ? `<ul class="activity-list">${reports.map((report) => `<li>
      <div><strong>${h(reportReasons[report.motivo])}</strong>
        <p>${report.publicacion_id ? `<a href="#mis-publicaciones/${report.publicacion_id}?origen=admin">${h(report.titulo)}</a>` : h(report.titulo)} · ${date(report.fecha)}</p>
        ${report.comentario ? `<p>${h(report.comentario)}</p>` : ''}</div>
      <button class="quiet" type="button" data-review-report="${report.id}">Marcar revisado</button>
    </li>`).join('')}</ul><div role="status"></div>` : '<p class="muted">No hay reportes pendientes.</p>');
  } catch (error) {
    if (panel.isConnected) result(panel, note(error.message, 'error'));
  }
}

async function adminPage(version) {
  if (user?.rol !== 'ADMIN') {
    result(main, `<div class="wrap content"><h1>Panel de administración</h1>
      <div class="panel">${user ? note('Este panel es exclusivo para administradores.') :
        loginPrompt('Ingresá con tu cuenta administradora.')}</div></div>`);
    return;
  }
  const [overview, listings, patrocinios] = await Promise.all([
    api('/admin/resumen'), api('/admin/publicaciones'), api('/admin/patrocinios'),
  ]);
  if (version !== routeVersion) return;
  result(main, `<div class="wrap content admin-page">
    <h1>Panel de administración</h1>
    <div id="admin-overview">${adminOverview(overview)}</div>
    <div id="admin-message" aria-live="polite"></div>
    <section class="panel listing-activity" aria-labelledby="reports-title">
      <h2 id="reports-title">Reportes de avisos</h2>
      <div id="admin-reports" aria-live="polite">Cargando…</div>
    </section>
    <section class="panel admin-sponsorships" id="admin-sponsorships">
      <h2>Destacados</h2>
      <div id="admin-sponsorship-message" aria-live="polite"></div>
      <div id="admin-sponsorship-list">${adminSponsorships(patrocinios)}</div>
    </section>
    <section class="panel admin-agencies" id="admin-agencies" tabindex="-1" aria-labelledby="admin-agencies-title"><h2 id="admin-agencies-title">Inmobiliarias</h2>
      <details class="admin-agency-create">
        <summary>
          <span class="admin-agency-icon" aria-hidden="true"></span>
          <span class="admin-agency-label">
            <strong>Dar de alta inmobiliaria</strong>
            <small>Configurá su correo de acceso y contraseña inicial.</small>
          </span>
        </summary>
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
    <section class="panel" id="admin-publications" tabindex="-1" aria-labelledby="admin-publications-title"><h2 id="admin-publications-title">Publicaciones</h2>
      <form class="fields admin-filters" id="admin-filters">
        ${input('Buscar aviso', 'buscar', 'type="search" maxlength="100" placeholder="Título, barrio o anunciante"')}
        ${select('Estado', 'estado', [['', 'Todos'], ['visible', 'Visible'], ['activa', 'Activa'], ['pausada', 'Pausada'], ['cerrada', 'Alquilada o vendida']])}
        ${select('Operación', 'operacion', [['', 'Todas'], ['alquiler', 'Alquiler'], ['venta', 'Venta']])}
        <div class="actions"><button type="submit" class="btn">Aplicar filtros</button></div>
      </form>
      <div id="admin-results"></div>
    </section>
    <section class="panel admin-accounts" id="admin-accounts" tabindex="-1" aria-labelledby="admin-accounts-title">
      <h2 id="admin-accounts-title">Cuentas</h2>
      <form class="fields admin-filters" id="admin-account-filters">
        ${select('Tipo de cuenta', 'rol', [['', 'Todos'], ...Object.entries(roleNames)])}
        ${select('Estado de la cuenta', 'habilitada', [['', 'Todos'], ['true', 'Habilitada'], ['false', 'Suspendida']])}
        <button class="quiet" type="reset">Limpiar filtros</button>
      </form>
      <div id="admin-account-list" aria-live="polite"></div>
    </section>
  </div>`);
  const form = main.querySelector('#admin-filters');
  const reports = main.querySelector('#admin-reports');
  void loadAdminReports(reports);
  reports.onclick = async (event) => {
    const button = event.target.closest('[data-review-report]');
    if (!button) return;
    button.disabled = true;
    try {
      await api('/admin/reportes/' + button.dataset.reviewReport, 'PATCH');
      if (reports.isConnected) await loadAdminReports(reports);
    } catch (error) {
      result(reports.querySelector('[role="status"]'), note(error.message, 'error'));
      button.disabled = false;
    }
  };
  const output = main.querySelector('#admin-results');
  const overviewPanel = main.querySelector('#admin-overview');
  const message = main.querySelector('#admin-message');
  const agencyList = main.querySelector('#admin-agency-list');
  const agencyMessage = main.querySelector('#admin-agency-message');
  const agencyForm = main.querySelector('#admin-agency-form');
  const sponsorList = main.querySelector('#admin-sponsorship-list');
  const sponsorMessage = main.querySelector('#admin-sponsorship-message');
  let sponsorRows = patrocinios;
  let request = 0;
  let overviewRequest = 0;
  let applied = new URLSearchParams();
  const accountList = main.querySelector('#admin-account-list');
  const accountForm = main.querySelector('#admin-account-filters');
  let accountPage = 1;
  let accountRequest = 0;

  async function loadAccounts(page = 1, params = query(new FormData(accountForm))) {
    const revision = ++accountRequest;
    params.set('pagina', page);
    accountList.setAttribute('aria-busy', 'true');
    try {
      const accounts = await api('/admin/cuentas?' + params);
      if (version !== routeVersion || revision !== accountRequest) return;
      const pages = Math.max(1, Math.ceil(accounts.total / accounts.por_pagina));
      if (page > pages) return loadAccounts(pages, params);
      accountPage = page;
      result(accountList, adminAccountList(accounts, page));
    } catch (error) {
      if (version === routeVersion && revision === accountRequest) {
        result(accountList, note(error.message, 'error'));
      }
    } finally {
      if (revision === accountRequest) accountList.removeAttribute('aria-busy');
    }
  }
  accountForm.onchange = () => void loadAccounts();
  accountForm.onreset = () => void loadAccounts(1, new URLSearchParams());
  accountList.onclick = (event) => {
    const button = event.target.closest('[data-page]');
    if (button) void loadAccounts(Number(button.dataset.page));
  };
  result(accountList, '<p role="status">Cargando cuentas…</p>');
  void loadAccounts();

  overviewPanel.onclick = (event) => {
    const button = event.target.closest('[data-admin-section]');
    if (!button) return;
    const section = document.getElementById(button.dataset.adminSection);
    section.hidden = false;
    section.focus({ preventScroll: true });
    section.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
    if (button.dataset.status) {
      form.reset();
      form.elements.estado.value = button.dataset.status;
      form.requestSubmit();
    }
  };

  async function updateSponsorships() {
    sponsorRows = await api('/admin/patrocinios');
    if (version === routeVersion) result(sponsorList, adminSponsorships(sponsorRows));
  }
  sponsorList.onclick = async (event) => {
    const rechazar = event.target.closest('[data-reject-sponsorship]');
    if (rechazar) {
      const aviso = sponsorRows.find((row) => row.id === Number(rechazar.dataset.rejectSponsorship));
      pedirCorreccionPago('/admin/patrocinios/' + aviso.id + '/rechazar', aviso.referencia, async () => {
        await updateSponsorships();
        result(sponsorMessage, note('Corrección solicitada.'));
      });
      return;
    }
    const confirm = event.target.closest('[data-confirm-sponsorship]');
    if (confirm) {
      const aviso = sponsorRows.find((row) => row.id === Number(confirm.dataset.confirmSponsorship));
      const hoy = fechaActualArgentina();
      const renovar = aviso.hasta && aviso.hasta >= hoy;
      result(dialogBody, `<h2 id="dialog-title">Confirmar pago del destacado</h2>
        <p><strong>${h(aviso.titulo)}</strong> · ${h(aviso.inmobiliaria)}</p>
        <p>Verificá la operación ${h(aviso.referencia)} antes de confirmar el pago.</p>
        <form id="confirm-sponsor-form">
          ${camposConciliacion(aviso.referencia)}
          ${input('Fecha de acreditación', 'pagado_el', `type="date" required max="${h(hoy)}" value="${h(hoy)}"`)}
          ${renovar ? '<p class="muted">Los 30 días nuevos se suman al período ya pago.</p>' :
            input('Fecha de inicio', 'desde', 'type="date" required max="9999-12-02"')}
          <p id="sponsor-end-preview" class="notice" role="status">Elegí la fecha de inicio para calcular el vencimiento.</p>
          ${submitButton('Confirmar y guardar')}
        </form>`);
      const form = dialogBody.querySelector('#confirm-sponsor-form');
      const desde = form.elements.desde;
      const preview = form.querySelector('#sponsor-end-preview');
      const updatePreview = () => {
        if (!renovar && (!desde.value || !desde.validity.valid)) {
          preview.textContent = 'Elegí la fecha de inicio para calcular el vencimiento.';
          return;
        }
        const fin = new Date((renovar ? aviso.hasta : desde.value) + 'T00:00:00Z');
        fin.setUTCDate(fin.getUTCDate() + aviso.duracion_dias - (renovar ? 0 : 1));
        preview.textContent = 'Vigente hasta el ' + date(fin.toISOString().slice(0, 10));
      };
      if (desde) {
        desde.value = hoy;
        desde.oninput = updatePreview;
      }
      updatePreview();
      submit(form, async (data) => {
        await api('/admin/patrocinios/' + aviso.id + '/confirmar', 'PATCH', {
          desde: data.get('desde') || hoy,
          referencia: aviso.referencia,
          pagado_el: data.get('pagado_el'),
          conciliacion: datosConciliacion(data),
        });
        if (form.isConnected && dialog.open) dialog.close();
        result(sponsorMessage, note('Destacado confirmado.'));
        await updateSponsorships();
        await loadResults(1);
      });
      dialog.showModal();
      return;
    }
    const action = event.target.closest('[data-sponsorship-seen], [data-sponsorship-stop]');
    if (!action || action.disabled) return;
    const stop = action.dataset.sponsorshipStop;
    if (stop) {
      const aviso = sponsorRows.find((row) => row.id === Number(stop));
      const aceptar = await confirmAction('Quitar destacado',
        `<strong>${h(aviso.titulo)}</strong> volverá a su visibilidad habitual de inmediato.`,
        'Quitar destacado');
      if (!aceptar || !action.isConnected) return;
    }
    action.disabled = true;
    try {
      if (stop) {
        await api('/admin/publicaciones/' + stop + '/patrocinio', 'PATCH', { patrocinada: false });
      } else {
        await api('/admin/patrocinios/' + action.dataset.sponsorshipSeen + '/vencimiento-visto', 'PATCH');
      }
      await updateSponsorships();
      if (stop) await loadResults(1);
      result(sponsorMessage, note(stop ? 'Aviso destacado desactivado.' : 'Vencimiento marcado como visto.'));
    } catch (error) {
      result(sponsorMessage, note(error.message, 'error'));
    } finally {
      action.disabled = false;
    }
  };

  async function updateOverview(agencyId) {
    const revision = ++overviewRequest;
    try {
      const overview = await api('/admin/resumen');
      if (version !== routeVersion || revision !== overviewRequest) return;
      result(overviewPanel, adminOverview(overview));
      result(agencyList, adminAgencyList(overview.inmobiliarias));
      void loadAccounts(accountPage);
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
    const rechazar = event.target.closest('[data-reject-abono]');
    if (rechazar) {
      pedirCorreccionPago('/admin/inmobiliarias/' + rechazar.dataset.rejectAbono + '/abono/rechazar',
        rechazar.dataset.reference, async () => {
          await updateOverview();
          result(agencyMessage, note('Corrección solicitada.'));
        });
      return;
    }
    const historial = event.target.closest('[data-agency-history]');
    if (historial) {
      result(dialogBody, `<h2 id="dialog-title">Pagos de ${h(historial.dataset.name)}</h2><div id="agency-payment-history" role="status">Cargando…</div>`);
      const output = dialogBody.querySelector('#agency-payment-history');
      dialog.showModal();
      try {
        const pagos = await api('/admin/inmobiliarias/' + historial.dataset.agencyHistory + '/pagos');
        if (output.isConnected && dialog.open) result(output, historialPagos(pagos));
      } catch (error) {
        if (output.isConnected && dialog.open) result(output, note(error.message, 'error'));
      }
      return;
    }
    const abono = event.target.closest('[data-agency-abono]');
    if (abono) {
      const fechaPago = fechaActualArgentina();
      result(dialogBody, `<h2 id="dialog-title">Abono de ${h(abono.dataset.name)}</h2>
        ${abono.dataset.reference ? `<p>Verificá la operación <strong>${h(abono.dataset.reference)}</strong> antes de confirmar.</p>` : ''}
        <p>El abono dura un mes calendario desde la fecha de pago.</p>
        <form id="admin-abono-form">
          ${abono.dataset.reference ? camposConciliacion(abono.dataset.reference) : ''}
          ${input('Fecha de pago', 'pagado_el', `type="date" required min="0001-01-01" max="9999-11-30" value="${h(fechaPago)}"`)}
          <p class="notice" id="abono-preview" role="status"></p>
          <div class="actions">
            <button class="btn" type="submit">${abono.dataset.reference ? 'Confirmar pago' : 'Guardar abono'}</button>
            ${abono.dataset.until ? '<button class="quiet" type="submit" value="quitar" formnovalidate>Quitar vigencia</button>' : ''}
          </div>
          ${abono.dataset.until ? '<small>Quitar la vigencia oculta los avisos y conserva el plazo de eliminación si ya estaba en curso.</small>' : ''}
          <div data-output aria-live="polite"></div>
        </form>`);
      const abonoForm = dialogBody.querySelector('#admin-abono-form');
      const pago = abonoForm.elements.pagado_el;
      const preview = abonoForm.querySelector('#abono-preview');
      const updatePreview = () => {
        const periodo = abono.dataset.reference && abono.dataset.until > pago.value
          ? abono.dataset.until : pago.value;
        const hasta = pago.value && pago.validity.valid ? abonoHasta(periodo) : abono.dataset.until;
        preview.textContent = hasta ? 'Vigente hasta el ' + date(hasta) : 'Elegí la fecha de pago para calcular el vencimiento.';
      };
      pago.oninput = updatePreview;
      updatePreview();
      submit(abonoForm, async (data, _output, action) => {
        const quitar = action?.value === 'quitar';
        await api('/admin/inmobiliarias/' + abono.dataset.agencyAbono + '/abono', 'PATCH',
          { pagado_el: quitar ? null : data.get('pagado_el'),
            referencia: quitar ? null : (abono.dataset.reference || null),
            conciliacion: !quitar && abono.dataset.reference ? datosConciliacion(data) : null });
        if (abonoForm.isConnected && dialog.open) dialog.close();
        result(agencyMessage, note('Vigencia del abono actualizada.'));
        await updateOverview();
      });
      dialog.showModal();
      return;
    }
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
    ${p.publicador_habilitado && !p.publicador_avisos_visibles ? note('El abono venció. El aviso se mantiene oculto hasta que se confirme la renovación.', 'warn') : ''}
    <form id="managed-state-form">
      ${select('Estado del aviso', 'estado', Object.entries(listingStates(p)))}
      <p class="muted"><small>Solo los avisos activos aparecen en la búsqueda y se pueden abrir desde un enlace público.</small></p>
      ${submitButton('Guardar estado')}
    </form>
    <div class="listing-delete-section">
      <button type="button" class="quiet draft-remove" id="delete-managed-listing">Eliminar aviso</button>
      <div id="delete-managed-status" aria-live="polite"></div>
    </div>
  </section>`;
}

function setupListingManagement(p, backLink) {
  const path = '/publicaciones/mis/' + p.id;
  const stateForm = main.querySelector('#managed-state-form');
  const publicLink = main.querySelector('#managed-public-link');
  const remove = main.querySelector('#delete-managed-listing');
  remove.onclick = async () => {
    if (dialog.open) return;
    const accepted = await confirmAction('¿Eliminar este aviso?',
      `Se borrará <strong>${h(p.titulo)}</strong>, se liberará su cupo y se eliminarán del servidor las fotos que solo usa este aviso. Las fotos compartidas seguirán disponibles en los otros avisos.`,
      'Eliminar aviso', 'draft-delete-confirm');
    if (!accepted || !remove.isConnected) return;
    remove.disabled = true;
    try {
      await api('/publicaciones/' + p.id, 'DELETE');
      if (remove.isConnected) location.hash = backLink;
    } catch (error) {
      const status = main.querySelector('#delete-managed-status');
      if (remove.isConnected && status) result(status, note(error.message, 'error'));
    } finally {
      remove.disabled = false;
    }
  };
  stateForm.elements.estado.value = p.estado;
  submit(stateForm, async (data, output) => {
    const estado = data.get('estado');
    await api(path + '/estado', 'PATCH', { estado });
    publicLink.hidden = estado !== 'activa' || !p.publicador_avisos_visibles;
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

function listingFormFields(p) {
  const price = askingPrice(p);
  return {
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
    whatsapp: p.whatsapp,
    descripcion: p.descripcion,
    ...Object.fromEntries(Object.keys(listingCostLabels).map((key) => [key, p[key]?.monto])),
  };
}

function fillListingForm(form, fields) {
  for (const [name, value] of Object.entries(fields)) {
    const control = form.elements.namedItem(name);
    if (!control || value == null) continue;
    if (control.tagName === 'SELECT' && !Array.from(control.options).some((item) => item.value === String(value))) {
      if (name === 'serie_codigo') continue;
      control.add(new Option(value, value));
    }
    if (control.type === 'checkbox') control.checked = value === true || value === 'on';
    else control.value = value;
  }
}

function previewDraft(form, photos) {
  const fields = form.elements;
  const cover = photos[0] ? URL.createObjectURL(photos[0]) : null;
  const price = fields.precio_publicado.value;
  const details = [
    fields.zona.value,
    fields.tipo.selectedOptions[0]?.textContent,
    !fields.ambientes.disabled && roomLabel(Number(fields.ambientes.value)),
    fields.metros_cuadrados.value && number(fields.metros_cuadrados.value) + ' m²',
  ].filter(Boolean);
  result(dialogBody, `<div class="draft-preview"><h2 id="dialog-title">Vista previa del aviso</h2>
    <article class="card">
      ${cover ? `<img class="draft-cover" src="${h(cover)}" alt="Foto de portada">
        <small>${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}</small>` : '<p class="muted">Sin foto de portada</p>'}
      <p class="eyebrow">${fields.operacion.value === 'venta' ? 'En venta' : 'En alquiler'}</p>
      <h3>${h(fields.titulo.value.trim() || 'Aviso sin título')}</h3>
      <p class="muted">${h(details.join(' · '))}</p>
      <p class="money">${price ? h(money({ monto: price, moneda: fields.moneda.value })) : 'Precio por completar'}</p>
      ${fields.descripcion.value ? `<p class="description-copy">${h(fields.descripcion.value)}</p>` : ''}
    </article><button class="quiet" type="button">Seguir editando</button></div>`);
  dialogBody.querySelector('.draft-preview button').onclick = () => dialog.close();
  if (cover) dialog.addEventListener('close', () => URL.revokeObjectURL(cover), { once: true });
  dialog.showModal();
}

function publish(listing = null, fromAdmin = false, { quota, draft } = {}) {
  if (!canManageListings()) {
    result(main, `<div class="wrap content"><h1>Nueva publicación</h1><div class="panel">
      ${user ? '<p>Esta operación está reservada a cuentas inmobiliarias y de administración.</p>' :
        loginPrompt('Ingresá con una cuenta inmobiliaria para publicar.')}
    </div></div>`);
    return;
  }

  const expensesOnlyForRent = Object.keys(listingCostLabels).filter((key) => !saleExpenseKeys.includes(key));
  const canSponsor = user?.rol === 'ADMIN';
  const backLink = fromAdmin ? '#admin' : '#mis-publicaciones';
  const noSpace = quota && (
    (quota.limite !== null && quota.activas >= quota.limite) ||
    (quota.limite_guardadas !== null && quota.guardadas >= quota.limite_guardadas)
  );
  const blocked = quota?.requiere_abono || noSpace;
  result(main, `<div class="wrap content"><a class="back" href="${backLink}">
      ${fromAdmin ? 'Volver al panel de administración' : 'Volver a Mis publicaciones'}
    </a>
    <div class="section-head my-listings-head"><h1>${listing ? 'Editar publicación' : draft ? 'Editar borrador' : 'Nueva publicación'}</h1>
      ${listing ? `<div class="actions">
        <a class="quiet" id="managed-public-link" href="#publicacion/${listing.id}"
          ${listing.estado === 'activa' && listing.publicador_avisos_visibles ? '' : 'hidden'}>Ver aviso público</a>
        <button type="submit" class="btn" form="publish-form" data-top-submit>Guardar cambios</button>
      </div>` : ''}
    </div>
    ${quota?.requiere_abono ? listingPlanRequired() : noSpace ? listingQuota(quota) : ''}
    ${draft?.missingPhotos ? note('Algunas fotos del aviso original no se pudieron copiar. Revisá la galería.', 'warn') : ''}
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
        ${indexFields(listing?.serie_codigo)}
        ${input('Tasa fija por ajuste (%)', 'tasa_ajuste', 'type="number" min="0" step="any"')}
      </div></section>
      <section class="panel"><h2>Contacto</h2>
        ${whatsappField(listing?.whatsapp ?? '')}
      </section>
      ${listing ? '' : `<section class="panel"><h2>Fotos de la propiedad</h2>
        <p class="muted">Hasta ${maxListingPhotos} fotos JPG, PNG o WebP de ${maxListingPhotoMB} MB cada una. Se optimizan al subirlas. La primera queda como portada.</p>
        ${photoInput()}
      </section>`}
      ${canSponsor ? `<section class="panel sponsor-setting">
        <label><input name="patrocinada" type="checkbox" ${listing?.patrocinada ? 'checked' : ''}>
          Mostrar como destacado</label>
        <small>Lleva el cartel Destacado, tiene prioridad en las búsquedas con el orden predeterminado y aparece en el carrusel de la portada.</small>
      </section>` : ''}
      ${listing ? submitButton('Guardar cambios') : `<div class="panel draft-actions">
        <p class="muted">Los borradores se guardan en este navegador y no ocupan cupo.</p>
        <div class="actions">
          <button class="quiet" type="button" id="save-draft">Guardar borrador</button>
          <button class="quiet" type="button" id="preview-draft">Vista previa</button>
          <button class="btn" type="submit" ${blocked ? 'disabled' : ''}>Publicar</button>
        </div>
        <div data-output aria-live="polite"></div>
      </div>`}
    </form>
    ${listing ? `<div class="stack listing-management">
      <div id="managed-photos"></div>${listingAvailability(listing)}
    </div>` : ''}
  </div>`);

  const form = main.querySelector('#publish-form');
  if (listing || draft) fillListingForm(form, draft?.fields ?? listingFormFields(listing));
  const getPhotos = listing ? () => [] : setupPhotoPicker(form, 0, draft?.photos);
  const sourcePhotos = new Map((draft?.photos ?? []).map((photo, index) => [photo, draft.photoSources?.[index]]));
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
  if (listing) setupListingManagement(listing, backLink);

  const draftButton = form.querySelector('#save-draft');
  let draftWrite;
  if (draftButton) {
    const owner = user.id;
    draftButton.onclick = async () => {
      draftButton.disabled = true;
      const output = form.querySelector('[data-output]');
      const fields = Object.fromEntries([...form.elements]
        .filter((field) => field.name && ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) && field.type !== 'file')
        .map((field) => [field.name, field.type === 'checkbox' ? field.checked : field.value]));
      try {
        const photos = getPhotos();
        const copy = {
          ...draft, id: draft?.id ?? crypto.randomUUID(), owner, updated: Date.now(), fields, photos,
          photoSources: photos.map((photo) => sourcePhotos.get(photo) || 0),
        };
        draftWrite = withDrafts('readwrite', (store) => store.put(copy));
        await draftWrite;
        draft = copy;
        if (!form.isConnected) return;
        history.replaceState(history.state, '', '#publicar?borrador=' + copy.id);
        result(output, note('Borrador guardado. Podés retomarlo desde Mis publicaciones.'));
      } catch {
        result(output, note('No pudimos guardar el borrador en este navegador.', 'error'));
      } finally {
        draftWrite = undefined;
        draftButton.disabled = false;
      }
    };
    form.querySelector('#preview-draft').onclick = () => previewDraft(form, getPhotos());
  }

  submit(form, async (data, output) => {
    if (blocked) return;
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
      serie_codigo: data.get('serie_codigo'),
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
    draftButton.disabled = true;
    if (draftWrite) await draftWrite.catch(() => {});
    draftButton.disabled = true;
    if (draft) {
      try { await withDrafts('readwrite', (store) => store.delete(draft.id)); }
      catch { /* El aviso ya se publicó y se puede administrar desde su ficha. */ }
    }
    if (photos.length) {
      result(output, note('Subiendo fotos…'));
      try {
        const path = '/publicaciones/' + publication.id;
        const order = photos.map((photo) => sourcePhotos.get(photo) || 0);
        try {
          await uploadPhotos(path, photos, { origin: draft?.origin, order });
        } catch (error) {
          if (error.status !== 404 || !order.some(Boolean)) throw error;
          await uploadPhotos(path, photos);
        }
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

async function contracts(version, registrar = false) {
  const title = registrar ? 'Nuevo contrato' : 'Mis contratos';
  if (!user) {
    result(main, `<div class="wrap content"><h1>${title}</h1><div class="panel">${loginPrompt('Ingresá para registrar un contrato o verificar un ajuste.')}</div></div>`);
    return;
  }
  const records = registrar ? [] : await api('/contratos');
  if (version !== routeVersion) return;
  const formHtml = `<form id="contract-form" class="fields">
      ${input('Fecha de inicio', 'fecha_inicio', 'type="date" required')}
      ${input('Duración (meses)', 'duracion_meses', 'type="number" min="1" max="120" value="12" required')}
      ${input('Alquiler inicial', 'monto', 'type="number" min="0.01" step="0.01" placeholder="500000" required')}
      ${select('Moneda', 'moneda', currency)}
      ${select('Tipo de ajuste', 'tipo_ajuste', [['INDICE','Por índice'], ['FIJO','Porcentaje fijo']])}
      ${input('Ajuste cada (meses)', 'meses_periodicidad', 'type="number" min="1" max="60" value="3" required')}
      ${indexFields()}
      ${input('Tasa fija por ajuste (%)', 'tasa_ajuste', 'type="number" min="0" step="0.01" required')}
      ${submitButton('Registrar contrato')}</form>`;
  result(main, `<div class="wrap content">
    ${registrar ? '<a class="back" href="#contratos">Volver a mis contratos</a>' : ''}
    <h1>${title}</h1>
    ${registrar ? `<section class="panel teal">${formHtml}</section>` : `
    <p class="muted">Consultá el calendario y compará un importe informado con el ajuste calculado.</p>
    <div class="stack"><section class="panel"><details ${records.length ? '' : 'open'}>
      <summary>Registrar contrato</summary>${formHtml}</details></section>
    <section><h2>Contratos registrados</h2>${records.length ? '<div class="cards">' + records.map((c) =>
      `<article class="card"><p class="eyebrow">Contrato #${c.id}</p><h3>${h(money(c.monto_base))}</h3>
      <p class="muted">${h(date(c.fecha_inicio))} al ${h(date(c.fecha_fin))}<br>${h(adjustment(c))} cada ${c.meses_periodicidad} meses</p>
      <a class="quiet" href="#contrato/${c.id}">Ver contrato</a></article>`).join('') + '</div>' :
      '<p class="empty">Todavía no hay contratos registrados.</p>'}</section></div>`}</div>`);
  const form = main.querySelector('#contract-form');
  setupAdjustmentFields(form);
  submit(form, async (data) => {
    const c = await api('/contratos', 'POST', {
      fecha_inicio: data.get('fecha_inicio'), duracion_meses: Number(data.get('duracion_meses')),
      monto_base: { monto: data.get('monto'), moneda: data.get('moneda') },
      tipo_ajuste: data.get('tipo_ajuste'), meses_periodicidad: Number(data.get('meses_periodicidad')),
      tasa_ajuste: data.get('tasa_ajuste'), serie_codigo: data.get('serie_codigo'),
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
  for (const menu of header.querySelectorAll('.nav-dropdown[open]')) menu.open = false;
  if (dialog.open && dialogBody.querySelector('[data-transfer-content]')) dialog.close();
  const comparePanel = document.querySelector('#compare-dialog');
  if (comparePanel.open) comparePanel.close();
  releaseListingCarousel?.();
  releaseListingCarousel = undefined;
  releasePublicationMap?.();
  releasePublicationMap = undefined;
  releasePhotoPreviews?.();
  releasePhotoPreviews = undefined;
  releaseManagedPhotos?.();
  releaseManagedPhotos = undefined;
  const version = ++routeVersion;
  const [fragment, filterQuery] = location.hash.slice(1).split('?', 2);
  const [page, id] = fragment.split('/');
  const newContract = page === 'contratos' && id === 'nuevo';
  const documentPage = Object.hasOwn(legalPages, page) ? legalPages[page] : null;
  const tab = documentPage ? page : ['contrato', 'contratos'].includes(page) ? 'contratos' :
    ['publicar', 'cuenta', 'comprar', 'mis-publicaciones', 'admin', 'planes'].includes(page) ? page : 'buscar';
  const isPublication = page === 'publicacion' && /^\d+$/.test(id);
  const isPublisher = page === 'publicador' && /^\d+$/.test(id);
  const view = isPublication ? 'publicacion' : isPublisher ? 'publicador' :
    ['guardados', 'recuperar'].includes(page) ? page : tab;
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
  const navView = newContract ? 'nuevo-contrato' : view === 'guardados' ? view : tab;
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === navView) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  result(main, '<div class="wrap content"><p role="status">Cargando…</p></div>');
  window.scrollTo(0, 0);
  try {
    if (documentPage) legalPage(documentPage);
    else if (isPublication) await publication(id, version);
    else if (isPublisher) await publisherPage(id, version);
    else if (view === 'guardados') await savedListingsPage(filterQuery, version);
    else if (view === 'recuperar') resetPasswordPage(id);
    else if (view === 'cuenta') accountPage(new URLSearchParams(filterQuery));
    else if (view === 'planes') await planesPage(version);
    else if (view === 'admin') await adminPage(version);
    else if (view === 'mis-publicaciones') {
      const fromAdmin = user?.rol === 'ADMIN' && new URLSearchParams(filterQuery).get('origen') === 'admin';
      await myListings(/^\d+$/.test(id) ? id : null, version, fromAdmin);
    }
    else if (page === 'contrato' && /^\d+$/.test(id)) await contract(id, version);
    else if (page === 'contratos') await contracts(version, newContract);
    else if (page === 'publicar') await newListing(version, new URLSearchParams(filterQuery));
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
  const updateHeaderHeight = () => {
    document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
  };
  updateHeaderHeight();
  new ResizeObserver(updateHeaderHeight).observe(header);

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

function setupNavigationMenus() {
  const menus = header.querySelectorAll('.nav-dropdown');
  for (const menu of menus) {
    let closeTimer;
    menu.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      clearTimeout(closeTimer);
      for (const other of menus) {
        if (other !== menu) other.open = false;
      }
      menu.open = true;
    });
    menu.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      closeTimer = setTimeout(() => {
        if (!menu.querySelector(':focus-visible')) menu.open = false;
      }, 140);
    });
  }
  document.addEventListener('click', (event) => {
    for (const menu of menus) {
      if (!menu.contains(event.target) || event.target.closest('.nav-dropdown-panel a')) menu.open = false;
    }
  });
  header.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const menu = event.target.closest('.nav-dropdown[open]');
    if (!menu) return;
    menu.open = false;
    menu.querySelector('summary').focus();
  });
}

if (token) {
  try { setUser(await api('/usuarios/me'), token); }
  catch { setUser(null); }
  await loadAccountFavorites();
}
setupScrollHeader();
setupNavigationMenus();
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
