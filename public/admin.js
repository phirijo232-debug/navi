let allUsers = [];
let selectedUserId = null;
let selectedUser = null;
let selectedLoans = [];
let activeLoanFilter = 'all';
// Timeframe filter for the selected customer (Option 3: approval/borrowed date,
// falling back to the request date for loans that are not approved yet).
let activeTimeframeFilter = 'all';
let customTimeframeFrom = '';
let customTimeframeTo = '';

// Report panel state
let reportScope = 'buraza';
let reportType = 'daily';
let reportFrom = '';
let reportTo = '';

const REPORT_TYPE_LABELS = {
  daily: 'Daily',
  'all-loans': 'All Loans',
  'payments-today': 'Payments',
  overdue: 'Overdue',
  defaulters: 'Defaulters',
  profits: 'Profit / Interest'
};

const REPORT_ENDPOINT = {
  daily: 'summary',
  'all-loans': 'summary',
  'payments-today': 'paid',
  overdue: 'overdue',
  defaulters: 'defaulters',
  profits: 'profits'
};
let storeFeedback = [];
let activeFeedbackFilter = 'all';
let portfolioLoans = [];
let pendingPaymentReviews = [];
let pendingEmail = '';
let pendingResetEmail = '';
let adminToastTimer;
let portfolioRefreshTimer = null;
let adminNotifications = [];
let usersLoaded = false;
let usersLoading = false;
let usersRequestController = null;
let createUserMode = 'customer';

function openCreateUserModal(mode = 'customer') {
  createUserMode = mode === 'hr' ? 'hr' : 'customer';
  const title = document.getElementById('createUserTitle');
  const roleSelect = document.getElementById('newUserRole');
  const customerRole = roleSelect.querySelector('option[value="user"]');
  if (customerRole) customerRole.hidden = createUserMode === 'hr';
  if (title) title.textContent = createUserMode === 'hr' ? 'Create Staff Account' : 'Create New User';
  roleSelect.value = createUserMode === 'hr' ? 'store_admin' : 'user';
  document.getElementById('createUserModal').style.display = 'block';
}

function showAdminSuccess(message) {
  const toast = document.getElementById('bmfToast');
  if (!toast) return;
  toast.textContent = `BMF success: ${message}`;
  toast.dataset.kind = 'success';
  toast.classList.add('visible');
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function applyTheme(theme) {
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.remove('dark', 'light');
  document.body.classList.remove('dark', 'light');
  document.documentElement.classList.add(activeTheme);
  document.body.classList.add(activeTheme);
}

function toggleTheme() {
  const nextMode = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(nextMode);
  localStorage.setItem('mode', nextMode);
}

function showAuthScreen() {
  setViewVisibility('storeSelect', false);
  setViewVisibility('adminAuth', true);
  hideAdminViews();
  showAdminLogin();
}

function setViewVisibility(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !visible;
  el.classList.toggle('hidden', !visible);
  el.style.display = visible ? 'block' : 'none';
}

function hideAdminViews() {
  ['adminDashboard', 'customersView', 'hrView'].forEach(id => setViewVisibility(id, false));
}

// ─── Logged-in admin header (topbar) ─────────────────────────────────────────
function renderLoggedInAdmin() {
  const el = document.getElementById('loggedInAdmin');
  const name = localStorage.getItem('username') || localStorage.getItem('userEmail') || 'Unknown';
  const email = localStorage.getItem('userEmail') || '';
  const role = formatStatus(localStorage.getItem('userRole') || 'user');
  if (el) el.textContent = `Logged in: ${name}${email && email !== name ? ` (${email})` : ''} · ${role}`;
  const displayName = document.getElementById('adminDisplayName');
  const avatar = document.getElementById('adminAvatar');
  if (displayName) displayName.textContent = name.split('@')[0];
  if (avatar) avatar.textContent = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'BM';
}

// ─── Public/private server-mode toggle (franchise manager only) ──────────────
// The backend is the real gate (only the allow-listed admin/franchise role may
// flip it). The client just shows/hides the control and reflects the state.
async function refreshServerMode() {
  const status = document.getElementById('serverModeStatus');
  if (!status) return;
  try {
    const res = await fetch('/admin/server-mode', { headers: getStoreHeaders() });
    if (res.status === 403) { status.hidden = true; return; }
    if (!res.ok) throw new Error('read failed');
    const data = await res.json();
    status.hidden = false;
    status.textContent = data.mode === 'public'
      ? 'Server mode: PUBLIC (internet-reachable, device token still required)'
      : 'Server mode: PRIVATE (local network only)';
    status.dataset.mode = data.mode;
  } catch {
    status.hidden = true;
  }
}

async function toggleServerMode() {
  const status = document.getElementById('serverModeStatus');
  const current = (status && status.dataset.mode) || 'private';
  const next = current === 'public' ? 'private' : 'public';
  const ok = confirm(
    `Switch server to ${next.toUpperCase()} mode?\n\n` +
    'PRIVATE = reachable only on the local network.\n' +
    'PUBLIC = reachable from the internet, but every protected route still requires a valid device token.'
  );
  if (!ok) return;
  try {
    const res = await fetch('/admin/server-mode', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mode: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || 'Could not change the server mode.'); return; }
    await refreshServerMode();
    alert(`Server mode is now ${data.mode.toUpperCase()}.`);
  } catch {
    alert('Could not change the server mode. Please try again.');
  }
}

function initServerMode() {
  const btn = document.getElementById('serverModeBtn');
  if (!btn) return;
  const role = localStorage.getItem('userRole');
  const isFranchiseManager = role === 'admin' || role === 'franchise_admin';
  btn.hidden = !isFranchiseManager;
  btn.onclick = toggleServerMode; // replace (not add) so re-entry never stacks listeners
  if (isFranchiseManager) refreshServerMode();
}

function showDashboard() {
  if (!ensureAdminAccess()) return;
  setViewVisibility('storeSelect', false);
  setViewVisibility('adminAuth', false);
  hideAdminViews();
  setViewVisibility('adminDashboard', true);
  setActiveAdminMenu('adminMenuDashboard');
  renderLoggedInAdmin();
  initServerMode();
  if (portfolioRefreshTimer) clearInterval(portfolioRefreshTimer);
  portfolioRefreshTimer = setInterval(() => {
    if (!document.getElementById('adminDashboard').classList.contains('hidden')) fetchNewRequests();
  }, 30000);
}

function showCustomersView() {
  if (!ensureAdminAccess()) return;
  setViewVisibility('storeSelect', false);
  setViewVisibility('adminAuth', false);
  hideAdminViews();
  setViewVisibility('customersView', true);
  setActiveAdminMenu('adminMenuCustomers');
  if (allUsers.length) applyUserFilterAndSort();
  else {
    const list = document.getElementById('userList');
    if (list) list.innerHTML = '<div class="directory-empty" role="status">Loading customer accounts…</div>';
  }
  fetchUsers();
}

function showHrView() {
  if (!ensureAdminAccess()) return;
  setViewVisibility('storeSelect', false);
  setViewVisibility('adminAuth', false);
  hideAdminViews();
  setViewVisibility('hrView', true);
  setActiveAdminMenu('adminMenuHr');
  const role = localStorage.getItem('userRole');
  if (!['admin', 'franchise_admin'].includes(role)) {
    document.getElementById('hrEmployeeList').innerHTML = '<div class="directory-empty">Employee management is available to the main admin and Franchise Employee Admin only.</div>';
    return;
  }
  fetchHrEmployees();
}

function showStoreSelection() {
  setViewVisibility('storeSelect', true);
  setViewVisibility('adminAuth', false);
  hideAdminViews();
  document.getElementById('storeContext').textContent = '';
}

// Mirror of config.STORES on the server. Keep in sync when a subsidiary is added.
const BMF_STORES = [
  { id: 'buraza', name: 'Buraza Micro Finance', code: 'BMF' }
];

function getStoreName(storeId) {
  const store = BMF_STORES.find(s => s.id === storeId);
  return store ? `${store.name} · ${store.code}` : '';
}

function isKnownStore(storeId) {
  return BMF_STORES.some(s => s.id === storeId);
}

function enterStore(storeId) {
  if (!isKnownStore(storeId)) return;
  allUsers = [];
  usersLoaded = false;
  localStorage.setItem('adminStore', storeId);
  document.getElementById('storeContext').textContent = getStoreName(storeId);

  if (ensureAdminAccess()) {
    applyRolePermissions();
    showDashboard();
    fetchUsers();
    return;
  }

  showAuthScreen();
}

function setAuthMessage(text, isError = false) {
  const el = document.getElementById('authMessage');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
}

function setCreateUserMessage(text, isError = false) {
  const el = document.getElementById('createUserMessage');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
}

function setLoader(active) {
  document.getElementById('loader').classList.toggle('active', active);
}

function getDeviceToken() {
  return localStorage.getItem('deviceToken') || '';
}

// Helper: if no device token, show auth screen so the admin panel doesn't
// render empty tables when the admin has a role but lacks a valid device token.
function maybeRedirectToLoginIfNoToken() {
  const token = getDeviceToken();
  if (!token) {
    showAuthScreen();
  }
}

function getStoreHeaders(extraHeaders = {}) {
  return {
    'x-device-token': getDeviceToken(),
    'x-business-unit': localStorage.getItem('adminStore') || 'buraza',
    ...extraHeaders
  };
}

async function runRefresh(button, task, label = 'Refresh') {
  if (!button) return task();
  const original = button.dataset.idleLabel || button.textContent.trim() || label;
  button.dataset.idleLabel = original;
  button.disabled = true;
  button.textContent = 'Refreshing…';
  button.setAttribute('aria-busy', 'true');
  try { return await task(); }
  finally {
    button.disabled = false;
    button.textContent = original;
    button.removeAttribute('aria-busy');
  }
}

// ─── Signed image links (?token= removed for public access) ──────────────────
// <a> clicks cannot attach the x-device-token header, so on click we ask the
// server for a 10-minute signed URL (POST /uploads/sign — ownership-checked
// server-side) and open that. The device token never appears in a URL.
async function openSignedUpload(filename) {
  if (!filename) return;
  try {
    const res = await fetch('/uploads/sign', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ filename })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      console.error('Signed link failed:', data.error || res.status);
      return;
    }
    const opened = window.open(data.url, '_blank');
    if (!opened) window.location.assign(data.url); // popup blocked → same tab
  } catch (err) {
    console.error('Signed link error:', err);
  }
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const link = target && typeof target.closest === 'function'
    ? target.closest('[data-upload-filename]')
    : null;
  if (!link) return;
  event.preventDefault();
  openSignedUpload(link.getAttribute('data-upload-filename'));
});

function ensureAdminAccess() {
  const token = getDeviceToken();
  const role = localStorage.getItem('userRole');
  const userStoreId = localStorage.getItem('userStoreId') || 'buraza';
  const isStoreOperator = (role === 'store_admin' || role === 'franchise_admin') && userStoreId === 'buraza';
  if (!token || (role !== 'admin' && !isStoreOperator)) {
    showAuthScreen();
    return false;
  }
  return true;
}

function applyRolePermissions() {
  const role = localStorage.getItem('userRole');
  const canManageStore = role === 'admin' || role === 'franchise_admin' || role === 'store_admin';
  const isFranchiseLevel = role === 'admin' || role === 'franchise_admin';
  // Announcements are store-operator only (the backend refuses role 'admin'
  // with 403 — tested policy), so hide the button from the main admin too.
  document.getElementById('announcementBtn').hidden = !(role === 'store_admin' || role === 'franchise_admin');
  document.getElementById('notifyOverdueBtn').hidden = !canManageStore;
  // HR (employee management) is only for the main admin and Franchise Employee Admin.
  const hrMenu = document.getElementById('adminMenuHr');
  if (hrMenu) hrMenu.hidden = !isFranchiseLevel;
  const switchStoreButton = document.getElementById('backToStoresDashboard');
  if (switchStoreButton) switchStoreButton.hidden = BMF_STORES.length < 2;
  // Only franchise-level roles may create store admins; only the main admin may
  // create Franchise Employee Admins.
  document.querySelector('#newUserRole option[value="store_admin"]').hidden = !isFranchiseLevel;
  document.querySelector('#newUserRole option[value="franchise_admin"]').hidden = role !== 'admin';
}

async function fetchUsers() {
  if (!ensureAdminAccess()) return;
  if (usersRequestController) usersRequestController.abort();
  const controller = new AbortController();
  usersRequestController = controller;
  usersLoading = true;
  const directoryStatus = document.getElementById('customerDirectoryStatus');
  const userList = document.getElementById('userList');
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  if (directoryStatus) directoryStatus.textContent = 'Loading customers…';

  try {
    const response = await fetch('/users', {
      headers: getStoreHeaders(),
      signal: controller.signal
    });
    if (controller.signal.aborted) return;

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || 'Failed to fetch customers.');
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    if (controller.signal.aborted) return;
    const users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : null;
    if (!users) throw new Error('The customer service returned data in an unexpected format.');
    allUsers = users.filter(user => !user.role || user.role === 'user');
    usersLoaded = true;
    // Draw the directory as soon as its own endpoint succeeds. Reports,
    // feedback, and loan management enrich the cards, but a slow/failing
    // secondary endpoint must never leave valid customers invisible.
    applyUserFilterAndSort();
    if (directoryStatus) {
      directoryStatus.textContent = allUsers.length
        ? `${allUsers.length} customer accounts in this store · loading loan details...`
        : 'No customer accounts have been added to this store yet.';
    }
    const enrichmentResults = await Promise.allSettled([
      fetchReportData(),
      fetchStoreFeedback(),
      fetchNewRequests()
    ]);
    const loanDetailsLoaded = enrichmentResults[2].status === 'fulfilled' && enrichmentResults[2].value === true;
    if (directoryStatus) {
      directoryStatus.textContent = allUsers.length
        ? `${allUsers.length} customer accounts in this store${loanDetailsLoaded ? ' · loan details loaded from Loan Management.' : ' · loan details are temporarily unavailable.'}`
        : 'No customer accounts have been added to this store yet.';
    }
    applyUserFilterAndSort();
  } catch (err) {
    if (controller.signal.aborted && usersRequestController !== controller) return;
    console.error(err);
    usersLoaded = false;
    const message = controller.signal.aborted
      ? 'Customer records took too long to load. Please retry.'
      : err.status === 401
      ? 'Your admin session expired. Please sign in again.'
      : err.status === 403
        ? 'Your account is not allowed to view this customer directory.'
        : err.message || 'Unable to load customers. Your admin session is still active.';
    if (directoryStatus) directoryStatus.textContent = message;
    if (userList) userList.innerHTML = `<div class="directory-empty">${escapeHtml(message)}</div>`;
    if (err.status === 401) {
      localStorage.removeItem('deviceToken');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('username');
      showAuthScreen();
      setAuthMessage(message, true);
    }
  } finally {
    clearTimeout(timeoutId);
    if (usersRequestController === controller) {
      usersRequestController = null;
      usersLoading = false;
    }
  }
}

// ─── New Requests (BMF store only) ───────────────────────────────────────────
// Numbered pending loan rows with full customer information pulled from the
// registered customer record. The badge shows how many requests await review.
let pendingRequests = [];

function findCustomerForLoan(loan) {
  const email = String(loan.email || '').trim().toLowerCase();
  return allUsers.find(user => String(user.email || '').trim().toLowerCase() === email) || null;
}

async function fetchNewRequests() {
  const list = document.getElementById('newRequestsList');
  const badge = document.getElementById('newRequestsBadge');
  const note = document.getElementById('newRequestsNote');
  try {
    maybeRedirectToLoginIfNoToken();
    const response = await fetch('/loans/all', { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load requests.');

    pendingRequests = (Array.isArray(data.loans) ? data.loans : [])
      .filter(loan => String(loan.status || '').trim().toLowerCase().replace(/\s+/g, '_') === 'pending')
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    portfolioLoans = Array.isArray(data.loans) ? data.loans : [];
    pendingPaymentReviews = portfolioLoans.flatMap(loan => (loan.paymentSubmissions || [])
      .filter(submission => submission.status === 'pending').map(submission => ({ loan, submission })));
    renderNewRequests();
    renderPortfolioOverview();
    renderAdminFeedbackPreview();
    await fetchAdminNotifications();
    // Loan data drives the "loyal vs all" customer view, so refresh it now that
    // portfolioLoans is populated.
    applyUserFilterAndSort();
    if (note) note.textContent = '';
    return true;
  } catch (err) {
    pendingRequests = [];
    portfolioLoans = [];
    pendingPaymentReviews = [];
    if (badge) badge.textContent = '0';
    renderPortfolioOverview();
    if (list) list.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load requests.')}</p>`;
    return false;
  }
}

function renderNewRequests() {
  const list = document.getElementById('newRequestsList');
  const badge = document.getElementById('newRequestsBadge');
  if (!list || !badge) return;

  badge.textContent = String(pendingRequests.length + pendingPaymentReviews.length);
  if (!pendingRequests.length && !pendingPaymentReviews.length) {
    list.innerHTML = '<p>No new requests awaiting review.</p>';
    return;
  }

  const loanRequestsHtml = pendingRequests.map((loan, index) => {
    const customer = findCustomerForLoan(loan) || {};
    return `
    <div class="request-row">
      <div>
        <span class="request-seq">${index + 1}</span>
        <strong style="margin-left: 8px;">${escapeHtml(loan.product || 'Loan')} — ${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</strong>
        <p><strong>Customer:</strong> ${escapeHtml(customer.username || loan.email || 'Unknown')}</p>
        <p><strong>Email:</strong> ${escapeHtml(customer.email || loan.email || 'N/A')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(customer.phone || 'N/A')}</p>
        <p><strong>Amount:</strong> ${formatCurrency(loan.amount)} · <strong>Interest:</strong> ${formatCurrency(loan.interestAmount || 0)} · <strong>Total:</strong> ${formatCurrency(loan.totalRepayment || loan.amount || 0)}</p>
        <p><strong>Tenure:</strong> ${escapeHtml(loan.tenureWeeks || 'N/A')} weeks · <strong>Urgency:</strong> ${escapeHtml(loan.urgency || 'standard')} · <strong>Requested:</strong> ${escapeHtml(formatDate(loan.createdAt))}</p>
      </div>
      <div class="button-row">
        <button class="toggle-mode" type="button" data-request-user="${escapeHtml(customer.id ?? '')}" ${customer.id == null ? 'disabled' : ''}>Open customer</button>
      </div>
    </div>`;
  }).join('');
  const paymentReviewsHtml = pendingPaymentReviews.map(({ loan, submission }, index) => {
    const customer = findCustomerForLoan(loan) || {};
    return `<div class="request-row payment-review-row">
      <div><span class="request-seq">P${index + 1}</span>
        <strong style="margin-left: 8px;">Transfer payment review · ${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</strong>
        <p><strong>Customer:</strong> ${escapeHtml(customer.username || loan.email || 'Unknown')} · ${escapeHtml(customer.email || loan.email || '')}</p>
        <p><strong>Amount:</strong> ${formatCurrency(submission.amount)} · <strong>Method:</strong> ${escapeHtml(submission.mode)} · <strong>Reference:</strong> ${escapeHtml(submission.transactionReference)}</p>
        <p>Open customer loan details to inspect the proof image before approval.</p>
      </div><div class="button-row"><button class="toggle-mode" type="button" data-request-user="${escapeHtml(customer.id ?? '')}" ${customer.id == null ? 'disabled' : ''}>Review payment</button></div>
    </div>`;
  }).join('');
  list.innerHTML = `${paymentReviewsHtml}${loanRequestsHtml}`;
}

function renderPortfolioOverview() {
  const kpis = document.getElementById('portfolioKpis');
  const chart = document.getElementById('collectionsChart');
  const activityList = document.getElementById('recentActivity');
  const loyalList = document.getElementById('loyalBorrowers');
  if (!kpis || !chart || !activityList || !loyalList) return;
  const activeStatuses = ['active', 'grace', 'defaulted', 'liquidated'];
  const active = portfolioLoans.filter(loan => activeStatuses.includes(getLoanStatus(loan)));
  const overdue = portfolioLoans.filter(loan => ['grace', 'defaulted'].includes(getLoanStatus(loan)));
  const defaulters = portfolioLoans.filter(loan => getLoanStatus(loan) === 'defaulted');
  const outstanding = active.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstanding) || 0), 0);
  const overdueOutstanding = overdue.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstanding) || 0), 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const paymentDate = payment => {
    const raw = payment.paymentDate || payment.date;
    const date = raw ? new Date(raw) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const monthPayments = portfolioLoans.flatMap(loan => Array.isArray(loan.payments) ? loan.payments : [])
    .filter(payment => { const date = paymentDate(payment); return date && date >= monthStart && date < monthEnd; });
  const collectedMonth = monthPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const monthLabel = document.getElementById('collectionMonthLabel');
  if (monthLabel) monthLabel.textContent = now.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const kpiData = [
    ['Cash Collected', formatCurrency(collectedMonth), `${monthPayments.length} payments this month`, 'blue'],
    ['Active Loans', String(active.length), `${pendingRequests.length} awaiting approval`, 'green'],
    ['Overdue', String(overdue.length), `${formatCurrency(overdueOutstanding)} outstanding`, 'amber'],
    ['Defaulters', String(defaulters.length), 'Past due with balance remaining', 'red']
  ];
  kpis.innerHTML = kpiData.map(([label, value, note, color]) => `<article class="admin-kpi-card accent-${color}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthlyDays = Array.from({ length: daysInMonth }, (_, index) => {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), index + 1);
    const amount = monthPayments.reduce((sum, payment) => {
      const date = paymentDate(payment);
      return date && date.getDate() === index + 1 ? sum + (Number(payment.amount) || 0) : sum;
    }, 0);
    return { date: dayDate, amount };
  });
  const max = Math.max(100, ...monthlyDays.map(day => day.amount));
  const width = 1000; const height = 250; const left = 48; const top = 14; const bottom = 34;
  const plotW = width - left - 12; const plotH = height - top - bottom;
  const yTicks = 4;
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const y = top + (plotH / yTicks) * i;
    const value = max * (1 - i / yTicks);
    return `<g><line x1="${left}" y1="${y}" x2="${width - 8}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">K${Math.round(value)}</text></g>`;
  }).join('');
  const bars = monthlyDays.map((day, index) => {
    const bw = Math.max(5, (plotW / daysInMonth) * .54);
    const x = left + (index + .23) * (plotW / daysInMonth);
    const barH = day.amount ? Math.max(2, (day.amount / max) * plotH) : 0;
    const y = top + plotH - barH;
    const title = `${day.date.toLocaleDateString('en-GB')}: ${formatCurrency(day.amount)}`;
    return `<g><title>${escapeHtml(title)}</title>${day.amount ? `<rect x="${x}" y="${y}" width="${bw}" height="${barH}" rx="3"/>` : ''}${(index === 0 || (index + 1) % 5 === 0 || index === daysInMonth - 1) ? `<text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${index + 1}</text>` : ''}</g>`;
  }).join('');
  chart.innerHTML = `<svg class="collections-svg admin-month-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily collections for ${escapeHtml(monthLabel?.textContent || 'this month')}">${grid}${bars}</svg><p>Collected this month: <strong>${formatCurrency(collectedMonth)}</strong></p>`;

  const activity = portfolioLoans.flatMap(loan => {
    const customer = findCustomerForLoan(loan) || {};
    const name = customer.username || customer.name || 'Customer';
    const loanId = loan.receiptNumber || `BMF-${loan.id}`;
    const events = [];
    const history = Array.isArray(loan.statusHistory) ? loan.statusHistory : [];
    const latestHistory = history.at(-1);
    if (latestHistory?.updatedAt || loan.updatedAt) {
      const status = String(latestHistory?.status || loan.status || '').toLowerCase();
      const kind = status === 'pending' ? 'amber' : ['declined', 'defaulted'].includes(status) ? 'red' : 'blue';
      const text = status === 'pending' ? `New loan request — ${name} ${formatCurrency(loan.amount)}` : `Loan ${loanId} ${formatStatus(status).toLowerCase()} — ${name}`;
      events.push({ at: latestHistory?.updatedAt || loan.updatedAt, text, kind });
    }
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => events.push({ at: payment.paymentDate || payment.date, text: `Payment ${formatCurrency(payment.amount)} received — ${name}`, kind: 'green' }));
    return events;
  }).filter(item => item.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  activityList.innerHTML = activity.length ? activity.map(item => `<li class="activity-${item.kind}"><span>${escapeHtml(item.text)}</span><small>${escapeHtml(formatRelativeTime(item.at))}</small></li>`).join('') : '<li class="activity-empty">No recent loan activity.</li>';

  const search = String(document.getElementById('adminDashboardSearch')?.value || '').trim().toLowerCase();
  const visibleLoans = portfolioLoans.filter(loan => {
    if (!search) return true;
    const customer = findCustomerForLoan(loan) || {};
    return [loan.receiptNumber, loan.id, loan.email, loan.product, customer.username, customer.phone]
      .some(value => String(value || '').toLowerCase().includes(search));
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 12);
  const loanTable = document.getElementById('adminLoanTable');
  if (loanTable) loanTable.innerHTML = visibleLoans.length ? `<table class="admin-table"><thead><tr><th>Loan ID</th><th>Borrower</th><th>Amount</th><th>Interest</th><th>Total</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${visibleLoans.map(loan => {
    const customer = findCustomerForLoan(loan) || {};
    const status = getLoanStatus(loan);
    const customerId = customer.id;
    const canRecord = ['active', 'grace', 'defaulted'].includes(status) && Number(loan.outstanding) > 0;
    const actionLabel = status === 'pending' ? 'Review' : ['grace', 'defaulted'].includes(status) ? 'Notify' : status === 'paid' ? 'Receipt' : canRecord ? 'Pay' : 'View';
    const actionClass = ['grace', 'defaulted'].includes(status) ? 'quick-red-small' : 'quick-blue-small';
    const quickAction = ['grace', 'defaulted'].includes(status)
      ? `<button type="button" class="${actionClass}" data-notify-loan="${escapeHtml(loan.id)}">Notify</button>`
      : customerId != null ? `<button type="button" class="${actionClass}" data-user-id="${escapeHtml(customerId)}">${actionLabel}</button>` : '<span>—</span>';
    return `<tr data-loan-row><td class="loan-id-cell">${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</td><td>${escapeHtml(customer.username || loan.email || 'Customer')}</td><td>${formatCurrency(loan.amount)}</td><td>${formatCurrency(loan.interestAmount || 0)}</td><td>${formatCurrency(loan.totalRepayment || loan.amount || 0)}</td><td>${escapeHtml(formatDate(loan.dueDate))}</td><td><span class="admin-status status-${escapeHtml(status)}">${escapeHtml(formatStatus(status))}</span></td><td class="admin-row-actions">${quickAction}<button type="button" class="row-view" data-user-id="${escapeHtml(customerId ?? '')}" ${customerId == null ? 'disabled' : ''}>View</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="table-empty">No loans match this search.</p>';

  const customerMap = new Map();
  portfolioLoans.forEach(loan => {
    const key = String(loan.email || '').trim().toLowerCase();
    if (!key) return;
    const item = customerMap.get(key) || { email: loan.email, count: 0, paid: 0, lastPayment: null };
    item.count += 1;
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
      item.paid += Number(payment.amount) || 0;
      const date = paymentDate(payment);
      if (date && (!item.lastPayment || date > item.lastPayment)) item.lastPayment = date;
    });
    customerMap.set(key, item);
  });
  const loyal = [...customerMap.values()].filter(customer => customer.count > 1)
    .sort((a, b) => b.count - a.count || b.paid - a.paid).slice(0, 5);
  loyalList.innerHTML = loyal.length ? `<table class="admin-table loyal-table"><thead><tr><th>#</th><th>Borrower</th><th>Phone</th><th>Total Loans</th><th>Total Repaid</th><th>Last Payment</th><th>Standing</th></tr></thead><tbody>${loyal.map((customer, index) => {
    const user = findCustomerForLoan({ email: customer.email }) || {};
    const stats = getCustomerLoanStats(customer.email);
    const standing = formatStatus(stats.status);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(user.username || customer.email)}</td><td>${escapeHtml(user.phone || '—')}</td><td>${customer.count}</td><td class="paid-cell">${formatCurrency(customer.paid)}</td><td>${customer.lastPayment ? escapeHtml(formatDate(customer.lastPayment)) : '—'}</td><td><span class="admin-status status-${escapeHtml(String(stats.status).toLowerCase())}">${escapeHtml(standing)}</span></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="table-empty">Returning borrowers will appear here after their second loan.</p>';
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 172800) return 'Yesterday';
  return formatDate(date);
}

function renderAdminFeedbackPreview() {
  const preview = document.getElementById('adminFeedbackPreview');
  if (!preview) return;
  const recent = storeFeedback.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 3);
  preview.innerHTML = recent.length ? recent.map(item => {
    const user = allUsers.find(entry => String(entry.email || '').toLowerCase() === String(item.email || '').toLowerCase());
    return `<article class="feedback-preview-item"><strong>${escapeHtml(user?.username || item.email || 'Customer')}</strong><p>${escapeHtml(item.message || '')}</p><small>${escapeHtml(formatDate(item.createdAt))}</small></article>`;
  }).join('') : '<p class="table-empty">No customer feedback yet.</p>';
}

async function fetchAdminNotifications() {
  try {
    const response = await fetch('/notifications', { headers: getStoreHeaders() });
    if (!response.ok) return;
    const data = await response.json();
    adminNotifications = Array.isArray(data) ? data : Array.isArray(data.notifications) ? data.notifications : [];
    renderAdminNotifications();
  } catch { /* notification refresh is best effort; core dashboard remains available */ }
}

function renderAdminNotifications() {
  const list = document.getElementById('adminNotificationList');
  const badge = document.getElementById('adminNotificationCount');
  if (!list || !badge) return;
  const unread = adminNotifications.filter(item => !item.readAt).length;
  badge.textContent = String(unread);
  badge.classList.toggle('hidden', unread === 0);
  const recent = adminNotifications.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 6);
  list.innerHTML = recent.length ? recent.map(item => {
    const reviewLabel = item.type === 'loan-request' ? 'Review request' : item.type === 'payment-review' ? 'Review payment' : '';
    const action = reviewLabel
      ? `<button type="button" data-notification-open-loan="${escapeHtml(item.loanId)}" data-notification-id="${escapeHtml(item.id)}">${reviewLabel}</button>`
      : '';
    return `<article class="notification-item ${item.readAt ? '' : 'unread'}"><strong>${escapeHtml(formatStatus(item.type || 'Update'))}</strong><p>${escapeHtml(item.message || 'There is an update to review.')}</p><small>${escapeHtml(formatRelativeTime(item.createdAt))}</small>${action}</article>`;
  }).join('') : '<p class="table-empty">You are all caught up.</p>';
}

async function markAdminNotificationRead(id) {
  const item = adminNotifications.find(notification => notification.id === id);
  if (!item || item.readAt) return;
  try {
    const response = await fetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', headers: getStoreHeaders() });
    if (!response.ok) return;
    item.readAt = new Date().toISOString();
    renderAdminNotifications();
  } catch { /* keep the notification unread if the write failed */ }
}

async function notifySelectedUser() {
  if (!selectedUser || !selectedUser.email) {
    document.getElementById('detailFeedback').textContent = 'Open a customer first.';
    return;
  }
  const notifyButton = document.querySelector('[data-notify-user]');
  if (notifyButton) { notifyButton.disabled = true; notifyButton.textContent = 'Sending…'; }
  try {
    document.getElementById('detailFeedback').textContent = `Sending notification to ${selectedUser.email}...`;
    const response = await fetch('/loans/notify-user', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: selectedUser.email })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send notification.');
    const resultText = data.skipped
      ? `NOT SENT: Email delivery is disabled in this environment for ${selectedUser.email}.`
      : `SUCCESS: Notification sent to ${selectedUser.email}.`;
    document.getElementById('detailFeedback').textContent = resultText;
  } catch (err) {
    document.getElementById('detailFeedback').textContent = `FAILED: ${err.message || 'Unable to send notification.'}`;
  } finally {
    if (notifyButton) { notifyButton.disabled = false; notifyButton.textContent = 'Notify this customer'; }
  }
}

async function fetchReportData() {
  const metrics = document.getElementById('storeReportMetrics');
  const table = document.getElementById('storeReportTable');
  const note = document.getElementById('storeReportNote');
  metrics.innerHTML = '<p>Loading report summary...</p>';
  table.innerHTML = '';
  note.textContent = '';

  try {
    maybeRedirectToLoginIfNoToken();
    const scope = reportScope;
    const endpoint = REPORT_ENDPOINT[reportType] || 'summary';
    const qs = new URLSearchParams();
    if (reportFrom) qs.set('from', reportFrom);
    if (reportTo) qs.set('to', reportTo);
    const url = `/reports/${scope}/${endpoint}${qs.toString() ? '?' + qs.toString() : ''}`;

    const response = await fetch(url, { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load BMF reports.');

    // --- Render summary metrics ---
    const summary = data.summary || {};
    const values = [
      ['Total loans', String(summary.totalLoans || summary.settledCount || summary.overdue || summary.defaulters || summary.active || 0)],
      ['Cash collected', formatCurrency(summary.cashCollected || summary.totalCollected || 0)],
      ['Gross interest booked', formatCurrency(summary.grossInterestBooked || summary.totalInterestBooked || 0)],
      ['Outstanding', formatCurrency(summary.totalOutstanding || 0)],
      ['Pending payments', String(summary.pendingPayments || 0)],
      ['Defaulters', String(summary.defaulters || 0)],
      ['Settled loans', String(summary.settledLoans || summary.paid || 0)],
      ['Loyal customers', String(summary.loyalCustomers || 0)]
    ];
    metrics.innerHTML = values.map(([label, value]) => `
      <div class="report-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join('');
    if (data.note) note.textContent = data.note;

    // --- Render loan table ---
    const loans = data.loans || data.byStatus ? Object.values(data.byStatus).flat() : [];
    if (loans && loans.length) {
      const headers = ['Receipt', 'Customer', 'Product', 'Status', 'Principal (K)', 'Interest (K)', 'Paid (K)', 'Outstanding (K)', 'Due Date'];
      const rows = loans.map(loan => {
        const statusClass = 'status-' + String(loan.status || loan.businessStatus || 'unknown').toLowerCase().replace(/\s+/g, '-');
        return `
          <tr>
            <td>${escapeHtml(loan.receiptNumber || loan.id || '')}</td>
            <td>${escapeHtml(loan.customer || loan.email || '')}</td>
            <td>${escapeHtml(loan.product || '')}</td>
            <td><span class="status-tag ${statusClass}">${escapeHtml(loan.status || loan.businessStatus || 'unknown')}</span></td>
            <td>${formatCurrency(loan.amount || loan.principal || 0)}</td>
            <td>${formatCurrency(loan.interestBooked || loan.interestAmount || 0)}</td>
            <td>${formatCurrency(loan.totalCollected || loan.paidTotal || 0)}</td>
            <td>${formatCurrency(loan.outstanding || 0)}</td>
            <td>${escapeHtml(loan.dueDate || '')}</td>
          </tr>
        `;
      }).join('');
      table.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>${headers.map(h => `<th style="text-align:left;padding:8px;border:1px solid rgba(255,255,255,0.12);">${escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">${r}</tr>`).join('')}</tbody>
        </table>
      `;
    } else {
      table.innerHTML = '<p style="opacity:0.7;">No loan records found for the selected scope and period.</p>';
    }
  } catch (err) {
    metrics.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load BMF reports.')}</p>`;
    table.innerHTML = '';
    note.textContent = '';
  }
}

async function fetchStoreFeedback() {
  const list = document.getElementById('storeFeedbackList');
  try {
    const response = await fetch('/feedback', { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load BMF feedback.');
    storeFeedback = Array.isArray(data.feedback) ? data.feedback : [];
    renderStoreFeedback();
    renderAdminFeedbackPreview();
  } catch (err) {
    list.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load BMF feedback.')}</p>`;
  }
}

function renderStoreFeedback() {
  const list = document.getElementById('storeFeedbackList');
  const canReview = localStorage.getItem('userRole') === 'store_admin';
  const entries = activeFeedbackFilter === 'all'
    ? storeFeedback
    : storeFeedback.filter(item => item.category === activeFeedbackFilter);
  if (!entries.length) {
    list.innerHTML = '<p>No feedback in this category.</p>';
    return;
  }

  list.innerHTML = entries.slice().reverse().map(item => `
    <article class="feedback-item">
      <div class="feedback-head">
        <strong>${escapeHtml(item.category || 'inquiry')}</strong>
        <span>${escapeHtml(item.status || 'new')}</span>
      </div>
      <p>${escapeHtml(item.message)}</p>
      <small>${escapeHtml(item.email)} · ${escapeHtml(formatDate(item.createdAt))}</small>
      ${item.reviewNote ? `<p><strong>Review note:</strong> ${escapeHtml(item.reviewNote)}</p>` : ''}
      ${canReview ? `<div class="feedback-actions">
        <button type="button" class="toggle-mode" data-feedback-id="${escapeHtml(item.id)}" data-feedback-status="reviewing">Mark reviewing</button>
        <button type="button" class="toggle-mode" data-feedback-id="${escapeHtml(item.id)}" data-feedback-status="resolved">Resolve</button>
      </div>` : ''}
    </article>
  `).join('');
}

async function updateStoreFeedback(id, status) {
  try {
    const response = await fetch(`/feedback/${id}/status`, {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, status })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to update feedback.');
    await fetchStoreFeedback();
  } catch (err) {
    window.alert(err.message || 'Unable to update feedback.');
  }
}

async function downloadReport(format) {
  const note = document.getElementById('storeReportNote');
  try {
    maybeRedirectToLoginIfNoToken();
    const qs = new URLSearchParams({ format });
    if (reportFrom) qs.set('from', reportFrom);
    if (reportTo) qs.set('to', reportTo);
    const endpoint = REPORT_ENDPOINT[reportType] || 'summary';
    const url = `/reports/${reportScope}/${endpoint}?${qs.toString()}`;
    const response = await fetch(url, { headers: getStoreHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to download report.');
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `BMF-${reportScope}-${reportType}-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    note.textContent = 'Report downloaded.';
  } catch (err) {
    note.textContent = err.message || 'Unable to download report.';
  }
}

function getCustomerLoanStats(email) {
  const key = String(email || '').trim().toLowerCase();
  const loans = portfolioLoans.filter(loan => String(loan.email || '').trim().toLowerCase() === key);
  let borrowed = 0;
  let outstanding = 0;
  // Live canonical status of the customer's worst open loan — never a
  // fabricated standing label; only real config.LOAN_STATUSES values.
  const SEVERITY = { defaulted: 4, liquidated: 3, grace: 2, active: 1, pending: 0 };
  let worst = null;
  loans.forEach(loan => {
    borrowed += Number(loan.amount || 0);
    const bal = Number(loan.outstanding || 0);
    if (bal > 0) outstanding += bal;
    const status = getLoanStatus(loan);
    if (status === 'paid' || status === 'declined') return;
    const rank = SEVERITY[status] ?? 0;
    if (worst === null || rank > (SEVERITY[worst] ?? 0)) worst = status;
  });
  const status = worst || (!loans.length ? 'No loans' : 'paid');
  return { count: loans.length, borrowed, outstanding, status };
}

function renderUsers(users) {
  const list = document.getElementById('userList');
  if (!list) return;
  if (!users.length) {
    const message = allUsers.length
      ? 'No customers match this search.'
      : 'No customer accounts have been added to this store yet.';
    list.innerHTML = `<div class="directory-empty">${message}</div>`;
    return;
  }

  list.innerHTML = users.map((user) => {
    const stats = getCustomerLoanStats(user.email);
    return `
    <button type="button" class="user-card" data-user-id="${escapeHtml(user.id)}">
      <h3>${escapeHtml(user.username || 'Unknown user')}</h3>
      <p class="user-meta">${escapeHtml(user.email || '')}</p>
      <p class="user-meta">Phone: ${escapeHtml(user.phone || 'N/A')}</p>
      <p class="user-meta">NRC: ${escapeHtml(user.nrc || 'N/A')} · Joined: ${escapeHtml(formatDate(user.createdAt))}</p>
      <p class="user-meta">Loans: ${stats.count} · Borrowed: ${formatCurrency(stats.borrowed)} · Outstanding: ${formatCurrency(stats.outstanding)}</p>
      <p class="user-meta">Status: <strong>${escapeHtml(formatStatus(stats.status))}</strong></p>
    </button>
  `;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatDate(dateValue) {
  if (!dateValue) return 'Not set';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return `${formatDate(date.toISOString())} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ─── CSV export (rule 10) ─────────────────────────────────────────────────────
function toCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // Wrap in quotes so Excel keeps IDs like BMF-20261007-7232 / +2609... intact.
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(toCsvCell).join(','), ...rows.map(row => row.map(toCsvCell).join(','))];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getLoanStatus(loan) {
  // Prefer the server-computed canonical business status (single source of truth).
  const CANONICAL = ['pending', 'active', 'grace', 'defaulted', 'liquidated', 'paid', 'declined'];
  const canonical = String(loan.businessStatus || '').toLowerCase();
  if (CANONICAL.includes(canonical)) return canonical;
  const status = String(loan.status || 'pending').toLowerCase().replace(/\s+/g, '_');
  if (['declined', 'paid', 'defaulted', 'liquidated'].includes(status)) return status;
  if (status === 'overdue') return 'grace'; // legacy label — past due lives in grace/defaulted
  if (['approved', 'in_progress', 'in-progress', 'running'].includes(status)) return 'active';
  if (['active', 'grace', 'pending'].includes(status)) return status;
  return 'pending';
}

function renderLoanDetails(loan) {
  const status = getLoanStatus(loan);
  const canManageStore = ['admin', 'franchise_admin', 'store_admin'].includes(localStorage.getItem('userRole'));
  const history = Array.isArray(loan.statusHistory) && loan.statusHistory.length
    ? loan.statusHistory.map(entry => `
        <li>
          <strong>${escapeHtml(formatStatus(entry.status || 'updated'))}</strong>
          <div>${escapeHtml(entry.reason || 'No reason provided.')}</div>
          <small>${escapeHtml(formatDate(entry.updatedAt || loan.updatedAt))}${entry.actor ? ` · by ${escapeHtml(entry.actor)}` : ''}</small>
        </li>
      `).join('')
    : '<li>No status history.</li>';
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  // Placeholder anchors: the click-to-sign listener above fetches a short-lived
  // signed URL from /uploads/sign at open time (?token= no longer exists).
  const fileLink = (name) => `<a class="proof-link" href="#" data-upload-filename="${escapeHtml(name)}">`;
  const paymentHistory = payments.length ? payments.map(payment => `
    <li>
      ${formatCurrency(payment.amount)} · ${escapeHtml(payment.mode || 'payment')} · ${escapeHtml(formatDate(payment.date))}
      ${payment.note ? `<div>${escapeHtml(payment.note)}</div>` : ''}
      ${payment.screenshot ? `${fileLink(payment.screenshot)}View proof of payment</a>` : '<span>No proof attached</span>'}
    </li>
  `).join('') : '<li>No payments recorded.</li>';
  const proofLinks = [
    ['collateral front', loan.collateralFront], ['collateral back', loan.collateralBack],
    ['NRC front', loan.nrcFront], ['NRC back', loan.nrcBack]
  ].filter(([, filename]) => filename).map(([label, filename]) => `${fileLink(filename)}View ${label}</a>`).join('');
  const paymentReviews = (loan.paymentSubmissions || []).map(item => `
    <li class="payment-review-item"><strong>${formatCurrency(item.amount)}</strong> · ${escapeHtml(item.mode)} · Ref: ${escapeHtml(item.transactionReference)} · <strong>${escapeHtml(item.status)}</strong>
      <div>${escapeHtml(formatDate(item.submittedAt))} · Submitted by ${escapeHtml(item.submittedBy || 'borrower')}</div>
      ${item.screenshot ? `${fileLink(item.screenshot)}View transfer proof</a>` : ''}
      ${item.status === 'pending' && canManageStore ? `<div class="button-row"><button type="button" class="enter-btn" data-payment-review="approve" data-loan-id="${escapeHtml(loan.id)}" data-submission-id="${escapeHtml(item.id)}">Approve verified payment</button><button type="button" class="toggle-mode" data-payment-review="decline" data-loan-id="${escapeHtml(loan.id)}" data-submission-id="${escapeHtml(item.id)}">Decline</button></div>` : ''}
      ${item.reviewReason ? `<p>Review note: ${escapeHtml(item.reviewReason)}</p>` : ''}
    </li>`).join('');
  const outstanding = Number(loan.outstanding || 0);
  // Payments: admin or store_admin (both may record money). Decisions: the
  // assigned store_admin only — mirrors the backend's franchise-scoping gate.
  const canDecide = localStorage.getItem('userRole') === 'store_admin';
  const canRecordPayment = canManageStore && outstanding > 0 &&
    ['active', 'grace', 'defaulted'].includes(status);
  const canReview = canDecide &&
    ['pending', 'active'].includes(status);
  // Grace lifecycle controls: manual grace entry needs an agreed end date;
  // verify-overdue and liquidate are one-way admin decisions.
  const canManageLifecycle = canDecide && outstanding > 0 &&
    ['active', 'grace', 'defaulted'].includes(status);
  const creator = loan.reviewedBy ||
    (Array.isArray(loan.statusHistory) && loan.statusHistory[0]?.actor) || null;

  return `
    <article class="loan-item">
      <div class="loan-header">
        <strong>${escapeHtml(loan.product || 'Loan')} #${escapeHtml(loan.id)}</strong>
        <span class="status-tag status-${escapeHtml(status)}">${escapeHtml(status.replace(/_/g, ' ').toUpperCase())}</span>
      </div>
      <p><strong>Amount:</strong> ${formatCurrency(loan.amount)}</p>
      <p><strong>Interest:</strong> ${formatCurrency(loan.interestAmount || 0)}</p>
      <p><strong>Total:</strong> ${formatCurrency(loan.totalRepayment || loan.amount || 0)}</p>
      <p><strong>Outstanding:</strong> ${formatCurrency(loan.outstanding || 0)}</p>
      <div class="loan-fields">
        <p><strong>Due date:</strong> ${escapeHtml(formatDate(loan.dueDate))}</p>
        <p><strong>Urgency:</strong> ${escapeHtml(loan.urgency || 'standard')}</p>
        <p><strong>Tenure:</strong> ${escapeHtml(loan.tenureWeeks || 'N/A')} weeks</p>
        <p><strong>Payment mode:</strong> ${escapeHtml(loan.paymentMode || 'Not provided')}</p>
        <p><strong>Collateral:</strong> ${escapeHtml(loan.collateralDescription || 'Not provided')}</p>
        <p><strong>Collateral grade:</strong> ${escapeHtml(loan.collateralGrade || 'Not graded')}</p>
        <p><strong>Decision reason:</strong> ${escapeHtml(loan.adminReason || 'No decision reason yet.')}</p>
        <p><strong>Created by:</strong> ${creator ? escapeHtml(creator) : 'Not recorded'}</p>
        <p><strong>Requested:</strong> ${escapeHtml(formatDate(loan.createdAt))}</p>
        <p><strong>Borrowed (approved):</strong> ${loan.approvedAt || loan.borrowedDate ? escapeHtml(formatDate(loan.approvedAt || loan.borrowedDate)) : 'Not yet approved'}</p>
        ${loan.graceUntil ? `<p><strong>Grace agreed until:</strong> ${escapeHtml(formatDate(loan.graceUntil))} · 1.8%/day · Accrued penalty: ${formatCurrency(loan.graceAccrued || 0)}</p>` : ''}
        ${loan.verifiedOverdueAt ? `<p><strong>Overdue verified:</strong> ${escapeHtml(formatDate(loan.verifiedOverdueAt))} by ${escapeHtml(loan.verifiedOverdueBy || 'admin')}</p>` : ''}
      </div>
      ${proofLinks ? `<div>${proofLinks}</div>` : ''}
      ${paymentReviews ? `<section class="payment-review-panel"><h3>Transfer payment review</h3><ul>${paymentReviews}</ul></section>` : ''}
      ${canReview ? `
        <input type="text" class="modal-input" data-decision-reason="${escapeHtml(loan.id)}" maxlength="300" value="${escapeHtml(loan.adminReason || '')}" placeholder="Decision reason" style="margin-top: 12px;">
        <div class="button-row" style="margin-top: 12px;">
          <button class="toggle-mode" type="button" data-loan-action="approve" data-loan-id="${escapeHtml(loan.id)}">Approve</button>
          <button class="toggle-mode" type="button" data-loan-action="decline" data-loan-id="${escapeHtml(loan.id)}">Decline</button>
        </div>` : ''}
      ${canManageLifecycle ? `
        <div class="loan-fields" style="margin-top: 14px;">
          <section>
            <strong>Lifecycle (admin)</strong>
            <div class="button-row" style="margin-top: 10px; flex-wrap: wrap;">
              <input type="date" class="modal-input" data-grace-date="${escapeHtml(loan.id)}" style="max-width: 210px;" aria-label="Agreed grace until" ${loan.graceUntil ? `value="${escapeHtml(loan.graceUntil)}"` : ''}>
              <button class="toggle-mode" type="button" data-loan-action="enter_grace" data-loan-id="${escapeHtml(loan.id)}">Enter grace (1.8%/day)</button>
              ${status !== 'defaulted' ? `<button class="toggle-mode" type="button" data-loan-action="verify_overdue" data-loan-id="${escapeHtml(loan.id)}">Verify overdue</button>` : ''}
              ${status !== 'liquidated' ? `<button class="toggle-mode" type="button" data-loan-action="liquidate" data-loan-id="${escapeHtml(loan.id)}">Liquidate collateral</button>` : ''}
            </div>
            <p class="message-text" style="text-align:left;">Grace needs an agreed end date. Liquidation needs a reason in the decision box above. Once the balance hits zero the loan becomes Paid automatically.</p>
          </section>
        </div>` : ''}
      ${canRecordPayment ? `
        <form class="payment-form panel" data-payment-form="${escapeHtml(loan.id)}" style="padding: 14px; margin-top: 14px;">
          <h3>Record payment</h3>
          <input type="number" name="amount" class="modal-input" min="0.01" max="${outstanding}" step="0.01" placeholder="Amount" required>
          <select name="mode" class="modal-input" style="margin-top: 10px;">
            <option value="cash">Cash</option>
            <option value="airtel">Airtel Money</option>
            <option value="mtn">MTN MoMo</option>
            <option value="bank">Bank Transfer</option>
            <option value="other">Other</option>
          </select>
          <input type="text" name="note" class="modal-input" maxlength="240" placeholder="Reference note" style="margin-top: 10px;">
          <label>Proof of payment<input type="file" name="screenshot" accept="image/*" class="modal-input" style="margin-top: 8px;"></label>
          <button type="submit" class="enter-btn" style="margin-top: 10px;">Post payment</button>
        </form>` : ''}
      <div class="loan-fields" style="margin-top: 14px;">
        <section><strong>Payments</strong><ul>${paymentHistory}</ul></section>
        <section><strong>Status history</strong><ul>${history}</ul></section>
      </div>
    </article>
  `;
}

// ─── Timeframe filter (Option 3) ─────────────────────────────────────────────
// Loans are grouped by their borrowed (approval) date; pending loans without an
// approval date fall back to their request date. A settled (paid) loan is grouped
// by its settlement date instead, so "Today + Paid" surfaces a loan settled today
// even when it was borrowed weeks ago.
const LOAN_STATUS_FILTERS = ['all', 'pending', 'active', 'grace', 'defaulted', 'liquidated', 'declined', 'paid'];
const TIMEFRAME_FILTERS = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7', 'Last 7 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['custom', 'Custom range']
];

// Settlement date of a loan: the recorded settledAt, else the latest payment date
// (mirrors reportController.getSettledAt so legacy paid loans without settledAt work).
function getSettledAt(loan) {
  if (loan.settledAt) return loan.settledAt;
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  return payments.map(p => p.paymentDate || p.date).filter(Boolean).sort().at(-1) || null;
}

function getLoanPeriodDate(loan) {
  const settled = getLoanStatus(loan) === 'paid';
  const source = (settled ? getSettledAt(loan) : null)
    || loan.approvedAt || loan.borrowedDate || loan.createdAt;
  if (!source) return null;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function loanMatchesTimeframe(loan) {
  if (activeTimeframeFilter === 'all') return true;
  const date = getLoanPeriodDate(loan);
  if (!date) return false;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (activeTimeframeFilter === 'today') {
    return date >= startOfToday && date < endOfToday;
  }
  if (activeTimeframeFilter === 'yesterday') {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - 1);
    return date >= start && date < startOfToday;
  }
  if (activeTimeframeFilter === '7') {
    // 7 calendar days including today (e.g. Oct 1 → Oct 7 when today is Oct 7).
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - 6);
    return date >= start && date < endOfToday;
  }
  const now = new Date();
  if (activeTimeframeFilter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return date >= start && date < end;
  }
  if (activeTimeframeFilter === 'last-month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return date >= start && date < end;
  }
  if (activeTimeframeFilter === 'custom') {
    const from = customTimeframeFrom ? new Date(`${customTimeframeFrom}T00:00:00`) : null;
    const to = customTimeframeTo ? new Date(`${customTimeframeTo}T23:59:59.999`) : null;
    if (from && !Number.isNaN(from.getTime()) && date < from) return false;
    if (to && !Number.isNaN(to.getTime()) && date > to) return false;
    return true;
  }
  return true;
}

function renderSelectedUser() {
  const modalBody = document.getElementById('modalBody');
  const visibleLoans = selectedLoans.filter(loan =>
    (activeLoanFilter === 'all' || getLoanStatus(loan) === activeLoanFilter) &&
    loanMatchesTimeframe(loan)
  );

  const canNotifyUser = localStorage.getItem('userRole') === 'store_admin';

  modalBody.innerHTML = `
    <h2>Customer: ${escapeHtml(selectedUser.username || 'Unknown user')}</h2>
    <p><strong>Email:</strong> ${escapeHtml(selectedUser.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(selectedUser.phone || 'N/A')}</p>
    <p><strong>Role:</strong> ${escapeHtml(selectedUser.role || 'user')}</p>
    ${canNotifyUser ? `
    <div class="button-row" style="margin: 10px 0;">
      <button class="toggle-mode" type="button" data-notify-user>Notify this customer</button>
    </div>` : ''}
    <hr>
    <h3>Buraza loan history (${selectedLoans.length})</h3>
    <div class="loan-filters" role="group" aria-label="Filter loans by status">
      ${LOAN_STATUS_FILTERS.map(status => `
        <button type="button" class="toggle-mode loan-filter ${activeLoanFilter === status ? 'active' : ''}" data-loan-filter="${status}">${status.replace(/_/g, ' ')}</button>
      `).join('')}
    </div>
    <div class="loan-filters timeframe-filters" role="group" aria-label="Filter loans by time period">
      ${TIMEFRAME_FILTERS.map(([value, label]) => `
        <button type="button" class="toggle-mode loan-filter ${activeTimeframeFilter === value ? 'active' : ''}" data-timeframe="${value}">${label}</button>
      `).join('')}
    </div>
    ${activeTimeframeFilter === 'custom' ? `
    <div class="timeframe-custom">
      <label for="timeframeFrom">From</label>
      <input type="date" id="timeframeFrom" class="modal-input" value="${escapeHtml(customTimeframeFrom)}">
      <label for="timeframeTo">To</label>
      <input type="date" id="timeframeTo" class="modal-input" value="${escapeHtml(customTimeframeTo)}">
    </div>` : ''}
    <p class="timeframe-note">Showing ${visibleLoans.length} of ${selectedLoans.length} loans — grouped by borrowed date; paid loans use their settlement date.</p>
    <div class="loan-list">
      ${visibleLoans.length ? visibleLoans.map(renderLoanDetails).join('') : '<p>No loans match the selected filters.</p>'}
    </div>
  `;
}

async function viewUserDetails(userId) {
  const user = allUsers.find((entry) => String(entry.id) === String(userId));
  if (!user) return;

  selectedUserId = user.id;
  selectedUser = user;
  activeLoanFilter = 'all';
  activeTimeframeFilter = 'all';
  customTimeframeFrom = '';
  customTimeframeTo = '';
  document.getElementById('userModal').style.display = 'block';
  document.getElementById('modalBody').innerHTML = '<p>Loading customer loan history...</p>';
  document.getElementById('detailFeedback').textContent = '';

  try {
    const response = await fetch(`/loans?email=${encodeURIComponent(user.email)}`, {
      headers: getStoreHeaders()
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to load user loans');
    }

    const data = await response.json();
    selectedLoans = Array.isArray(data.loans) ? data.loans : [];
    renderSelectedUser();
  } catch (err) {
    console.error(err);
    document.getElementById('modalBody').innerHTML = `<p>${escapeHtml(err.message || 'Unable to load loan details.')}</p>`;
  }
}

async function submitPayment(event, form) {
  event.preventDefault();
  const loanId = form.dataset.paymentForm;
  const formData = new FormData(form);
  formData.append('id', loanId);
  const screenshot = formData.get('screenshot');
  if (screenshot && screenshot.size > 5 * 1024 * 1024) {
    document.getElementById('detailFeedback').textContent = 'Proof of payment must be 5 MB or smaller.';
    return;
  }

  try {
    const response = await fetch('/loans/payment', {
      method: 'POST',
      headers: getStoreHeaders(),
      body: formData
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not record payment.');
    document.getElementById('detailFeedback').textContent = result.message || 'Payment recorded.';
    showAdminSuccess(result.message || 'Payment recorded.');
    if (selectedUserId !== null) {
      await viewUserDetails(selectedUserId);
    }
  } catch (err) {
    document.getElementById('detailFeedback').textContent = err.message || 'Error recording payment.';
  }
}

async function updateLoanStatus(loanId, action, reason, graceUntil) {
  try {
    const cleanReason = String(reason || '').trim();
    if (action === 'liquidate' && !cleanReason) {
      document.getElementById('detailFeedback').textContent = 'Liquidation requires a reason — confirm what happened to the collateral.';
      return;
    }
    if (action === 'enter_grace' && !graceUntil) {
      document.getElementById('detailFeedback').textContent = 'Entering grace requires an agreed grace-until date.';
      return;
    }
    const response = await fetch(`/loans/${loanId}/action`, {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, reason: cleanReason, graceUntil: graceUntil || undefined })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not update loan status.');
    document.getElementById('detailFeedback').textContent = data.message || 'Loan status updated.';
    showAdminSuccess(data.message || 'Loan status updated.');
    await viewUserDetails(selectedUserId);
    await fetchNewRequests();
  } catch (err) {
    document.getElementById('detailFeedback').textContent = err.message || 'Could not update loan status.';
  }
}

async function sendOverdueNotice(loanId) {
  if (!confirm('Send overdue notification email to customer?')) return;

  try {
    const response = await fetch(`/loans/${loanId}/notify-overdue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders()
      },
      body: JSON.stringify({ messageType: 'overdue' })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Notification could not be sent.');
    alert(`SUCCESS: ${result.message || 'Notification sent.'}`);
  } catch (err) {
    alert(`FAILED: ${err.message || 'Error sending notification.'}`);
  }
}

function closeModal() {
  document.getElementById('userModal').style.display = 'none';
}

function closeCreateUserModal() {
  document.getElementById('createUserModal').style.display = 'none';
  document.getElementById('createUserForm').reset();
  document.getElementById('newUserRole').querySelector('option[value="user"]').hidden = false;
  document.getElementById('createUserTitle').textContent = 'Create New User';
  createUserMode = 'customer';
  setCreateUserMessage('');
}

function closeAnnouncementModal() {
  document.getElementById('announcementModal').style.display = 'none';
  document.getElementById('announcementForm').reset();
  document.getElementById('announcementFeedback').textContent = '';
}

async function handleAnnouncementSubmit(event) {
  event.preventDefault();
  const subject = document.getElementById('announcementSubject').value.trim();
  const message = document.getElementById('announcementMessage').value.trim();
  const recipients = allUsers.filter(user => !['admin', 'franchise_admin', 'store_admin'].includes(user.role)).length;

  if (!subject || !message) {
    document.getElementById('announcementFeedback').textContent = 'Enter a subject and message.';
    return;
  }

  if (!window.confirm(`Send this announcement to ${recipients} registered Buraza customers?`)) return;

  const feedback = document.getElementById('announcementFeedback');
  const submitButton = document.querySelector('#announcementForm button[type="submit"]');
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Sending…'; }
  feedback.textContent = 'Sending announcement...';

  try {
    const response = await fetch('/admin/announcements', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subject, message })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send announcement.');
    feedback.textContent = data.failed
      ? `PARTIAL: ${data.sent || 0} sent, ${data.failed} failed of ${data.total || recipients}. Reason: ${(data.failureReasons || []).join('; ') || 'Delivery failed for some recipients.'}`
      : `SUCCESS: ${data.message || `Sent to ${data.sent || 0} customers.`}`;
  } catch (err) {
    feedback.textContent = `FAILED: ${err.message || 'Unable to send announcement.'}`;
  } finally {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Send to all customers'; }
  }
}

async function notifyAllOverdue() {
  const confirmed = window.confirm('Send overdue notices to all Buraza customers with an overdue balance?');
  if (!confirmed) return;

  const button = document.getElementById('notifyOverdueBtn');
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Sending…';
  try {
    const response = await fetch('/loans/notify-overdue', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send overdue notices.');
    const result = data.failed
      ? `PARTIAL SUCCESS: ${data.sent} sent; ${data.failed} failed. Reason: ${(data.failureReasons || []).join('; ') || 'Delivery failed for some recipients.'}`
      : `SUCCESS: ${data.message || `Sent to ${data.sent} customers.`}`;
    window.alert(`${result}\nOverdue loans: ${data.overdueLoans}.`);
  } catch (err) {
    window.alert(`FAILED: ${err.message || 'Unable to send overdue notices.'}`);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!email || !password) {
    setAuthMessage('Email and password are required.', true);
    return;
  }

  setLoader(true);
  setAuthMessage('');

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    setLoader(false);

    if (data.message) {
      showAdminSuccess(data.message);
      pendingEmail = email;
      document.getElementById('otpSentTo').textContent = `OTP sent to: ${data.otpSentTo || email}`;
      document.getElementById('adminLoginForm').classList.add('hidden');
      document.getElementById('adminOtpForm').classList.remove('hidden');
      document.getElementById('adminOtp').focus();
      return;
    }

    setAuthMessage(data.error || 'Login failed.', true);
  } catch (err) {
    setLoader(false);
    setAuthMessage('Connection error. Please try again.', true);
  }
}

function showAdminLogin() {
  document.getElementById('adminLoginForm').classList.remove('hidden');
  document.getElementById('adminOtpForm').classList.add('hidden');
  document.getElementById('passwordResetRequestForm').classList.add('hidden');
  document.getElementById('passwordResetConfirmForm').classList.add('hidden');
  document.getElementById('adminOtpForm').reset();
  document.getElementById('passwordResetRequestForm').reset();
  document.getElementById('passwordResetConfirmForm').reset();
  setAuthMessage('');
}

function showPasswordResetRequest() {
  document.getElementById('resetEmail').value = document.getElementById('adminEmail').value.trim();
  document.getElementById('adminLoginForm').classList.add('hidden');
  document.getElementById('adminOtpForm').classList.add('hidden');
  document.getElementById('passwordResetConfirmForm').classList.add('hidden');
  document.getElementById('passwordResetRequestForm').classList.remove('hidden');
  setAuthMessage('');
}

async function requestAdminPasswordReset(event) {
  if (event) event.preventDefault();
  const email = document.getElementById('resetEmail').value.trim().toLowerCase();
  if (!email) {
    setAuthMessage('Enter your admin email address.', true);
    return;
  }

  setLoader(true);
  setAuthMessage('');
  try {
    const response = await fetch('/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, adminOnly: true })
    });
    const data = await response.json().catch(() => ({}));
    setLoader(false);
    if (!response.ok) throw new Error(data.error || 'Unable to send a reset code.');

    pendingResetEmail = email;
    document.getElementById('resetOtpSentTo').textContent = 'If an eligible account exists, a reset code will arrive at its registered email.';
    document.getElementById('passwordResetRequestForm').classList.add('hidden');
    document.getElementById('passwordResetConfirmForm').classList.remove('hidden');
    document.getElementById('resetOtp').focus();
  } catch (err) {
    setLoader(false);
    setAuthMessage(err.message || 'Unable to send a reset code.', true);
  }
}

async function confirmAdminPasswordReset(event) {
  event.preventDefault();
  const otp = document.getElementById('resetOtp').value.trim();
  const newPassword = document.getElementById('resetNewPassword').value;
  const confirmNewPassword = document.getElementById('resetConfirmPassword').value;

  if (newPassword !== confirmNewPassword) {
    setAuthMessage('Passwords do not match.', true);
    return;
  }

  setLoader(true);
  setAuthMessage('');
  try {
    const response = await fetch('/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingResetEmail, otp, newPassword, confirmNewPassword })
    });
    const data = await response.json().catch(() => ({}));
    setLoader(false);
    if (!response.ok) throw new Error(data.error || 'Unable to reset password.');

    document.getElementById('adminEmail').value = pendingResetEmail;
    pendingResetEmail = '';
    showAdminLogin();
    setAuthMessage(data.message || 'Password reset successfully. You can now login.');
  } catch (err) {
    setLoader(false);
    setAuthMessage(err.message || 'Unable to reset password.', true);
  }
}

async function handleAdminOtp(event) {
  event.preventDefault();
  const otp = document.getElementById('adminOtp').value.trim();

  if (!pendingEmail || !otp) {
    setAuthMessage('Please enter the OTP.', true);
    return;
  }

  setLoader(true);
  setAuthMessage('');

  try {
    const response = await fetch('/login/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail, otp })
    });

    const data = await response.json();
    setLoader(false);

    if (data.message === 'Login successful.') {
      showAdminSuccess('Admin login verified. Dashboard ready.');
      if (!['admin', 'store_admin', 'franchise_admin'].includes(data.role)) {
        setAuthMessage('This account is not an admin account.', true);
        document.getElementById('adminOtpForm').classList.add('hidden');
        document.getElementById('adminLoginForm').classList.remove('hidden');
        return;
      }

      localStorage.setItem('deviceToken', data.deviceToken);
      localStorage.setItem('userEmail', pendingEmail);
      localStorage.setItem('userRole', data.role);
      localStorage.setItem('userStoreId', data.storeId || 'buraza');
      localStorage.setItem('adminStore', 'buraza');
      localStorage.setItem('username', data.username || 'Admin');
      applyRolePermissions();
      localStorage.setItem('lastAppPage', 'admin.html');
      showDashboard();
      await fetchUsers();
      return;
    }

    setAuthMessage(data.error || 'OTP verification failed.', true);
  } catch (err) {
    setLoader(false);
    setAuthMessage('Connection error while verifying OTP.', true);
  }
}

function logoutAdmin() {
  if (!window.confirm('Log out of BMF Admin?')) return;
  localStorage.removeItem('deviceToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userStoreId');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('username');
  localStorage.removeItem('lastAppPage');
  localStorage.removeItem('adminStore');
  usersLoaded = false;
  allUsers = [];
  pendingEmail = '';
  document.getElementById('adminLoginForm').reset();
  document.getElementById('adminOtpForm').reset();
  document.getElementById('adminOtpForm').classList.add('hidden');
  document.getElementById('adminLoginForm').classList.remove('hidden');
  setAuthMessage('');
  showStoreSelection();
}

async function handleCreateUser(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById('newUserName').value.trim(),
    email: document.getElementById('newUserEmail').value.trim(),
    phone: document.getElementById('newUserPhone').value.trim(),
    nrc: document.getElementById('newUserNrc').value.trim(),
    role: document.getElementById('newUserRole').value,
    password: document.getElementById('newUserPassword').value,
    confirmPassword: document.getElementById('newUserConfirmPassword').value
  };

  if (!payload.username || !payload.email || !payload.password || !payload.confirmPassword) {
    setCreateUserMessage('All required fields must be filled.', true);
    return;
  }
  if (!/^\d{6}\/\d{2}\/\d$/.test(payload.nrc)) {
    setCreateUserMessage('NRC number is required and must look like 123456/78/1.', true);
    return;
  }

  try {
    const response = await fetch('/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getStoreHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Unable to create user');
    }

    setCreateUserMessage(data.message || 'User created successfully.');
    document.getElementById('createUserForm').reset();
    if (createUserMode === 'hr') await fetchHrEmployees();
    else await fetchUsers();
    setTimeout(closeCreateUserModal, 700);
  } catch (err) {
    setCreateUserMessage(err.message || 'User creation failed.', true);
  }
}

// ─── CSV export handlers (rule 10) ───────────────────────────────────────────
function buildExportTable(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'users') {
    const rows = allUsers.map(user => {
      const stats = getCustomerLoanStats(user.email);
      return [user.username, user.email, user.phone, user.nrc, formatDate(user.createdAt), stats.count, stats.borrowed, stats.outstanding, formatStatus(stats.status)];
    });
    return { name: `bmf-customers-${stamp}`, title: 'BMF Customers', headers: ['Name', 'Email', 'Phone', 'NRC', 'Registered', 'Loans', 'Total Borrowed', 'Outstanding', 'Status'], rows };
  }
  if (kind === 'requests') {
    const rows = pendingRequests.map(loan => {
      const customer = findCustomerForLoan(loan) || {};
      return [loan.receiptNumber, customer.username, loan.email, loan.product, loan.amount, loan.tenureWeeks, loan.urgency, formatDate(loan.createdAt)];
    });
    return { name: `bmf-new-requests-${stamp}`, title: 'BMF New Loan Requests', headers: ['Receipt ID', 'Customer', 'Email', 'Product', 'Amount', 'Tenure (weeks)', 'Urgency', 'Requested'], rows };
  }
  if (kind === 'feedback') {
    const rows = storeFeedback.map(item => [item.email, item.category, item.status, item.message, item.reviewNote, formatDate(item.createdAt)]);
    return { name: `bmf-feedback-${stamp}`, title: 'BMF Customer Feedback', headers: ['Email', 'Category', 'Status', 'Message', 'Review Note', 'Submitted'], rows };
  }
  return null;
}

function exportTableCsv(kind) {
  const table = buildExportTable(kind);
  if (!table) return;
  downloadCsv(`${table.name}.csv`, table.headers, table.rows);
}

// Zero-dependency PDF: render the same table as a clean printable HTML document
// and open the browser print dialog, where the user chooses "Save as PDF".
function exportTablePdf(kind) {
  const table = buildExportTable(kind);
  if (!table) return;
  const head = table.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = table.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(table.title)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
      h1 { font-size: 18px; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
      th { background: #eee; }
    </style></head><body>
    <h1>${escapeHtml(table.title)}</h1>
    <p>Generated ${escapeHtml(formatDate(new Date().toISOString()))}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
  const win = window.open('', '_blank');
  if (!win) {
    window.alert('Please allow pop-ups to export the PDF.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ─── Left ☰ menu navigation (Dashboard / Customers / HR pages) ──────────────
function setupAdminMenu() {
  const toggle = document.getElementById('adminMenuBtn');
  const dropdown = document.getElementById('adminMenuDropdown');
  if (toggle && dropdown) {
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      dropdown.classList.toggle('active');
    });
    window.addEventListener('click', event => {
      if (!dropdown.contains(event.target) && event.target !== toggle) {
        dropdown.classList.remove('active');
      }
    });
  }
  document.getElementById('adminMenuDashboard')?.addEventListener('click', () => {
    dropdown.classList.remove('active');
    showDashboard();
  });
  document.getElementById('adminMenuCustomers')?.addEventListener('click', () => {
    dropdown.classList.remove('active');
    showCustomersView();
  });
  document.getElementById('adminMenuHr')?.addEventListener('click', () => {
    dropdown.classList.remove('active');
    showHrView();
  });
  document.getElementById('customersBackBtn')?.addEventListener('click', showDashboard);
  document.getElementById('hrBackBtn')?.addEventListener('click', showDashboard);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dropdown?.classList.remove('active');
  });
}

function setActiveAdminMenu(activeId) {
  ['adminMenuDashboard', 'adminMenuCustomers', 'adminMenuHr'].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    const active = id === activeId;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

// ─── HR / Employee Securities ───────────────────────────────────────────────
let hrEmployees = [];

function setHrMessage(text, isError = false) {
  const el = document.getElementById('hrMessage');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
}

async function fetchHrEmployees() {
  const list = document.getElementById('hrEmployeeList');
  if (!list) return;
  const summary = document.getElementById('hrEmployeeCount');
  if (summary) summary.textContent = 'Loading staff and security details…';
  list.innerHTML = '<div class="directory-empty">Loading employee records…</div>';
  setHrMessage('');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/hr/employees', { headers: getStoreHeaders(), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Unable to load employee records.');
      error.status = response.status;
      throw error;
    }
    if (!Array.isArray(data.employees)) throw new Error('The employee service returned data in an unexpected format.');
    hrEmployees = data.employees;
    renderHrEmployees();
    setHrMessage('');
  } catch (err) {
    const message = controller.signal.aborted
      ? 'Employee records took too long to load. Please retry.'
      : err.status === 403
      ? 'Your role does not have permission to view employee records.'
      : err.status === 401
        ? 'Your admin session expired. Please sign in again.'
        : err.message || 'Unable to load employee records.';
    list.innerHTML = `<div class="directory-empty" role="status">${escapeHtml(message)}</div>`;
    if (summary) summary.textContent = err.status === 403 ? 'Employee security details are restricted to authorized HR roles.' : 'Employee details could not be loaded.';
    setHrMessage(err.status === 401 ? message : '', err.status !== 401);
    if (err.status === 401) {
      localStorage.removeItem('deviceToken');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('username');
      showAuthScreen();
      setAuthMessage(message, true);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

const HR_ROLE_LABELS = { admin: 'Main admin', franchise_admin: 'Franchise Employee Admin', store_admin: 'Store admin (restricted)' };

function renderHrEmployees() {
  const list = document.getElementById('hrEmployeeList');
  const summary = document.getElementById('hrEmployeeCount');
  if (!hrEmployees.length) {
    if (summary) summary.textContent = '0 staff accounts';
    list.innerHTML = '<div class="directory-empty">No employee accounts are configured for this store.</div>';
    return;
  }
  if (summary) summary.textContent = `${hrEmployees.length} staff accounts`;
  list.innerHTML = hrEmployees.map(emp => {
    const restrictedNotify = Array.isArray(emp.restrictions) && emp.restrictions.includes('notifyAll');
    const roleLabel = HR_ROLE_LABELS[emp.role] || formatStatus(emp.role);
    const deviceCount = Number(emp.trustedDeviceCount || 0);
    const lastSeen = emp.trustedDeviceLastSeen ? formatDateTime(emp.trustedDeviceLastSeen) : 'No trusted device activity';
    const otherRestrictions = Array.isArray(emp.restrictions)
      ? emp.restrictions.filter(action => action !== 'notifyAll')
      : [];
    const restrictions = otherRestrictions.length
      ? otherRestrictions.map(formatStatus).join(', ')
      : 'No additional restrictions';
    const canEditEmployee = localStorage.getItem('userRole') === 'admin' || emp.role !== 'admin';
    const canRestrictEmployee = emp.role !== 'admin';
    return `
    <article class="panel hr-employee-card">
      <h3>${escapeHtml(emp.username || 'Unknown')}</h3>
      <p class="user-meta">${escapeHtml(emp.email || '')} · ${escapeHtml(emp.phone || 'N/A')}</p>
      <p class="user-meta">NRC: ${escapeHtml(emp.nrc || 'N/A')} · Role: <strong>${escapeHtml(roleLabel)}</strong></p>
      <details class="hr-security-details">
        <summary>Security &amp; permissions</summary>
        <dl>
          <div><dt>Store</dt><dd>${escapeHtml(getStoreName(emp.storeId) || formatStatus(emp.storeId || 'buraza'))}</dd></div>
          <div><dt>Account created</dt><dd>${escapeHtml(formatDate(emp.createdAt))}</dd></div>
          <div><dt>Trusted devices</dt><dd>${deviceCount} registered · ${escapeHtml(lastSeen)}</dd></div>
          <div><dt>Bulk customer notifications</dt><dd>${restrictedNotify ? 'Restricted' : 'Allowed'}</dd></div>
          <div><dt>Other restrictions</dt><dd>${escapeHtml(restrictions)}</dd></div>
        </dl>
      </details>
      <div class="button-row" style="margin-top:10px;">
        ${canEditEmployee ? `<button type="button" class="toggle-mode" data-hr-edit="${escapeHtml(emp.id)}">Edit</button>` : ''}
        ${canRestrictEmployee ? `<button type="button" class="toggle-mode" data-hr-restrict="${escapeHtml(emp.id)}" data-restricted="${restrictedNotify ? '1' : '0'}">
          ${restrictedNotify ? 'Allow customer broadcasts' : 'Restrict customer broadcasts'}
        </button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function openEditEmployee(id) {
  const emp = hrEmployees.find(e => String(e.id) === String(id));
  if (!emp) return;
  document.getElementById('editEmployeeId').value = emp.id;
  document.getElementById('editEmployeeName').value = emp.username || '';
  document.getElementById('editEmployeeEmail').value = emp.email || '';
  document.getElementById('editEmployeePhone').value = emp.phone || '';
  document.getElementById('editEmployeeNrc').value = emp.nrc || '';
  document.getElementById('editEmployeePassword').value = '';
  document.getElementById('editEmployeeMessage').textContent = '';
  document.getElementById('editEmployeeModal').style.display = 'block';
}

function closeEditEmployeeModal() {
  document.getElementById('editEmployeeModal').style.display = 'none';
}

async function submitEditEmployee(event) {
  event.preventDefault();
  const id = document.getElementById('editEmployeeId').value;
  const payload = {
    username: document.getElementById('editEmployeeName').value.trim(),
    email: document.getElementById('editEmployeeEmail').value.trim(),
    phone: document.getElementById('editEmployeePhone').value.trim(),
    nrc: document.getElementById('editEmployeeNrc').value.trim(),
    password: document.getElementById('editEmployeePassword').value
  };
  const msg = document.getElementById('editEmployeeMessage');
  try {
    const response = await fetch(`/hr/employees/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getStoreHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to update employee.');
    msg.textContent = data.message || 'Employee updated.';
    msg.style.color = 'var(--success)';
    await fetchHrEmployees();
    setTimeout(closeEditEmployeeModal, 800);
  } catch (err) {
    msg.textContent = err.message || 'Update failed.';
    msg.style.color = 'var(--danger)';
  }
}

async function toggleEmployeeRestriction(id, currentlyRestricted) {
  try {
    const response = await fetch(`/hr/employees/${id}/restrictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getStoreHeaders() },
      body: JSON.stringify({ action: 'notifyAll', restricted: !currentlyRestricted })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to update permissions.');
    setHrMessage(data.message || 'Permissions updated.');
    await fetchHrEmployees();
  } catch (err) {
    setHrMessage(err.message || 'Update failed.', true);
  }
}

async function requestStoreSwitchOtp() {
  const area = document.getElementById('hrSwitchArea');
  const info = document.getElementById('hrSwitchInfo');
  const storeId = document.getElementById('hrSwitchStore').value;
  area.classList.remove('hidden');
  info.textContent = 'Requesting approval code...';
  try {
    const response = await fetch('/hr/store-switch/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getStoreHeaders() },
      body: JSON.stringify({ storeId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to request a switch.');
    if (data.otpRequired) {
      info.textContent = data.message || 'Approval code sent to the franchise admin.';
    } else {
      // The signed-in admin already has access to this store (or is the main
      // admin) — switch straight away, no code needed.
      area.classList.add('hidden');
      info.textContent = data.message || 'Switch approved — no code needed.';
      enterStore(data.storeId || storeId);
    }
  } catch (err) {
    info.textContent = err.message || 'Request failed.';
  }
}

async function verifyStoreSwitchOtp(event) {
  event.preventDefault();
  const otp = document.getElementById('hrSwitchOtp').value.trim();
  const storeId = document.getElementById('hrSwitchStore').value;
  const info = document.getElementById('hrSwitchInfo');
  try {
    const response = await fetch('/hr/store-switch/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getStoreHeaders() },
      body: JSON.stringify({ otp, storeId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Verification failed.');
    info.textContent = data.message || 'Store switch approved.';
    if (data.storeId) {
      localStorage.setItem('adminStore', data.storeId);
      setTimeout(() => window.location.reload(), 700);
    }
  } catch (err) {
    info.textContent = err.message || 'Verification failed.';
  }
}

// ─── Add New Loan (admin manual entry) ───────────────────────────────────────
function openAddLoanModal() {
  const select = document.getElementById('addLoanCustomer');
  select.innerHTML = '<option value="">Select a customer…</option>' +
    allUsers
      .filter(user => !['admin', 'franchise_admin', 'store_admin'].includes(user.role))
      .map(user => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.username || '')} — ${escapeHtml(user.email || '')}</option>`)
      .join('');
  document.getElementById('addLoanFeedback').textContent = '';
  updateAddLoanPreview();
  document.getElementById('addLoanModal').style.display = 'block';
}

function closeAddLoanModal() {
  document.getElementById('addLoanModal').style.display = 'none';
  document.getElementById('addLoanForm').reset();
  document.getElementById('addLoanFeedback').textContent = '';
}

function weeklyRate(weeks) {
  // Must match backend calculateInterest (AGENTS.md fixed BMF ladder).
  const ladder = { 1: 0.10, 2: 0.16, 3: 0.24, 4: 0.32 };
  return ladder[weeks] ?? 0.10;
}

function updateAddLoanPreview() {
  const amount = Number(document.getElementById('addLoanAmount').value) || 0;
  const weeks = parseInt(document.getElementById('addLoanTenure').value, 10) || 1;
  const interest = amount * weeklyRate(weeks);
  const total = amount + interest;
  document.getElementById('addLoanInterest').value = formatCurrency(interest);
  document.getElementById('addLoanTotal').value = formatCurrency(total);
  const dueField = document.getElementById('addLoanDueDate');
  if (!dueField.value) {
    dueField.value = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

async function handleAddLoanSubmit(event) {
  event.preventDefault();
  const feedback = document.getElementById('addLoanFeedback');
  const email = document.getElementById('addLoanCustomer').value;
  const product = document.getElementById('addLoanProduct').value.trim();
  if (!email) { feedback.textContent = 'Select a customer.'; return; }
  if (!product) { feedback.textContent = 'Enter a product / collateral description.'; return; }

  const formData = new FormData();
  formData.append('email', email);
  formData.append('product', product);
  formData.append('amount', document.getElementById('addLoanAmount').value);
  formData.append('tenureWeeks', document.getElementById('addLoanTenure').value);
  formData.append('urgency', document.getElementById('addLoanUrgency').value);
  formData.append('paymentMode', document.getElementById('addLoanDisbursement').value);
  formData.append('dueDate', document.getElementById('addLoanDueDate').value);
  formData.append('collateralGrade', document.getElementById('addLoanCollateralGrade').value);
  formData.append('collateralDescription', product);
  formData.append('adminReason', document.getElementById('addLoanNotes').value.trim());
  const front = document.getElementById('addLoanCollateralFront').files[0];
  const back = document.getElementById('addLoanCollateralBack').files[0];
  if (front) formData.append('collateralFront', front);
  if (back) formData.append('collateralBack', back);

  feedback.textContent = 'Creating loan…';
  try {
    const response = await fetch('/admin/loans', {
      method: 'POST',
      headers: getStoreHeaders(),
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to create the loan.');
    feedback.textContent = `Loan ${data.loan?.receiptNumber || ''} created (active).`;
    await fetchNewRequests();
    setTimeout(closeAddLoanModal, 900);
  } catch (err) {
    feedback.textContent = err.message || 'Unable to create the loan.';
  }
}

document.getElementById('modeBtn').addEventListener('click', toggleTheme);
document.querySelectorAll('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => {
    const modalId = button.dataset.closeModal;
    if (modalId === 'userModal') closeModal();
    if (modalId === 'createUserModal') closeCreateUserModal();
    if (modalId === 'announcementModal') closeAnnouncementModal();
    if (modalId === 'addLoanModal') closeAddLoanModal();
    if (modalId === 'inviteModal') closeInviteModal();
    if (modalId === 'editEmployeeModal') closeEditEmployeeModal();
  });
});
document.querySelectorAll('[data-store]').forEach(button => {
  button.addEventListener('click', () => enterStore(button.dataset.store));
});
document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
document.getElementById('adminOtpForm').addEventListener('submit', handleAdminOtp);
document.getElementById('showPasswordReset').addEventListener('click', showPasswordResetRequest);
document.getElementById('passwordResetRequestForm').addEventListener('submit', requestAdminPasswordReset);
document.getElementById('passwordResetConfirmForm').addEventListener('submit', confirmAdminPasswordReset);
document.getElementById('resendResetOtp').addEventListener('click', () => requestAdminPasswordReset());
document.querySelectorAll('[data-reset-back]').forEach(button => {
  button.addEventListener('click', () => {
    pendingResetEmail = '';
    showAdminLogin();
  });
});
document.getElementById('backToLogin').addEventListener('click', () => {
  showAdminLogin();
});
document.getElementById('backToStores').addEventListener('click', () => {
  pendingResetEmail = '';
  showAdminLogin();
  localStorage.removeItem('adminStore');
  showStoreSelection();
});
document.getElementById('logoutBtn').addEventListener('click', logoutAdmin);
document.getElementById('backToStoresDashboard').addEventListener('click', () => {
  if (BMF_STORES.length < 2) return;
  localStorage.removeItem('adminStore');
  showStoreSelection();
});
document.getElementById('createUserBtn').addEventListener('click', () => {
  openCreateUserModal('customer');
});
document.getElementById('announcementBtn').addEventListener('click', () => {
  document.getElementById('announcementModal').style.display = 'block';
});
document.querySelectorAll('[data-report-format]').forEach(button => {
  button.addEventListener('click', () => downloadReport(button.dataset.reportFormat));
});

// ─── Report panel: scope / type / period / refresh ──────────────────────────
const reportScopeEl = document.getElementById('reportScope');
const reportFromEl = document.getElementById('reportFrom');
const reportToEl = document.getElementById('reportTo');
const refreshReportBtn = document.getElementById('refreshReportBtn');

// Hide franchise-level scope for non-admin roles
const role = localStorage.getItem('userRole') || '';
if (reportScopeEl) {
  const allOption = reportScopeEl.querySelector('option[value="all"]');
  if (allOption && role !== 'admin' && role !== 'franchise_admin') {
    allOption.hidden = true;
    if (reportScope === 'all') reportScope = 'buraza';
  }
  reportScopeEl.addEventListener('change', () => {
    reportScope = reportScopeEl.value;
    fetchReportData();
  });
}

document.querySelectorAll('[data-report-type]').forEach(button => {
  button.addEventListener('click', () => {
    reportType = button.dataset.reportType;
    document.querySelectorAll('[data-report-type]').forEach(b => {
      b.classList.toggle('active', b === button);
    });
    fetchReportData();
  });
});

if (reportFromEl) {
  reportFromEl.addEventListener('change', () => {
    reportFrom = reportFromEl.value;
    fetchReportData();
  });
}
if (reportToEl) {
  reportToEl.addEventListener('change', () => {
    reportTo = reportToEl.value;
    fetchReportData();
  });
}
if (refreshReportBtn) {
  refreshReportBtn.addEventListener('click', () => runRefresh(refreshReportBtn, fetchReportData));
}
document.querySelectorAll('[data-feedback-filter]').forEach(button => {
  button.addEventListener('click', () => {
    activeFeedbackFilter = button.dataset.feedbackFilter || 'all';
    document.querySelectorAll('[data-feedback-filter]').forEach(filterButton => {
      filterButton.classList.toggle('active', filterButton === button);
    });
    renderStoreFeedback();
  });
});
document.getElementById('storeFeedbackList').addEventListener('click', event => {
  const button = event.target.closest('[data-feedback-id]');
  if (button) updateStoreFeedback(button.dataset.feedbackId, button.dataset.feedbackStatus);
});
document.getElementById('announcementForm').addEventListener('submit', handleAnnouncementSubmit);
document.getElementById('notifyOverdueBtn').addEventListener('click', notifyAllOverdue);
document.getElementById('createUserForm').addEventListener('submit', handleCreateUser);
document.getElementById('addLoanBtn').addEventListener('click', openAddLoanModal);
document.getElementById('addLoanForm').addEventListener('submit', handleAddLoanSubmit);
document.getElementById('addLoanAmount').addEventListener('input', updateAddLoanPreview);
document.getElementById('addLoanTenure').addEventListener('change', updateAddLoanPreview);
document.getElementById('inviteBtn').addEventListener('click', openInviteModal);
document.getElementById('inviteForm').addEventListener('submit', handleInviteSubmit);
document.querySelectorAll('[data-export-table]').forEach(button => {
  button.addEventListener('click', () => {
    const kind = button.dataset.exportTable;
    if (button.dataset.exportFormat === 'pdf') exportTablePdf(kind);
    else exportTableCsv(kind);
  });
});
document.getElementById('userList').addEventListener('click', event => {
  const button = event.target.closest('[data-user-id]');
  if (button) viewUserDetails(button.dataset.userId);
});

// ─── HR / menu event wiring ─────────────────────────────────────────────────
setupAdminMenu();
document.getElementById('hrRefreshBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchHrEmployees));
document.getElementById('hrCreateBtn')?.addEventListener('click', () => {
  openCreateUserModal('hr');
});
document.getElementById('hrSwitchStoreBtn')?.addEventListener('click', requestStoreSwitchOtp);
document.getElementById('hrSwitchForm')?.addEventListener('submit', verifyStoreSwitchOtp);
document.getElementById('editEmployeeForm')?.addEventListener('submit', submitEditEmployee);
document.getElementById('hrEmployeeList')?.addEventListener('click', event => {
  const editBtn = event.target.closest('[data-hr-edit]');
  if (editBtn) { openEditEmployee(editBtn.dataset.hrEdit); return; }
  const restrictBtn = event.target.closest('[data-hr-restrict]');
  if (restrictBtn) {
    toggleEmployeeRestriction(restrictBtn.dataset.hrRestrict, restrictBtn.dataset.restricted === '1');
  }
});

document.getElementById('modalBody').addEventListener('click', event => {
  const paymentReview = event.target.closest('[data-payment-review]');
  if (paymentReview) {
    reviewPaymentSubmission(paymentReview.dataset.loanId, paymentReview.dataset.submissionId, paymentReview.dataset.paymentReview);
    return;
  }
  if (event.target.closest('[data-notify-user]')) {
    notifySelectedUser();
    return;
  }

  const requestButton = event.target.closest('[data-request-user]');
  if (requestButton) {
    if (requestButton.dataset.requestUser) viewUserDetails(requestButton.dataset.requestUser);
    return;
  }

  const timeframeButton = event.target.closest('[data-timeframe]');
  if (timeframeButton) {
    activeTimeframeFilter = timeframeButton.dataset.timeframe;
    renderSelectedUser();
    return;
  }

  const filterButton = event.target.closest('[data-loan-filter]');
  if (filterButton) {
    activeLoanFilter = filterButton.dataset.loanFilter;
    renderSelectedUser();
    return;
  }

  const actionButton = event.target.closest('[data-loan-action]');
  if (actionButton) {
    const reasonInput = document.querySelector(`[data-decision-reason="${actionButton.dataset.loanId}"]`);
    const graceInput = document.querySelector(`[data-grace-date="${actionButton.dataset.loanId}"]`);
    updateLoanStatus(actionButton.dataset.loanId, actionButton.dataset.loanAction, reasonInput?.value, graceInput?.value);
  }
});

async function reviewPaymentSubmission(loanId, submissionId, decision) {
  let reason;
  if (decision === 'approve' && !window.confirm('Confirm you inspected the proof image and verified this transaction with the bank or mobile money provider. Approving will update the customer balance.')) return;
  if (decision === 'decline') {
    reason = window.prompt('Reason for declining this payment proof:');
    if (reason === null) return;
    if (reason.trim().length < 3) {
      document.getElementById('detailFeedback').textContent = 'A clear decline reason is required.';
      return;
    }
  }
  try {
    const response = await fetch(`/loans/${encodeURIComponent(loanId)}/payment-submissions/${encodeURIComponent(submissionId)}/${decision}`, {
      method: 'POST', headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(decision === 'decline' ? { reason } : { physicalVerificationConfirmed: true })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not review payment proof.');
    document.getElementById('detailFeedback').textContent = `BMF success: ${result.message}`;
    showAdminSuccess(result.message);
    if (selectedUserId !== null) await viewUserDetails(selectedUserId);
    await fetchNewRequests();
  } catch (error) {
    document.getElementById('detailFeedback').textContent = error.message || 'Could not review payment proof.';
  }
}
document.getElementById('modalBody').addEventListener('change', event => {
  if (event.target.id === 'timeframeFrom') {
    customTimeframeFrom = event.target.value;
    activeTimeframeFilter = 'custom';
    renderSelectedUser();
  } else if (event.target.id === 'timeframeTo') {
    customTimeframeTo = event.target.value;
    activeTimeframeFilter = 'custom';
    renderSelectedUser();
  }
});
document.getElementById('modalBody').addEventListener('submit', event => {
  const form = event.target.closest('[data-payment-form]');
  if (form) submitPayment(event, form);
});
function applyUserFilterAndSort() {
  const term = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const sortBy = document.getElementById('userSort')?.value || 'name';
  let filtered = allUsers.filter((user) => {
    const username = (user.username || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    const phone = String(user.phone || '').toLowerCase();
    return username.includes(term) || email.includes(term) || phone.includes(term);
  });
  if (sortBy === 'loans') {
    filtered = filtered.slice().sort((a, b) => getCustomerLoanStats(b.email).count - getCustomerLoanStats(a.email).count);
  } else if (sortBy === 'outstanding') {
    filtered = filtered.slice().sort((a, b) => getCustomerLoanStats(b.email).outstanding - getCustomerLoanStats(a.email).outstanding);
  } else {
    filtered = filtered.slice().sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
  }
  renderUsers(filtered);
}
document.getElementById('userSearch').addEventListener('input', applyUserFilterAndSort);
document.getElementById('userSort')?.addEventListener('change', applyUserFilterAndSort);
document.getElementById('refreshCustomerDirectory')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchUsers));
document.getElementById('refreshRequestsBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchNewRequests));
document.getElementById('refreshPortfolioBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchNewRequests));
document.getElementById('adminDashboard')?.addEventListener('click', event => {
  const button = event.target.closest('[data-admin-jump]');
  if (button) document.getElementById(button.dataset.adminJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('jumpCustomersBtn')?.addEventListener('click', showCustomersView);
document.getElementById('adminDashboardSearch')?.addEventListener('input', renderPortfolioOverview);
document.getElementById('dailyReportQuickBtn')?.addEventListener('click', () => {
  reportType = 'daily';
  downloadReport('xlsx');
});
document.getElementById('adminLoanTable')?.addEventListener('click', event => {
  const notifyButton = event.target.closest('[data-notify-loan]');
  if (notifyButton) {
    sendOverdueNotice(notifyButton.dataset.notifyLoan);
    return;
  }
  const userButton = event.target.closest('[data-user-id]');
  if (userButton?.dataset.userId) viewUserDetails(userButton.dataset.userId);
});
document.getElementById('adminNotificationBtn')?.addEventListener('click', async event => {
  event.stopPropagation();
  const menu = document.getElementById('adminNotificationMenu');
  const open = menu.classList.toggle('hidden') === false;
  event.currentTarget.setAttribute('aria-expanded', String(open));
  if (open) await fetchAdminNotifications();
});
document.addEventListener('click', event => {
  const menu = document.getElementById('adminNotificationMenu');
  const anchor = document.querySelector('.notification-anchor');
  if (menu && anchor && !anchor.contains(event.target)) {
    menu.classList.add('hidden');
    document.getElementById('adminNotificationBtn')?.setAttribute('aria-expanded', 'false');
  }
});
document.getElementById('adminNotificationList')?.addEventListener('click', event => {
  const review = event.target.closest('[data-notification-open-loan]');
  if (!review) return;
  const loan = portfolioLoans.find(item => String(item.id) === String(review.dataset.notificationOpenLoan));
  const customer = loan ? findCustomerForLoan(loan) : null;
  markAdminNotificationRead(review.dataset.notificationId);
  if (customer) viewUserDetails(customer.id);
  else document.getElementById('requestQueue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('adminNotificationMenu')?.classList.add('hidden');
});
document.getElementById('markAllNotificationsRead')?.addEventListener('click', async () => {
  const unread = adminNotifications.filter(item => !item.readAt);
  for (const item of unread) await markAdminNotificationRead(item.id);
});
document.getElementById('newRequestsList').addEventListener('click', event => {
  const requestButton = event.target.closest('[data-request-user]');
  if (requestButton && requestButton.dataset.requestUser) {
    viewUserDetails(requestButton.dataset.requestUser);
  }
});

// ─── Invite Links ────────────────────────────────────────────────────────────
function openInviteModal() {
  document.getElementById('inviteLinkResult').textContent = '';
  document.getElementById('inviteFeedback').textContent = '';
  document.getElementById('inviteModal').style.display = 'block';
  fetchInvites();
}

function closeInviteModal() {
  document.getElementById('inviteModal').style.display = 'none';
  document.getElementById('inviteForm').reset();
}

async function handleInviteSubmit(event) {
  event.preventDefault();
  const feedback = document.getElementById('inviteFeedback');
  const result = document.getElementById('inviteLinkResult');
  const email = document.getElementById('inviteEmail').value.trim();
  if (!email) { feedback.textContent = 'Enter a customer email.'; return; }
  feedback.textContent = 'Generating link…';
  try {
    const response = await fetch('/invites/create', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to generate the invite.');
    feedback.textContent = data.message || 'Invite generated.';
    result.innerHTML = `Signup link: <a href="${escapeHtml(data.signupUrl || '')}" target="_blank" rel="noopener">${escapeHtml(data.signupUrl || '')}</a>`;
    document.getElementById('inviteForm').reset();
    await fetchInvites();
  } catch (err) {
    feedback.textContent = err.message || 'Unable to generate the invite.';
  }
}

async function fetchInvites() {
  const list = document.getElementById('inviteList');
  try {
    const response = await fetch('/invites', { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load invites.');
    const invites = Array.isArray(data.invites) ? data.invites : [];
    if (!invites.length) {
      list.innerHTML = '<p>No pending invite links.</p>';
      return;
    }
    list.innerHTML = invites.map(invite => `
      <div class="request-row">
        <div>
          <p><strong>${escapeHtml(invite.email)}</strong></p>
          <p class="user-meta">Expires: ${escapeHtml(formatDate(invite.expiresAt))}</p>
        </div>
        <div class="button-row">
          <a class="toggle-mode" href="${escapeHtml(invite.signupUrl)}" target="_blank" rel="noopener">Open link</a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load invites.')}</p>`;
  }
}

// Resume a live admin session on refresh: only when both a device token and a
// chosen store exist do we validate the token and re-enter the store, so a
// refresh keeps the admin on the dashboard instead of logging them out to the
// store picker / login screen. Any failure or missing token shows login — never
// the store picker with a half-validated session.
async function restoreSession() {
  const token = getDeviceToken();
  const store = localStorage.getItem('adminStore');
  if (!token || !isKnownStore(store)) {
    showStoreSelection();
    return;
  }
  try {
    const response = await fetch('/users', { headers: getStoreHeaders() });
    if (!response.ok) {
      showAuthScreen();
      return;
    }
    // Token valid — re-enter the store and rebuild the dashboard + identity.
    enterStore(store);
  } catch (err) {
    showAuthScreen();
  }
}

window.onload = () => {
  const savedMode = localStorage.getItem('mode') === 'light' ? 'light' : 'dark';
  applyTheme(savedMode);
  restoreSession();
};

window.addEventListener('storage', event => {
  if (event.key === 'mode') applyTheme(event.newValue === 'light' ? 'light' : 'dark');
});

window.closeModal = closeModal;
window.closeCreateUserModal = closeCreateUserModal;
window.closeAnnouncementModal = closeAnnouncementModal;
window.viewUserDetails = viewUserDetails;
window.sendOverdueNotice = sendOverdueNotice;
