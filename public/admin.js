let allUsers = [];
let registeredUsers = [];
let customerApplications = [];
let customerLoans = [];
let customerLoansError = '';
let customerLoansLoaded = false;
let selectedUserId = null;
let selectedUser = null;
let selectedLoans = [];
let activeLoanFilter = 'all';
// Timeframe filter for the selected customer (Option 3: approval/borrowed date,
// falling back to the request date for loans that are not approved yet).
let activeTimeframeFilter = 'all';
let customTimeframeFrom = '';
let customTimeframeTo = '';

const REPORT_LIBRARY = [
  { type: 'how-risky', title: 'How Risky Are Our Loans?', description: 'Shows which loans are overdue and by how long', source: 'par', filenamePrefix: 'bmf_how_risky' },
  { type: 'who-owes', title: 'Who Owes What and How Late?', description: 'Lists every borrower\'s arrears in time buckets', source: 'aging', filenamePrefix: 'bmf_who_owes' },
  { type: 'full-history', title: 'One Borrower\'s Full History', description: 'Every payment made and still owed for one loan', source: 'statement', filenamePrefix: 'bmf_full_history', borrowerSearch: true, periodFilter: false },
  { type: 'all-loans', title: 'All Loans We Gave Out This Period', description: 'Every loan issued in a date range', source: 'disbursements', filenamePrefix: 'bmf_all_loans' },
  { type: 'schedule', title: 'Payment Schedule Per Loan', description: 'Instalment-by-instalment plan for one loan', source: 'schedule', filenamePrefix: 'bmf_schedule', borrowerSearch: true, periodFilter: false },
  { type: 'collection', title: 'How Well Is Money Being Collected?', description: 'Officer performance vs CGAP target', source: 'collection', filenamePrefix: 'bmf_collection' },
  { type: 'problem-loans', title: 'Problem Loans & Write-Offs', description: 'Every defaulted loan and net loss', source: 'defaults', filenamePrefix: 'bmf_problem_loans' },
  { type: 'daily-cashbook', title: 'Daily Money In and Out', description: 'Cashbook — every receipt and disbursement', source: 'cashbook', filenamePrefix: 'bmf_daily_cashbook' },
  { type: 'officer-scorecard', title: 'Officer Scorecard', description: 'KPIs for each loan officer vs MIX Market targets', source: 'officers', filenamePrefix: 'bmf_officer_scorecard' }
];
let storeFeedback = [];
let activeFeedbackFilter = 'all';
let portfolioLoans = [];
let portfolioLoaded = false;
let paymentRecords = [];
let paymentsLoading = false;
let pendingPaymentReviews = [];
let allApplications = [];
let pendingEmail = '';
let pendingResetEmail = '';
let adminToastTimer;
let portfolioRefreshTimer = null;
let bellRefreshTimer = null;
let adminNotifications = [];
let activeCollectionRange = '1M';
let customCollectionFrom = '';
let customCollectionTo = '';
let loanTablePage = 1;
const LOAN_TABLE_PAGE_SIZE = 10;
let usersLoaded = false;
let usersLoading = false;
let usersRequestController = null;
let createUserMode = 'customer';
const DIRECTORY_PAGE_SIZE = 15;
const CUSTOMER_DIRECTORY_PAGE_SIZE = 50;
const PAYMENT_DIRECTORY_PAGE_SIZE = 20;
const LOAN_DIRECTORY_PAGE_SIZE = 20;
let customerDirectoryPage = 1;
let hrDirectoryPage = 1;
let applicationDirectoryPage = 1;
const loanDirectoryPages = { allLoansView: 1, overdueView: 1, defaultersView: 1 };
let paymentDirectoryPage = 1;
let showAllAdminNotifications = false;
let activeAdminPage = 'portfolioOverview';
let createUserReturnPage = 'portfolioOverview';
let adminPageHistory = [];

function openCreateUserModal(mode = 'customer') {
  createUserReturnPage = activeAdminPage || 'portfolioOverview';
  createUserMode = mode === 'hr' ? 'hr' : 'customer';
  const title = document.getElementById('createUserTitle');
  const roleSelect = document.getElementById('newUserRole');
  const customerRole = roleSelect.querySelector('option[value="user"]');
  if (customerRole) customerRole.hidden = createUserMode === 'hr';
  if (title) title.textContent = createUserMode === 'hr' ? 'Create Staff Account' : 'Create New User';
  roleSelect.value = createUserMode === 'hr' ? 'store_admin' : 'user';
  showAdminPage('createUserView');
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

function showBmfToast(message, kind = 'success') {
  const toast = document.getElementById('bmfToast') || (() => {
    const el = document.createElement('div');
    el.id = 'bmfToast';
    el.style.position = 'fixed';
    el.style.right = '20px';
    el.style.bottom = '20px';
    el.style.zIndex = '9999';
    el.style.maxWidth = '360px';
    el.style.padding = '12px 16px';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 18px 30px rgba(0,0,0,0.2)';
    el.style.background = kind === 'error' ? '#c0392b' : '#1f7a54';
    el.style.color = '#fff';
    el.style.fontWeight = '600';
    document.body.appendChild(el);
    return el;
  })();

  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.style.background = kind === 'error' ? '#c0392b' : '#1f7a54';
  toast.style.display = 'block';
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, 4200);
}

function getReportConfig(reportType) {
  return REPORT_LIBRARY.find(report => report.type === reportType) || REPORT_LIBRARY[0];
}

function renderReportLibrary() {
  const list = document.getElementById('reportLibrary');
  if (!list) return;

  const officerOptions = (portfolioLoans || []).map(loan => loan.officer || loan.assignedOfficer || loan.createdBy)
    .filter(Boolean)
    .map(String)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort();

  list.innerHTML = REPORT_LIBRARY.map((report) => `
    <article class="report-card" data-report-card="${report.type}">
      <h3>${escapeHtml(report.title)}</h3>
      <p>${escapeHtml(report.description)}</p>
      <div class="report-fields">
        ${report.periodFilter === false
          ? `<p class="report-period-note">${report.type === 'schedule'
            ? 'Includes all scheduled installments for the selected loan; date filters do not apply.'
            : 'Includes the selected loan\'s complete payment history; date filters do not apply.'}</p>`
          : `
            <label>
              <span>From</span>
              <input type="date" data-report-from>
            </label>
            <label>
              <span>To</span>
              <input type="date" data-report-to>
            </label>
            <label class="wide">
              <span>Officer</span>
              <select data-report-officer>
                <option value="">All officers</option>
                ${officerOptions.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
              </select>
            </label>
          `}
        ${report.borrowerSearch ? `
          <label class="wide">
            <span>Borrower search</span>
            <input type="search" data-report-borrower placeholder="Search by name, email, or loan ID">
          </label>
        ` : ''}
      </div>
      <div class="report-actions">
        <button type="button" class="toggle-mode" data-report-action data-report-type="${report.type}" data-report-format="xlsx">⬇ Download Excel</button>
        <button type="button" class="toggle-mode" data-report-action data-report-type="${report.type}" data-report-format="pdf">📄 Download PDF</button>
      </div>
      <div class="last-generated">Last generated: —</div>
    </article>
  `).join('');

  list.querySelectorAll('[data-report-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const { reportType, reportFormat: format } = button.dataset;
      const card = button.closest('[data-report-card]');
      if (!card) return;
      const from = card.querySelector('[data-report-from]')?.value || '';
      const to = card.querySelector('[data-report-to]')?.value || '';
      const officer = card.querySelector('[data-report-officer]')?.value || '';
      const borrower = card.querySelector('[data-report-borrower]')?.value || '';
      await pullReport(reportType, format, { from, to, officer, borrower, card });
    });
  });
}

async function pullReport(reportType, format, params = {}) {
  if (!['xlsx', 'pdf'].includes(format)) {
    showBmfToast('Choose Excel or PDF before generating the report.', 'error');
    return;
  }
  const config = getReportConfig(reportType);
  const sourceType = config.source || reportType;
  const qs = new URLSearchParams({ format });

  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.officer) qs.set('officer', params.officer);
  const scope = localStorage.getItem('adminStore') || 'buraza';
  qs.set('scope', scope);

  if (reportType === 'full-history' || reportType === 'schedule') {
    if (!params.borrower) {
      showBmfToast('Search for a borrower or loan ID before downloading this report.', 'error');
      return;
    }
    const matches = (portfolioLoans || []).filter(loan => {
      const email = String(loan.email || '').toLowerCase();
      const receipt = String(loan.receiptNumber || loan.id || '').toLowerCase();
      const borrowerText = String(params.borrower || '').toLowerCase();
      const customer = (allUsers || []).find(user => String(user.email || '').toLowerCase() === email) || {};
      return email.includes(borrowerText) || receipt.includes(borrowerText) || String(customer.username || '').toLowerCase().includes(borrowerText);
    });

    if (!matches.length) {
      showBmfToast('No matching loan was found for that borrower search.', 'error');
      return;
    }
    if (matches.length > 1) {
      showBmfToast('More than one loan matches. Search by the exact loan receipt ID.', 'error');
      return;
    }

    qs.set('loanId', String(matches[0].id));
  }

  try {
    const res = await fetch(`/api/reports/${sourceType}?${qs.toString()}`, {
      headers: getStoreHeaders()
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showBmfToast(err.error || 'Could not generate report. Please try again.', 'error');
      return;
    }

    const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
    const expectedContentType = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!contentType.includes(expectedContentType)) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `The server returned ${contentType || 'an unknown format'} instead of ${format.toUpperCase()}.`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filenameMatch = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/i);
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fallbackName = `${config.filenamePrefix || sourceType}_${dateStamp}.${format}`;
    a.download = filenameMatch?.[1] || fallbackName;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const lastGenerated = params.card?.querySelector('.last-generated');
    if (lastGenerated) lastGenerated.textContent = `Last generated: ${new Date().toLocaleString('en-GB')}`;
    showBmfToast('Report downloaded successfully.');
  } catch (err) {
    showBmfToast(err.message || 'Could not generate report. Please try again.', 'error');
  }
}

function applyTheme(theme) {
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.remove('dark', 'light');
  document.body.classList.remove('dark', 'light');
  document.documentElement.classList.add(activeTheme);
  document.body.classList.add(activeTheme);
  const toggle = document.getElementById('adminThemeToggle');
  if (toggle) {
    const nextTheme = activeTheme === 'light' ? 'dark' : 'light';
    toggle.textContent = `Use ${nextTheme} theme`;
    toggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
  }
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
  setViewVisibility('adminDashboard', false);
  setAdminPageVisibility(null);
}

function setAdminPageVisibility(activeId) {
  document.querySelectorAll('#adminDashboard .admin-page').forEach(page => {
    const visible = page.id === activeId;
    page.hidden = !visible;
    page.classList.toggle('hidden', !visible);
    page.style.display = '';
  });
  activeAdminPage = activeId || '';
}

function ensureAdminPageBackButton(page) {
  if (page.id === 'portfolioOverview' || page.querySelector('[data-admin-back]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-page-back';
  button.dataset.adminBack = '';
  button.textContent = '← Back';
  button.setAttribute('aria-label', 'Return to the previous admin page');
  page.insertBefore(button, page.firstChild);
}

function showAdminPage(pageId, { recordHistory = true } = {}) {
  if (!ensureAdminAccess()) return false;
  const page = document.getElementById(pageId);
  if (!page || !page.classList.contains('admin-page')) {
    throw new Error(`Unknown admin page: ${pageId}`);
  }
  if (pageId === 'portfolioOverview') {
    adminPageHistory = [];
  } else if (recordHistory && activeAdminPage && activeAdminPage !== pageId) {
    adminPageHistory.push(activeAdminPage);
  }
  ensureAdminPageBackButton(page);
  setViewVisibility('storeSelect', false);
  setViewVisibility('adminAuth', false);
  setViewVisibility('adminDashboard', true);
  setAdminPageVisibility(pageId);
  const navButton = document.querySelector(`#adminSidebar [data-admin-page="${pageId}"]`);
  setDashboardNavActive(navButton || null);
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (pageId === 'paymentsView') fetchPayments();
  else if (pageId === 'customersView') fetchUsers();
  else if (pageId === 'hrView') fetchHrEmployees();
  else if (pageId === 'applicationsView') fetchApplications();
  else if (pageId === 'requestQueue') fetchNewRequests();
  else if (pageId === 'portfolioReports') renderReportLibrary();
  else if (pageId === 'feedbackDetails') fetchStoreFeedback();
  else if (pageId === 'serverSettingsView') initServerMode();
  else if (['allLoansView', 'overdueView', 'defaultersView'].includes(pageId)) {
    renderLoanDirectory(pageId);
    if (!portfolioLoaded) fetchNewRequests();
    if (!customerLoansLoaded) fetchCustomerLoans();
  }
  return true;
}

function goBackAdminPage() {
  const previous = adminPageHistory.pop() || 'portfolioOverview';
  showAdminPage(previous, { recordHistory: false });
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
  if (!showAdminPage('portfolioOverview')) return;
  renderLoggedInAdmin();
  renderReportLibrary();
  initServerMode();
  renderPortfolioOverview();
  if (portfolioRefreshTimer) clearInterval(portfolioRefreshTimer);
  portfolioRefreshTimer = setInterval(() => {
    if (activeAdminPage === 'portfolioOverview') fetchNewRequests();
  }, 30000);
  if (bellRefreshTimer) clearInterval(bellRefreshTimer);
  refreshBellCount();
  bellRefreshTimer = setInterval(refreshBellCount, 60000);
}

function showReportsView() {
  showAdminPage('portfolioReports');
}

function showCustomersView() {
  showAdminPage('customersView');
}

function showHrView() {
  showAdminPage('hrView');
}

async function showApplicationsView(applicationId = null) {
  if (!showAdminPage('applicationsView')) return;
  if (applicationId) {
    document.getElementById('applicationSearch').value = applicationId;
    document.getElementById('applicationStatusFilter').value = '';
    document.getElementById('applicationDateFrom').value = '';
    document.getElementById('applicationDateTo').value = '';
  }
  if (applicationId) {
    const card = [...document.querySelectorAll('#applicationsList [data-application-card]')]
      .find(element => element.dataset.applicationCard === String(applicationId));
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
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
  registeredUsers = [];
  customerLoans = [];
  customerLoansLoaded = false;
  customerLoansError = '';
  paymentRecords = [];
  paymentsLoading = false;
  usersLoaded = false;
  portfolioLoans = [];
  portfolioLoaded = false;
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

function getCustomerScopeHeaders(extraHeaders = {}) {
  if (localStorage.getItem('userRole') === 'admin') {
    return { 'x-device-token': getDeviceToken(), ...extraHeaders };
  }
  return getStoreHeaders(extraHeaders);
}

function addAllStoreScope(params) {
  if (localStorage.getItem('userRole') === 'admin') params.set('storeId', 'all');
  return params;
}

function dateMatchesRange(value, from, to) {
  if (!from && !to) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.toISOString().slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function getDirectoryPage(items, page, pageSize = DIRECTORY_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return {
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    currentPage,
    pageCount
  };
}

function renderDirectoryPagination(containerId, page, total, directory, pageSize = DIRECTORY_PAGE_SIZE) {
  const nav = document.getElementById(containerId);
  if (!nav) return;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  nav.innerHTML = pageCount > 1 ? `
    <button type="button" class="toggle-mode" data-directory-page="${directory}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
    <span>Page ${currentPage} of ${pageCount} · ${total} records</span>
    <button type="button" class="toggle-mode" data-directory-page="${directory}" data-page="${currentPage + 1}" ${currentPage === pageCount ? 'disabled' : ''}>Next</button>
  ` : total ? `<span>${total} record${total === 1 ? '' : 's'}</span>` : '';
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
  const backButton = target && typeof target.closest === 'function'
    ? target.closest('[data-admin-back]')
    : null;
  if (backButton) {
    goBackAdminPage();
    return;
  }

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
  // Super admins (admin) have full access to all stores
  // Franchise admins and store admins have access per their store restrictions
  const isSuperAdmin = role === 'admin';
  const isStoreOperator = role === 'store_admin' && userStoreId === 'buraza';
  const isFranchiseAdmin = role === 'franchise_admin';
  
  if (!token) {
    showAuthScreen();
    return false;
  }
  
  // Allow: super admin, franchise admin, or store operator (store_admin on buraza)
  if (isSuperAdmin || isFranchiseAdmin || isStoreOperator) {
    return true;
  }
  
  // For other roles, hide admin views
  showAuthScreen();
  return false;
}

function applyRolePermissions() {
  const role = localStorage.getItem('userRole');
  // Super admins (admin) and franchise admins have absolute access to everything.
  // store_admin is restricted to their own store only.
  const isSuperAdmin = role === 'admin' || role === 'franchise_admin';
  const isStoreOperator = role === 'store_admin';
  const isFranchiseLevel = role === 'admin' || role === 'franchise_admin';
  
  document.getElementById('announcementBtn').hidden = !['store_admin', 'franchise_admin'].includes(role);
  document.getElementById('notifyOverdueBtn').hidden = false;
  
  // HR menu only for main admin and franchise level
  const sidebarHr = document.getElementById('adminSidebarHr');
  if (sidebarHr) sidebarHr.hidden = !isFranchiseLevel;
  const sidebarServerMode = document.getElementById('adminSidebarServerMode');
  if (sidebarServerMode) sidebarServerMode.hidden = !isFranchiseLevel;
  const sidebarSwitchStore = document.getElementById('adminSidebarSwitchStore');
  if (sidebarSwitchStore) sidebarSwitchStore.hidden = BMF_STORES.length < 2;
  const sidebarAnnouncement = document.querySelector('[data-admin-page="announcementView"]');
  if (sidebarAnnouncement) sidebarAnnouncement.hidden = !['store_admin', 'franchise_admin'].includes(role);
  
  // Switch store button: show if more than 1 store OR if super admin
  // Only franchise-level roles may create store admins; only the main admin may
  // create Franchise Employee Admins.
  document.querySelector('#newUserRole option[value="store_admin"]').hidden = !isFranchiseLevel;
  document.querySelector('#newUserRole option[value="franchise_admin"]').hidden = role !== 'admin';
  
  // Store selector: show only to super admins
  const storeSelector = document.getElementById('hrSwitchStore');
  if (storeSelector) storeSelector.hidden = !isSuperAdmin;
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
  if (directoryStatus) directoryStatus.textContent = 'Loading registered customer accounts…';
  if (userList) userList.innerHTML = '<div class="directory-empty" role="status">Loading customer records…</div>';

  try {
    const userParams = addAllStoreScope(new URLSearchParams());
    const response = await fetch(`/users?${userParams}`, {
      headers: getCustomerScopeHeaders(),
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
    registeredUsers = users.filter(user => !user.role || user.role === 'user');
    allUsers = registeredUsers.slice();
    usersLoaded = true;
    // Draw the directory as soon as its own endpoint succeeds. Feedback
    // and loan management enrich the cards, but a slow/failing
    // secondary endpoint must never leave valid customers invisible.
    applyUserFilterAndSort();
    if (directoryStatus) {
      directoryStatus.textContent = allUsers.length
        ? `${allUsers.length} registered customer records · loading loan details...`
        : 'No registered customer accounts were returned for this scope.';
    }
    const enrichmentResults = await Promise.allSettled([
      fetchStoreFeedback(),
      fetchNewRequests(),
      fetchCustomerLoans(),
      fetchCustomerApplications()
    ]);
    const loanDetailsLoaded = enrichmentResults[2].status === 'fulfilled' && enrichmentResults[2].value === true;
    const applicationDetailsLoaded = enrichmentResults[3].status === 'fulfilled' && enrichmentResults[3].value === true;
    if (directoryStatus) {
      directoryStatus.textContent = allUsers.length
        ? `${allUsers.length} customer records${loanDetailsLoaded ? ' · loan details loaded.' : ' · loan details are temporarily unavailable.'}${applicationDetailsLoaded ? ' · Quick Screen applicants included.' : ' · Quick Screen applicants could not be loaded.'}`
        : 'No registered customer accounts were returned for this scope.';
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
    renderDirectoryPagination('customerPagination', 1, 0, 'customers');
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
function mergeLoanOnlyCustomers(loans = customerLoans) {
  const knownEmails = new Set(registeredUsers.map(user => String(user.email || '').trim().toLowerCase()).filter(Boolean));
  const loanCustomers = new Map();
  loans.forEach(loan => {
    const email = String(loan.email || '').trim().toLowerCase();
    if (!email || knownEmails.has(email) || loanCustomers.has(email)) return;
    loanCustomers.set(email, {
      id: `loan-only:${email}`,
      email,
      username: loan.username || loan.borrowerName || loan.fullName || email,
      phone: loan.phone || '',
      nrc: loan.nrcNumber || loan.nrc || '',
      createdAt: loan.createdAt || '',
      role: 'user',
      loanOnly: true
    });
  });
  const mergedUsers = registeredUsers.concat([...loanCustomers.values()]);
  const byEmail = new Map(mergedUsers.map(user => [String(user.email || '').trim().toLowerCase(), user]));
  const applicationsByEmail = new Map();
  customerApplications.forEach(application => {
    const email = String(application.email || '').trim().toLowerCase();
    if (!email) return;
    if (!applicationsByEmail.has(email)) applicationsByEmail.set(email, []);
    applicationsByEmail.get(email).push(application);
  });
  applicationsByEmail.forEach((applications, email) => {
    applications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const existing = byEmail.get(email);
    if (existing) {
      existing.quickScreenApplications = applications;
      return;
    }
    const latest = applications[0];
    mergedUsers.push({
      id: `quick-screen:${latest.applicationId || latest.id}`,
      email,
      username: latest.fullName || email,
      phone: latest.phone || '',
      nrc: latest.nrcNumber || '',
      storeId: latest.storeId || 'buraza',
      createdAt: latest.createdAt || '',
      role: 'user',
      quickScreenApplicant: true,
      quickScreenApplications: applications
    });
  });
  allUsers = mergedUsers;
}

async function fetchCustomerApplications() {
  try {
    const params = addAllStoreScope(new URLSearchParams());
    const response = await fetch(`/api/apply?${params}`, { headers: getCustomerScopeHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load Quick Screen applicants.');
    if (!Array.isArray(data.applications)) throw new Error('The application service returned an unexpected customer format.');
    customerApplications = data.applications;
    mergeLoanOnlyCustomers();
    if (activeAdminPage === 'customersView') applyUserFilterAndSort();
    return true;
  } catch (error) {
    console.error('Quick Screen customer enrichment failed:', error);
    customerApplications = [];
    mergeLoanOnlyCustomers();
    if (activeAdminPage === 'customersView') applyUserFilterAndSort();
    return false;
  }
}

async function fetchCustomerLoans() {
  try {
    const params = addAllStoreScope(new URLSearchParams());
    const response = await fetch(`/loans/all?${params}`, { headers: getCustomerScopeHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load customer loan details.');
    if (!Array.isArray(data.loans)) throw new Error('The loan service returned an unexpected customer-loan format.');
    customerLoans = data.loans;
    customerLoansError = '';
    customerLoansLoaded = true;
    mergeLoanOnlyCustomers();
    if (activeAdminPage === 'customersView') applyUserFilterAndSort();
    if (['allLoansView', 'overdueView', 'defaultersView'].includes(activeAdminPage)) {
      renderLoanDirectory(activeAdminPage);
    }
    return true;
  } catch (error) {
    customerLoans = [];
    customerLoansError = error.message || 'Unable to load customer loan details.';
    customerLoansLoaded = true;
    console.error('Customer loan enrichment failed:', error);
    mergeLoanOnlyCustomers([]);
    if (activeAdminPage === 'customersView') applyUserFilterAndSort();
    if (['allLoansView', 'overdueView', 'defaultersView'].includes(activeAdminPage)) {
      renderLoanDirectory(activeAdminPage);
    }
    return false;
  }
}

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
    mergeLoanOnlyCustomers();
    pendingPaymentReviews = portfolioLoans.flatMap(loan => (loan.paymentSubmissions || [])
      .filter(submission => submission.status === 'pending').map(submission => ({ loan, submission })));
    portfolioLoaded = true;
    mergeLoanOnlyCustomers();
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
    portfolioLoaded = false;
    allUsers = registeredUsers.slice();
    pendingPaymentReviews = [];
    if (badge) badge.textContent = '0';
    renderPortfolioOverview();
    if (list) list.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load requests.')}</p>`;
    applyUserFilterAndSort();
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

function parseDashboardDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function dashboardDateKey(value) {
  const date = parseDashboardDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDashboardPayments() {
  return portfolioLoans.flatMap(loan => (Array.isArray(loan.payments) ? loan.payments : [])
    .map(payment => ({ loan, payment, date: parseDashboardDate(payment.paymentDate || payment.date) }))
    .filter(item => item.date));
}

function getCustomerScopeQuery() {
  const params = new URLSearchParams();
  addAllStoreScope(params);
  return params.toString();
}

async function fetchPayments() {
  if (!ensureAdminAccess() || paymentsLoading) return false;
  const list = document.getElementById('paymentsList');
  const status = document.getElementById('paymentsStatus');
  if (list) list.innerHTML = '<div class="directory-empty" role="status">Loading recorded payments…</div>';
  if (status) status.textContent = 'Loading every recorded payment in your authorized scope…';
  paymentsLoading = true;
  try {
    const records = [];
    const scopeQuery = getCustomerScopeQuery();
    const scopeSuffix = scopeQuery ? `&${scopeQuery}` : '';
    let page = 1;
    let totalPages = 1;
    do {
      const response = await fetch(`/payments?page=${page}&pageSize=500${scopeSuffix}`, {
        headers: getCustomerScopeHeaders()
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load payment history.');
      if (!Array.isArray(data.payments)) throw new Error('The payment service returned an unexpected response.');
      records.push(...data.payments);
      totalPages = Math.max(1, Number(data.summary?.totalPages) || 1);
      page += 1;
    } while (page <= totalPages);
    paymentRecords = records;
    paymentDirectoryPage = 1;
    renderPaymentsView();
    return true;
  } catch (error) {
    paymentRecords = [];
    if (list) list.innerHTML = `<div class="directory-empty" role="status">${escapeHtml(error.message || 'Unable to load payment history.')}</div>`;
    if (status) status.textContent = error.message || 'Unable to load payment history.';
    renderDirectoryPagination('paymentsPagination', 1, 0, 'payments', PAYMENT_DIRECTORY_PAGE_SIZE);
    console.error('Payment history load failed:', error);
    return false;
  } finally {
    paymentsLoading = false;
  }
}

function renderPaymentsView() {
  const list = document.getElementById('paymentsList');
  const status = document.getElementById('paymentsStatus');
  if (!list || !status) return;
  const term = String(document.getElementById('paymentsSearch')?.value || '').trim().toLowerCase();
  const from = document.getElementById('paymentsFrom')?.value || '';
  const to = document.getElementById('paymentsTo')?.value || '';
  const enriched = paymentRecords.map(payment => {
    const paymentEmail = String(payment.email || payment.borrowerEmail || '').trim().toLowerCase();
    const loan = customerLoans.find(item =>
      (payment.loanId != null && String(item.id) === String(payment.loanId)) ||
      (payment.loanReceiptId && String(item.receiptNumber) === String(payment.loanReceiptId)) ||
      (payment.loanReceiptNumber && String(item.receiptNumber) === String(payment.loanReceiptNumber))
    );
    const user = allUsers.find(item => String(item.email || '').trim().toLowerCase() === paymentEmail) ||
      (loan ? findCustomerForLoan(loan) : null);
    const date = payment.paymentDate || payment.date;
    return {
      ...payment,
      date,
      borrowerName: payment.borrowerName || payment.fullName || user?.username || loan?.username || 'Customer',
      email: payment.email || payment.borrowerEmail || loan?.email || '',
      loanReceipt: payment.loanReceiptId || payment.loanReceiptNumber || loan?.receiptNumber || payment.loanId || '—',
      receipt: payment.paymentReceiptId || payment.receiptNumber || payment.id || '—'
    };
  });
  const filtered = enriched.filter(payment => {
    const matchesText = !term || [
      payment.receipt, payment.loanReceipt, payment.borrowerName, payment.email,
      payment.phone, payment.mode, payment.recordedBy, payment.note
    ].some(value => String(value || '').toLowerCase().includes(term));
    return matchesText && dateMatchesRange(payment.date, from, to);
  }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const page = getDirectoryPage(filtered, paymentDirectoryPage, PAYMENT_DIRECTORY_PAGE_SIZE);
  paymentDirectoryPage = page.currentPage;
  status.textContent = `${filtered.length} recorded payment${filtered.length === 1 ? '' : 's'} match the filters · page ${page.currentPage} of ${page.pageCount}.`;
  if (!page.items.length) {
    list.innerHTML = `<div class="directory-empty" role="status">${paymentRecords.length ? 'No recorded payments match these filters.' : 'No payments have been recorded in this scope yet. Pending proofs appear under Loan Requests.'}</div>`;
  } else {
    list.innerHTML = `<table class="admin-table payment-history-table">
      <thead><tr><th>Payment Receipt</th><th>Loan</th><th>Borrower</th><th>Date</th><th>Amount</th><th>Balance Before</th><th>Balance After</th><th>Mode</th><th>Recorded By</th><th>Note / Proof</th></tr></thead>
      <tbody>${page.items.map(payment => `<tr>
        <td class="loan-id-cell">${escapeHtml(payment.receipt)}</td>
        <td>${escapeHtml(payment.loanReceipt)}</td>
        <td><strong>${escapeHtml(payment.borrowerName)}</strong><small class="table-subtext">${escapeHtml(payment.email)}</small></td>
        <td>${escapeHtml(formatDate(payment.date))}</td>
        <td class="money-cell">${formatCurrency(payment.amount)}</td>
        <td class="money-cell">${formatCurrency(payment.balanceBefore)}</td>
        <td class="money-cell">${formatCurrency(payment.balanceAfter)}</td>
        <td>${escapeHtml(formatStatus(payment.mode || '—'))}</td>
        <td>${escapeHtml(payment.recordedBy || '—')}</td>
        <td>${payment.screenshot ? `<a href="#" data-upload-filename="${escapeHtml(payment.screenshot)}">Proof</a>` : ''}${payment.note ? `<span class="table-subtext">${escapeHtml(payment.note)}</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  renderDirectoryPagination('paymentsPagination', page.currentPage, filtered.length, 'payments', PAYMENT_DIRECTORY_PAGE_SIZE);
}

function renderLoanDirectory(pageId = activeAdminPage) {
  const config = {
    allLoansView: {
      itemsId: 'allLoansList', paginationId: 'allLoansPagination', statusId: 'allLoansStatusMessage',
      searchId: 'allLoansSearch', fromId: 'allLoansFrom', toId: 'allLoansTo', type: 'all'
    },
    overdueView: {
      itemsId: 'overdueLoansList', paginationId: 'overduePagination', statusId: 'overdueStatusMessage',
      searchId: 'overdueSearch', fromId: 'overdueFrom', toId: 'overdueTo', type: 'overdue'
    },
    defaultersView: {
      itemsId: 'defaultersLoansList', paginationId: 'defaultersPagination', statusId: 'defaultersStatusMessage',
      searchId: 'defaultersSearch', fromId: 'defaultersFrom', toId: 'defaultersTo', type: 'defaulted'
    }
  }[pageId];
  if (!config) return;
  const list = document.getElementById(config.itemsId);
  const statusMessage = document.getElementById(config.statusId);
  if (!list) return;
  const term = String(document.getElementById(config.searchId)?.value || '').trim().toLowerCase();
  const from = document.getElementById(config.fromId)?.value || '';
  const to = document.getElementById(config.toId)?.value || '';
  const selectedStatus = pageId === 'allLoansView' ? (document.getElementById('allLoansStatus')?.value || '') : '';
  const currentPage = loanDirectoryPages[pageId] || 1;
  const loans = (customerLoans.length || customerLoansLoaded ? customerLoans : portfolioLoans).filter(loan => {
    const loanStatus = getLoanStatus(loan);
    const balance = Number(loan.outstanding) || 0;
    const isOverdue = ['grace', 'defaulted'].includes(loanStatus) && balance > 0;
    const include = config.type === 'overdue'
      ? isOverdue
      : config.type === 'defaulted'
        ? loanStatus === 'defaulted' && balance > 0
        : true;
    const user = findCustomerForLoan(loan) || {};
    const matchesText = !term || [
      loan.receiptNumber, loan.id, loan.email, loan.product, loan.status,
      user.username, user.phone, user.nrc
    ].some(value => String(value || '').toLowerCase().includes(term));
    const dateField = config.type === 'all' ? (loan.approvedAt || loan.createdAt) : loan.dueDate;
    const matchesDate = dateMatchesRange(dateField, from, to);
    return include && matchesText && matchesDate && (!selectedStatus || loanStatus === selectedStatus);
  }).sort((a, b) => new Date(b.approvedAt || b.createdAt || 0) - new Date(a.approvedAt || a.createdAt || 0));
  const page = getDirectoryPage(loans, currentPage, LOAN_DIRECTORY_PAGE_SIZE);
  loanDirectoryPages[pageId] = page.currentPage;
  if (statusMessage) statusMessage.textContent = `${loans.length} loan${loans.length === 1 ? '' : 's'} match this view · page ${page.currentPage} of ${page.pageCount}${customerLoansError ? ` · ${customerLoansError}` : ''}.`;
  if (!page.items.length) {
    list.innerHTML = `<div class="directory-empty" role="status">${customerLoansError ? escapeHtml(customerLoansError) : config.type === 'overdue' ? 'No overdue loans with an outstanding balance were found.' : config.type === 'defaulted' ? 'No defaulted loans with an outstanding balance were found.' : 'No loans match these filters.'}</div>`;
  } else {
    list.innerHTML = `<table class="admin-table loan-directory-table">
      <thead><tr><th>Loan ID</th><th>Borrower</th><th>Phone</th><th>Borrowed</th><th>Due Date</th><th>Status</th><th>Principal</th><th>Paid</th><th>Outstanding</th><th>Action</th></tr></thead>
      <tbody>${page.items.map(loan => {
        const user = findCustomerForLoan(loan) || {};
        const loanStatus = getLoanStatus(loan);
        const paid = Array.isArray(loan.payments)
          ? loan.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
          : Number(loan.paidTotal) || 0;
        const notify = ['grace', 'defaulted'].includes(loanStatus) && Number(loan.outstanding) > 0;
        const action = notify
          ? `<button type="button" class="quick-red-small" data-notify-loan="${escapeHtml(loan.id)}">Notify</button>`
          : `<button type="button" class="row-view" data-user-id="${escapeHtml(user.id ?? '')}" ${user.id == null ? 'disabled' : ''}>Borrower</button>`;
        return `<tr>
          <td class="loan-id-cell">${escapeHtml(loan.receiptNumber || loan.id)}</td>
          <td><strong>${escapeHtml(user.username || loan.username || loan.borrowerName || 'Customer')}</strong><small class="table-subtext">${escapeHtml(loan.email || '')}</small></td>
          <td>${escapeHtml(user.phone || loan.phone || '—')}</td>
          <td>${escapeHtml(formatDate(loan.approvedAt))}</td>
          <td>${escapeHtml(formatDate(loan.dueDate))}</td>
          <td><span class="admin-status status-${escapeHtml(loanStatus)}">${escapeHtml(formatStatus(loanStatus))}</span></td>
          <td class="money-cell">${formatCurrency(loan.amount)}</td>
          <td class="money-cell">${formatCurrency(paid)}</td>
          <td class="money-cell ${Number(loan.outstanding) > 0 ? 'outstanding-positive' : ''}">${formatCurrency(loan.outstanding)}</td>
          <td class="admin-row-actions">${action}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }
  renderDirectoryPagination(config.paginationId, page.currentPage, loans.length, pageId, LOAN_DIRECTORY_PAGE_SIZE);
}

function renderKpiSparkline(values, color, label) {
  const width = 84;
  const height = 34;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length < 2 ? width / 2 : 2 + index * (width - 4) / (values.length - 1);
    const y = height - 3 - (value / max) * (height - 8);
    return `${x},${y}`;
  });
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point}`).join(' ');
  const firstX = points.length ? points[0].split(',')[0] : '2';
  const lastX = points.length ? points[points.length - 1].split(',')[0] : String(width - 2);
  const area = `${line} L ${lastX},${height} L ${firstX},${height} Z`;
  return `<svg class="kpi-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}"><path d="${area}" fill="${color}" opacity=".15"></path><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function renderLoanTablePagination(pageCount, currentPage) {
  const nav = document.getElementById('loanTablePagination');
  if (!nav) return;
  if (pageCount <= 1) {
    nav.innerHTML = '';
    return;
  }
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  const numbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  nav.innerHTML = `<button type="button" data-loan-page="${currentPage - 1}" aria-label="Previous loan page" ${currentPage === 1 ? 'disabled' : ''}>&lt;</button>${numbers.map(page => `<button type="button" data-loan-page="${page}" aria-current="${page === currentPage ? 'page' : 'false'}">${page}</button>`).join('')}<button type="button" data-loan-page="${currentPage + 1}" aria-label="Next loan page" ${currentPage === pageCount ? 'disabled' : ''}>&gt;</button>`;
}

function setDashboardNavActive(activeButton) {
  document.querySelectorAll('#adminSidebar .admin-nav-item').forEach(button => {
    const active = button === activeButton;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function renderPortfolioOverview() {
  const kpis = document.getElementById('portfolioKpis');
  const chart = document.getElementById('collectionsChart');
  const activityList = document.getElementById('recentActivity');
  const loyalList = document.getElementById('loyalBorrowers');
  if (!kpis || !chart || !activityList || !loyalList) return;

  const now = new Date();
  const todayKey = dashboardDateKey(now);
  const active = portfolioLoans.filter(loan => getLoanStatus(loan) === 'active');
  const openLoans = portfolioLoans.filter(loan =>
    ['active', 'grace', 'defaulted', 'liquidated'].includes(getLoanStatus(loan)) &&
    Number(loan.outstanding) > 0
  );
  const overdue = portfolioLoans.filter(loan => ['grace', 'defaulted'].includes(getLoanStatus(loan)));
  const openBalance = openLoans.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstanding) || 0), 0);
  const overdueBalance = overdue.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstanding) || 0), 0);
  const payments = getDashboardPayments();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthPayments = payments.filter(item => item.date >= monthStart && dashboardDateKey(item.date) <= todayKey);
  const collectedMonth = monthPayments.reduce((sum, item) => sum + (Number(item.payment.amount) || 0), 0);
  const monthLabel = document.getElementById('collectionMonthLabel');
  const customRangePanel = document.getElementById('collectionCustomRange');
  const customFromInput = document.getElementById('collectionRangeFrom');
  const customToInput = document.getElementById('collectionRangeTo');
  if (customRangePanel) customRangePanel.hidden = activeCollectionRange !== 'CUSTOM';
  if (customFromInput && customFromInput.value !== customCollectionFrom) customFromInput.value = customCollectionFrom;
  if (customToInput && customToInput.value !== customCollectionTo) customToInput.value = customCollectionTo;
  const todayDateValue = dashboardDateKey(now);
  if (customFromInput) customFromInput.max = todayDateValue;
  if (customToInput) customToInput.max = todayDateValue;

  const sparkDays = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13 + index);
    return { date, key: dashboardDateKey(date) };
  });
  const paymentByDay = new Map();
  payments.forEach(item => {
    const key = dashboardDateKey(item.date);
    paymentByDay.set(key, (paymentByDay.get(key) || 0) + (Number(item.payment.amount) || 0));
  });
  const activeByDay = new Map();
  active.forEach(loan => {
    const key = dashboardDateKey(loan.approvedAt);
    if (key) activeByDay.set(key, (activeByDay.get(key) || 0) + 1);
  });
  const overdueByDay = new Map();
  overdue.forEach(loan => {
    const key = dashboardDateKey(loan.dueDate);
    if (key) overdueByDay.set(key, (overdueByDay.get(key) || 0) + 1);
  });
  const balanceByDay = new Map();
  openLoans.forEach(loan => {
    const key = dashboardDateKey(loan.approvedAt);
    if (key) balanceByDay.set(key, (balanceByDay.get(key) || 0) + Math.max(0, Number(loan.outstanding) || 0));
  });
  const sparklineValues = {
    cash: sparkDays.map(day => paymentByDay.get(day.key) || 0),
    active: sparkDays.map(day => activeByDay.get(day.key) || 0),
    overdue: sparkDays.map(day => overdueByDay.get(day.key) || 0),
    balance: sparkDays.map(day => balanceByDay.get(day.key) || 0)
  };
  const kpiData = [
    { label: 'Cash Collected', value: formatCurrency(collectedMonth), note: `${monthPayments.length} payments this month`, color: '#2f81f7', accent: 'blue', spark: 'cash', metric: 'payments by date' },
    { label: 'Active Loans', value: String(active.length), note: `${pendingRequests.length} requests awaiting review`, color: '#d29922', accent: 'amber', spark: 'active', metric: 'active loans by approval date' },
    { label: 'Overdue Loans', value: String(overdue.length), note: `${formatCurrency(overdueBalance)} outstanding`, color: '#f85149', accent: 'red', spark: 'overdue', metric: 'overdue loans by due date' },
    { label: 'Outstanding Balance', value: formatCurrency(openBalance), note: 'Across all open loans', color: '#a371f7', accent: 'purple', spark: 'balance', metric: 'open balances by approval date' }
  ];
  kpis.innerHTML = kpiData.map(item => `
    <article class="admin-kpi-card accent-${item.accent}">
      <div class="kpi-copy"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.note)}</small></div>
      ${renderKpiSparkline(sparklineValues[item.spark], item.color, `${item.label}: ${item.metric}, last 14 days`)}
    </article>
  `).join('');

  const isCustomRange = activeCollectionRange === 'CUSTOM';
  const customStart = isCustomRange && customCollectionFrom ? new Date(`${customCollectionFrom}T00:00:00`) : null;
  const customEnd = isCustomRange && customCollectionTo ? new Date(`${customCollectionTo}T00:00:00`) : null;
  const customRangeValid = Boolean(customStart && customEnd &&
    !Number.isNaN(customStart.getTime()) && !Number.isNaN(customEnd.getTime()) &&
    customStart <= customEnd && customEnd <= new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const presetDays = { '7D': 7, '1M': 30, '3M': 90, '1Y': 365 }[activeCollectionRange] || 30;
  const rangeDays = customRangeValid
    ? Math.floor((Date.UTC(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate()) -
      Date.UTC(customStart.getFullYear(), customStart.getMonth(), customStart.getDate())) / 86400000) + 1
    : isCustomRange ? 30 : presetDays;
  const firstDay = customRangeValid
    ? customStart
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - rangeDays + 1);
  const lastDay = customRangeValid
    ? customEnd
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeEnd = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1).getTime();
  const bucketDays = Math.max(1, Math.ceil(rangeDays / 365));
  const bucketCount = Math.ceil(rangeDays / bucketDays);
  const dates = Array.from({ length: bucketCount }, (_, index) =>
    new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index * bucketDays)
  );
  const getBucketIndex = value => {
    const date = parseDashboardDate(value);
    if (!date || date < firstDay || date >= rangeEnd) return -1;
    const dayOffset = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate())) / 86400000);
    return Math.floor(dayOffset / bucketDays);
  };
  if (monthLabel) {
    monthLabel.textContent = customRangeValid
      ? `${formatDate(firstDay)} – ${formatDate(lastDay)}`
      : isCustomRange ? 'Choose a custom date range' : `Last ${rangeDays} days`;
  }
  const chartPayments = new Map();
  payments.forEach(item => {
    const bucket = getBucketIndex(item.date);
    if (bucket < 0) return;
    chartPayments.set(bucket, (chartPayments.get(bucket) || 0) + (Number(item.payment.amount) || 0));
  });
  const chartLoans = new Map();
  portfolioLoans.forEach(loan => {
    if (getLoanStatus(loan) === 'pending' || getLoanStatus(loan) === 'declined') return;
    const date = parseDashboardDate(loan.approvedAt);
    const bucket = getBucketIndex(date);
    if (bucket < 0) return;
    chartLoans.set(bucket, (chartLoans.get(bucket) || 0) + (Number(loan.amount) || 0));
  });
  const series = dates.map((date, index) => ({
    date,
    payments: chartPayments.get(index) || 0,
    loans: chartLoans.get(index) || 0
  }));
  const chartWidth = 1000;
  const chartHeight = 250;
  const left = 76;
  const right = 18;
  const top = 16;
  const bottom = 34;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const max = Math.max(1, ...series.map(point => Math.max(point.payments, point.loans)));
  const x = index => left + (series.length <= 1 ? 0 : index * plotWidth / (series.length - 1));
  const y = value => top + plotHeight - (value / max) * plotHeight;
  const pointsFor = field => series.map((point, index) => ({ x: x(index), y: y(point[field]), value: point[field] }));
  const makeLine = points => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x},${point.y}`).join(' ');
  const makeArea = points => `${makeLine(points)} L ${points[points.length - 1]?.x || left},${top + plotHeight} L ${points[0]?.x || left},${top + plotHeight} Z`;
  const paymentPoints = pointsFor('payments');
  const loanPoints = pointsFor('loans');
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = max * (1 - index / 4);
    const yPosition = top + plotHeight * index / 4;
    return `<g><line x1="${left}" y1="${yPosition}" x2="${chartWidth - right}" y2="${yPosition}"/><text x="${left - 10}" y="${yPosition + 4}" text-anchor="end">${escapeHtml(formatCurrency(value))}</text></g>`;
  }).join('');
  const tickIndexes = [...new Set([0, Math.floor((series.length - 1) / 4), Math.floor((series.length - 1) / 2), Math.floor((series.length - 1) * 3 / 4), series.length - 1])];
  const xLabels = tickIndexes.map(index =>
    `<text x="${x(index)}" y="${chartHeight - 8}" text-anchor="middle">${escapeHtml(dates[index].toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))}</text>`
  ).join('');
  const tooltips = tickIndexes.map(index => {
    const point = series[index];
    const bucketEnd = new Date(point.date.getFullYear(), point.date.getMonth(), point.date.getDate() + bucketDays - 1);
    if (bucketEnd > lastDay) bucketEnd.setTime(lastDay.getTime());
    const periodLabel = bucketDays === 1 ? formatDate(point.date) : `${formatDate(point.date)} – ${formatDate(bucketEnd)}`;
    return `<g><circle cx="${x(index)}" cy="${y(point.payments)}" r="4" fill="#2f81f7"><title>${escapeHtml(periodLabel)} · Payments: ${escapeHtml(formatCurrency(point.payments))} · New loans: ${escapeHtml(formatCurrency(point.loans))}</title></circle><circle cx="${x(index)}" cy="${y(point.loans)}" r="4" fill="#3fb950"><title>${escapeHtml(periodLabel)} · Payments: ${escapeHtml(formatCurrency(point.payments))} · New loans: ${escapeHtml(formatCurrency(point.loans))}</title></circle></g>`;
  }).join('');
  const chartSvg = `<svg class="collections-svg admin-month-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${bucketDays === 1 ? 'Daily' : `${bucketDays}-day interval`} payments received and newly approved loan amounts from ${formatDate(firstDay)} to ${formatDate(lastDay)}">
    ${grid}${xLabels}
    <path d="${makeArea(paymentPoints)}" fill="#2f81f7" opacity=".1"></path>
    <path d="${makeArea(loanPoints)}" fill="#3fb950" opacity=".1"></path>
    <path d="${makeLine(paymentPoints)}" fill="none" stroke="#2f81f7" stroke-width="3"></path>
    <path d="${makeLine(loanPoints)}" fill="none" stroke="#3fb950" stroke-width="3"></path>
    ${tooltips}
  </svg>`;
  chart.innerHTML = customRangeValid || !isCustomRange
    ? chartSvg
    : '<p class="collection-range-prompt">Choose a start and end date, then select Apply to view the custom range.</p>';
  document.querySelectorAll('[data-collection-range]').forEach(button => {
    const selected = button.dataset.collectionRange === activeCollectionRange;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  const activity = portfolioLoans.flatMap(loan => {
    const customer = findCustomerForLoan(loan) || {};
    const name = customer.username || loan.email || 'Customer';
    const loanId = loan.receiptNumber || String(loan.id);
    const events = [];
    const history = Array.isArray(loan.statusHistory) ? loan.statusHistory : [];
    const latestHistory = history.at(-1);
    const status = String(latestHistory?.status || loan.status || '').toLowerCase();
    const statusDate = latestHistory?.updatedAt || loan.updatedAt;
    if (statusDate) {
      const kind = status === 'pending' ? 'amber' : ['declined', 'defaulted', 'grace'].includes(status) ? 'red' : ['paid', 'active'].includes(status) ? 'green' : 'blue';
      const title = status === 'pending' ? 'New Loan Request' : status === 'approved' ? 'Loan Approved' : `Loan ${formatStatus(status)}`;
      events.push({ at: statusDate, title, detail: `${name} · ${loanId}`, amount: Number(loan.amount) || 0, kind });
    }
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
      events.push({
        at: payment.paymentDate || payment.date,
        title: 'Payment Received',
        detail: `${name} · ${payment.paymentReceiptId || loanId}`,
        amount: Number(payment.amount) || 0,
        kind: 'green'
      });
    });
    return events;
  }).filter(item => parseDashboardDate(item.at))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 5);
  activityList.innerHTML = activity.length ? activity.map(item => `
    <li class="activity-${item.kind}">
      <i class="activity-dot" aria-hidden="true"></i>
      <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p><small>${escapeHtml(formatRelativeTime(item.at))}</small></div>
      <b>${formatCurrency(item.amount)}</b>
    </li>
  `).join('') : '<li class="activity-empty">No recent loan activity.</li>';

  const search = String(document.getElementById('adminDashboardSearch')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('loanStatusFilter')?.value || '';
  const filteredLoans = portfolioLoans.filter(loan => {
    const customer = findCustomerForLoan(loan) || {};
    const textMatches = !search || [
      loan.receiptNumber, loan.id, loan.email, loan.product, loan.status, customer.username, customer.phone
    ].some(value => String(value || '').toLowerCase().includes(search));
    return textMatches && (!statusFilter || getLoanStatus(loan) === statusFilter);
  }).sort((a, b) => new Date(b.approvedAt || 0) - new Date(a.approvedAt || 0) || Number(b.id) - Number(a.id));
  const pageCount = Math.max(1, Math.ceil(filteredLoans.length / LOAN_TABLE_PAGE_SIZE));
  loanTablePage = Math.min(Math.max(1, loanTablePage), pageCount);
  const pageStart = (loanTablePage - 1) * LOAN_TABLE_PAGE_SIZE;
  const visibleLoans = filteredLoans.slice(pageStart, pageStart + LOAN_TABLE_PAGE_SIZE);
  const loanTable = document.getElementById('adminLoanTable');
  if (loanTable) loanTable.innerHTML = visibleLoans.length ? `
    <table class="admin-table">
      <thead><tr><th>Loan ID</th><th>Borrower</th><th>Date</th><th>Status</th><th>Amount</th><th>Outstanding</th><th>Action</th></tr></thead>
      <tbody>${visibleLoans.map(loan => {
        const customer = findCustomerForLoan(loan) || {};
        const status = getLoanStatus(loan);
        const customerId = customer.id;
        const overdueLoan = ['grace', 'defaulted'].includes(status);
        const action = overdueLoan
          ? `<button type="button" class="quick-red-small" data-notify-loan="${escapeHtml(loan.id)}">Notify</button>`
          : `<button type="button" class="row-view" data-user-id="${escapeHtml(customerId ?? '')}" ${customerId == null ? 'disabled' : ''}>View / Manage</button>`;
        return `<tr data-loan-row>
          <td class="loan-id-cell">${escapeHtml(loan.receiptNumber || String(loan.id))}</td>
          <td><strong>${escapeHtml(customer.username || loan.email || 'Customer')}</strong><small class="table-subtext">${escapeHtml(loan.email || '')}</small></td>
          <td>${escapeHtml(formatDate(loan.approvedAt))}</td>
          <td><span class="admin-status status-${escapeHtml(status)}">${escapeHtml(formatStatus(status))}</span></td>
          <td class="money-cell">${formatCurrency(loan.amount)}</td>
          <td class="money-cell ${Number(loan.outstanding) > 0 ? 'outstanding-positive' : ''}">${formatCurrency(loan.outstanding)}</td>
          <td class="admin-row-actions">${action}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<p class="table-empty">No loans match the current search and status filter.</p>';
  renderLoanTablePagination(pageCount, loanTablePage);

  const customerMap = new Map();
  portfolioLoans.forEach(loan => {
    const email = String(loan.email || '').trim().toLowerCase();
    if (!email) return;
    const customer = customerMap.get(email) || { email, loans: [], totalPaid: 0, lastPayment: null };
    customer.loans.push(loan);
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
      customer.totalPaid += Number(payment.amount) || 0;
      const date = parseDashboardDate(payment.paymentDate || payment.date);
      if (date && (!customer.lastPayment || date > customer.lastPayment)) customer.lastPayment = date;
    });
    customerMap.set(email, customer);
  });
  const loyal = [...customerMap.values()].map(customer => {
    const settled = customer.loans.filter(loan => {
      const status = getLoanStatus(loan);
      return status !== 'declined' && (status === 'paid' || Number(loan.outstanding) <= 0);
    });
    const overdueHistory = customer.loans.some(loan => {
      const history = Array.isArray(loan.statusHistory) ? loan.statusHistory : [];
      return ['grace', 'defaulted'].includes(getLoanStatus(loan)) ||
        history.some(event => ['grace', 'defaulted'].includes(String(event.status || '').toLowerCase()));
    });
    const outcomes = settled.map(loan => {
      const paymentsForLoan = Array.isArray(loan.payments) ? loan.payments : [];
      const settledAt = parseDashboardDate(loan.settledAt) ||
        paymentsForLoan.map(payment => parseDashboardDate(payment.paymentDate || payment.date))
          .filter(Boolean).sort((a, b) => b - a)[0];
      const dueDate = parseDashboardDate(loan.dueDate);
      return settledAt && dueDate ? settledAt <= dueDate : null;
    });
    const hasCompleteDates = outcomes.length > 0 && outcomes.every(outcome => outcome !== null);
    const onTimeRate = hasCompleteDates ? outcomes.filter(Boolean).length / outcomes.length : null;
    return { ...customer, settledCount: settled.length, overdueHistory, onTimeRate };
  }).filter(customer =>
    !customer.overdueHistory && customer.onTimeRate !== null && customer.onTimeRate >= 0.9
  ).sort((a, b) => b.onTimeRate - a.onTimeRate || b.totalPaid - a.totalPaid).slice(0, 5);
  loyalList.innerHTML = loyal.length ? `
    <table class="admin-table loyal-table">
      <thead><tr><th>#</th><th>Borrower</th><th>Phone</th><th>Total Loans</th><th>Total Repaid</th><th>On-Time Rate</th><th>Last Payment</th><th>Badge</th></tr></thead>
      <tbody>${loyal.map((customer, index) => {
        const user = findCustomerForLoan({ email: customer.email }) || {};
        const tier = customer.settledCount >= 3 && customer.onTimeRate === 1
          ? { name: 'Gold', icon: '★', cls: 'gold' }
          : customer.settledCount >= 1
            ? { name: 'Trusted', icon: '✓', cls: 'trusted' }
            : { name: 'Reliable', icon: '●', cls: 'reliable' };
        return `<tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(user.username || customer.email)}</strong><small class="table-subtext">${escapeHtml(customer.email)}</small></td>
          <td>${escapeHtml(user.phone || '—')}</td>
          <td>${customer.loans.length}</td>
          <td class="paid-cell">${formatCurrency(customer.totalPaid)}</td>
          <td class="loyal-rate">${Math.round(customer.onTimeRate * 100)}%</td>
          <td>${customer.lastPayment ? escapeHtml(formatDate(customer.lastPayment)) : '—'}</td>
          <td><span class="loyalty-badge ${tier.cls}">${tier.icon} ${tier.name}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<p class="table-empty">No fully settled loans with verifiable on-time dates are recorded yet.</p>';
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
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load notifications.');
    adminNotifications = Array.isArray(data) ? data : Array.isArray(data.notifications) ? data.notifications : [];
    renderAdminNotifications();
    return true;
  } catch (error) {
    console.error('Notification refresh failed:', error);
    const list = document.getElementById('adminNotificationList');
    if (list) list.innerHTML = '<p class="notification-error" role="status">Notifications could not be loaded. Close and reopen this menu to retry.</p>';
    return false;
  }
}

async function refreshBellCount() {
  try {
    const response = await fetch('/api/apply?notificationsOnly=true', { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to sync application notifications.');
    await fetchAdminNotifications();
  } catch (error) {
    console.error('Application notification sync failed:', error);
    const list = document.getElementById('adminNotificationList');
    if (list) list.innerHTML = `<p class="notification-error" role="status">${escapeHtml(error.message || 'Application notifications could not be refreshed.')}</p>`;
  }
}

function renderAdminNotifications() {
  const list = document.getElementById('adminNotificationList');
  const badge = document.getElementById('adminNotificationCount');
  if (!list || !badge) return;
  const unread = adminNotifications.filter(item => !item.readAt).length;
  badge.textContent = String(unread);
  badge.classList.toggle('hidden', unread === 0);
  const recent = adminNotifications.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, showAllAdminNotifications ? 50 : 6);
  const showAllButton = document.getElementById('viewAllNotifications');
  if (showAllButton) showAllButton.textContent = showAllAdminNotifications ? 'Show recent notifications' : 'View all notifications';
  list.innerHTML = recent.length ? recent.map(item => {
    const reviewLabel = item.type === 'loan-request' ? 'Review request' : item.type === 'payment-review' ? 'Review payment' : '';
    const loanAction = reviewLabel
      ? `<button type="button" data-notification-open-loan="${escapeHtml(item.loanId)}" data-notification-id="${escapeHtml(item.id)}">${reviewLabel}</button>`
      : '';
    const applicationActions = item.type === 'application-request'
      ? `<div class="notification-actions">
          ${String(item.applicationStatus || 'pending').toLowerCase() === 'pending' ? `<button type="button" data-notification-application-action="approve" data-application-id="${escapeHtml(item.applicationId)}">Approve</button><button type="button" class="notification-decline" data-notification-application-action="reject" data-application-id="${escapeHtml(item.applicationId)}">Decline</button>` : ''}
          <button type="button" class="notification-view" data-notification-application-action="view" data-application-id="${escapeHtml(item.applicationId)}">View</button>
        </div>`
      : '';
    return `<article class="notification-item ${item.readAt ? '' : 'unread'}"><strong>${escapeHtml(formatStatus(item.type || 'Update'))}</strong><p>${escapeHtml(item.message || 'There is an update to review.')}</p><small>${escapeHtml(formatRelativeTime(item.createdAt))}</small>${loanAction}${applicationActions}</article>`;
  }).join('') : '<p class="table-empty">You are all caught up.</p>';
}

async function markAdminNotificationRead(id) {
  const item = adminNotifications.find(notification => notification.id === id);
  if (!item || item.readAt) return;
  try {
    const response = await fetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to mark the notification as read.');
    item.readAt = new Date().toISOString();
    renderAdminNotifications();
  } catch (error) {
    console.error('Notification read update failed:', error);
    showBmfToast(error.message || 'Unable to mark the notification as read.', 'error');
  }
}

async function notifySelectedUser() {
  if (!selectedUser || !selectedUser.email) {
    document.getElementById('detailFeedback').textContent = 'Open a customer first.';
    return;
  }

  // Show option prompt: overdue notice vs custom email
  const choice = prompt(
    `Send notification to ${selectedUser.email}\n\n1. Send automated overdue notice\n2. Write custom email\n\nEnter 1 or 2:`
  );

  if (!choice) return; // User cancelled

  let subject, body;

  if (choice === '1') {
    // Automated overdue notice
    subject = 'BMF Loan Overdue Notice';
    body = `Hello ${selectedUser.username || ' valued customer'},

Your BMF loan is now overdue. Kindly settle the outstanding balance as soon as possible to restore and continue your access to the BMF loan service.

If you have already made a payment, please disregard this notice and contact our office with your payment confirmation.

Best regards,
BMF Customer Service`;
  } else if (choice === '2') {
    // Custom email - prompt for message content
    const customMessage = prompt('Enter your custom email message:');
    if (customMessage === null || customMessage.trim() === '') {
      document.getElementById('detailFeedback').textContent = 'Custom message cancelled.';
      return;
    }
    subject = 'BMF Loan Update';
    body = customMessage;
  } else {
    document.getElementById('detailFeedback').textContent = 'Invalid choice. Notification cancelled.';
    return;
  }

  // Send the notification
  const notifyButton = document.querySelector('[data-notify-user]');
  if (notifyButton) { notifyButton.disabled = true; notifyButton.textContent = 'Sending…'; }
  try {
    document.getElementById('detailFeedback').textContent = `Sending notification to ${selectedUser.email}...`;
    const response = await fetch('/loans/notify-user', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ 
        email: selectedUser.email,
        subject,
        body
      })
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

// ─── Loan Applications (Quick Screen) ─────────────────────────────────────────
async function fetchApplications() {
  if (!ensureAdminAccess()) return;
  const list = document.getElementById('applicationsList');
  const countEl = document.getElementById('applicationsCount');
  const message = document.getElementById('applicationsMessage');
  if (!list) return;
  list.innerHTML = '<div class="directory-empty" role="status">Loading applications…</div>';
  message.textContent = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('/api/apply', { headers: getStoreHeaders(), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Unable to load applications.');
      error.status = response.status;
      throw error;
    }
    allApplications = Array.isArray(data.applications) ? data.applications : [];
    renderApplications();
  } catch (err) {
    const msg = controller.signal.aborted
      ? 'Applications took too long to load. Please retry.'
      : err.status === 401
        ? 'Your admin session expired. Please sign in again.'
        : err.status === 403
          ? 'Your account is not allowed to view applications.'
          : err.message || 'Unable to load applications.';
    list.innerHTML = `<div class="directory-empty" role="status">${escapeHtml(msg)}</div>`;
    if (countEl) countEl.textContent = '';
    renderDirectoryPagination('applicationsPagination', 1, 0, 'applications');
    if (message) message.textContent = msg;
  } finally {
    clearTimeout(timeoutId);
  }
}

function statusBadge(status) {
  const map = { pending: 'status-pending', approved: 'status-approved', declined: 'status-declined', info_requested: 'status-pending' };
  const cls = map[String(status).toLowerCase()] || 'status-pending';
  return `<span class="status-tag ${cls}">${escapeHtml(String(status).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</span>`;
}

function renderApplications() {
  const list = document.getElementById('applicationsList');
  if (!list) return;
  if (!allApplications.length) {
    list.innerHTML = '<div class="directory-empty" role="status">No loan applications found.</div>';
    document.getElementById('applicationsCount').textContent = '0 applications awaiting review.';
    renderDirectoryPagination('applicationsPagination', 1, 0, 'applications');
    return;
  }
  const term = (document.getElementById('applicationSearch')?.value || '').trim().toLowerCase();
  const status = (document.getElementById('applicationStatusFilter')?.value || '').toLowerCase();
  const from = document.getElementById('applicationDateFrom')?.value || '';
  const to = document.getElementById('applicationDateTo')?.value || '';
  const filtered = allApplications.filter(app => {
    const textMatches = !term || [
      app.fullName, app.email, app.phone, app.nrcNumber, app.nrc, app.applicationId, app.id,
      app.product, app.loanPurpose, app.status
    ].some(value => String(value || '').toLowerCase().includes(term));
    return textMatches &&
      (!status || String(app.status || '').toLowerCase() === status) &&
      dateMatchesRange(app.createdAt, from, to);
  });
  const page = getDirectoryPage(filtered, applicationDirectoryPage);
  applicationDirectoryPage = page.currentPage;
  const pendingCount = allApplications.filter(app => String(app.status || '').toLowerCase() === 'pending').length;
  document.getElementById('applicationsCount').textContent =
    `${pendingCount} application${pendingCount === 1 ? '' : 's'} awaiting review · ${filtered.length} match the filters · page ${page.currentPage} of ${page.pageCount}.`;
  renderDirectoryPagination('applicationsPagination', page.currentPage, filtered.length, 'applications');
  if (!filtered.length) {
    list.innerHTML = '<div class="directory-empty" role="status">No applications match these filters.</div>';
    return;
  }
  list.innerHTML = page.items.map(app => {
    const weeklyRates = { 1: 0.10, 2: 0.16, 3: 0.24, 4: 0.32 };
    const amount = Number(app.amount) || 0;
    const tenureWeeks = Number(app.tenureWeeks) || 1;
    const rate = weeklyRates[tenureWeeks] ?? 0.10;
    const interest = amount * rate;
    const total = amount + interest;
    const product = app.product || app.loanPurpose || 'Loan application';
    const applicationId = app.applicationId || app.id || 'Application';
    const nrcNumber = app.nrcNumber || app.nrc || '—';
    const collateralFront = app.collateralFront || app.collateralPhoto;
    const reviewed = app.status !== 'pending' ? `
      <p><strong>Reviewed:</strong> ${escapeHtml(formatDate(app.reviewedAt))} by ${escapeHtml(app.reviewedBy || '—')}</p>
      ${app.reviewNote ? `<p><strong>Note:</strong> ${escapeHtml(app.reviewNote)}</p>` : ''}
    ` : '';
    const actions = String(app.status || '').toLowerCase() === 'pending' ? `
      <div class="button-row" style="margin-top:8px;">
        <button class="toggle-mode" type="button" data-app-action="approve" data-app-id="${escapeHtml(app.id)}" style="background:var(--bmf-green);">Approve</button>
        <button class="toggle-mode" type="button" data-app-action="request_info" data-app-id="${escapeHtml(app.id)}" style="background:var(--bmf-amber);">Request Info</button>
        <button class="toggle-mode" type="button" data-app-action="reject" data-app-id="${escapeHtml(app.id)}" style="background:var(--bmf-red);">Reject</button>
      </div>
      <div style="margin-top:8px;">
        <label for="appNote-${escapeHtml(app.id)}">Review note (optional)</label>
        <input type="text" id="appNote-${escapeHtml(app.id)}" class="modal-input" placeholder="Reason for decision..." maxlength="300">
      </div>
    ` : `<p style="margin-top:8px; opacity:0.7;">Decision already made.</p>`;
    return `
      <article class="panel loan-item" data-application-card="${escapeHtml(app.applicationId || app.id)}" style="margin-top:10px;">
        <div class="loan-header">
          <strong style="margin-left:8px;">${escapeHtml(product)} — ${escapeHtml(applicationId)}</strong>
          ${statusBadge(app.status)}
        </div>
        <p><strong>Applicant:</strong> ${escapeHtml(app.fullName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(app.email)} · <strong>Phone:</strong> ${escapeHtml(app.phone)} · <strong>NRC:</strong> ${escapeHtml(nrcNumber)}</p>
        <p><strong>Amount:</strong> ${formatCurrency(amount)} · <strong>Interest:</strong> ${formatCurrency(interest)} · <strong>Total:</strong> ${formatCurrency(total)}</p>
        <p><strong>Tenure:</strong> ${tenureWeeks} week${tenureWeeks === 1 ? '' : 's'} · <strong>Urgency:</strong> ${escapeHtml(app.urgency || 'standard')} · <strong>Requested:</strong> ${escapeHtml(formatDate(app.createdAt))}</p>
        ${app.nrcFront ? `<p><a class="proof-link" href="#" data-upload-filename="${escapeHtml(app.nrcFront)}">View NRC front</a></p>` : ''}
        ${app.nrcBack ? `<p><a class="proof-link" href="#" data-upload-filename="${escapeHtml(app.nrcBack)}">View NRC back</a></p>` : ''}
        ${collateralFront ? `<p><a class="proof-link" href="#" data-upload-filename="${escapeHtml(collateralFront)}">View collateral front</a></p>` : ''}
        ${app.collateralBack ? `<p><a class="proof-link" href="#" data-upload-filename="${escapeHtml(app.collateralBack)}">View collateral back</a></p>` : ''}
        ${reviewed}
        ${actions}
      </article>
    `;
  }).join('');
}

async function reviewApplication(appId, action, providedNote) {
  const noteInput = document.getElementById('appNote-' + appId);
  let note = providedNote === undefined ? (noteInput ? noteInput.value.trim() : '') : String(providedNote || '').trim();
  if (action === 'reject' && !note) {
    const answer = window.prompt('Reason for declining this application:');
    if (answer === null) return;
    note = answer.trim();
    if (!note) {
      document.getElementById('applicationsMessage').textContent = 'Rejection requires a reason.';
      return;
    }
  }
  try {
    const response = await fetch(`/api/apply/${encodeURIComponent(appId)}`, {
      method: 'PATCH',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, note })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to review application.');
    const successMessage = action === 'approve'
      ? 'Application approved.'
      : action === 'reject'
        ? 'Application declined.'
        : 'Additional information requested.';
    const message = document.getElementById('applicationsMessage');
    if (message) {
      message.textContent = data.message || successMessage;
      message.style.color = 'var(--success)';
    }
    showBmfToast(data.message || successMessage);
    await Promise.all([fetchApplications(), fetchAdminNotifications()]);
    refreshBellCount();
  } catch (err) {
    const message = document.getElementById('applicationsMessage');
    if (message) {
      message.textContent = err.message || 'Unable to review application.';
      message.style.color = 'var(--danger)';
    }
    showBmfToast(err.message || 'Unable to review application.', 'error');
  }
}

function getCustomerLoanStats(email) {
  const key = String(email || '').trim().toLowerCase();
  const loans = customerLoans.filter(loan => String(loan.email || '').trim().toLowerCase() === key);
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
      : 'No registered customer accounts were returned for this scope.';
    list.innerHTML = `<div class="directory-empty">${message}</div>`;
    return;
  }

  list.innerHTML = `<table class="admin-table customer-directory-table">
    <thead><tr><th>ID</th><th>Customer</th><th>Cell Number</th><th>Email</th><th>NRC</th><th>Store</th><th>Loans</th><th>Outstanding</th><th>Status</th><th>Profile</th></tr></thead>
    <tbody>${users.map((user) => {
    const stats = getCustomerLoanStats(user.email);
    return `
      <tr>
        <td>${escapeHtml(user.id ?? '—')}</td>
        <td><strong>${escapeHtml(user.username || 'Unknown user')}</strong>${user.quickScreenApplicant ? '<small class="table-subtext">Quick Screen applicant · not registered</small>' : user.loanOnly ? '<small class="table-subtext">Loan record only</small>' : user.quickScreenApplications?.length ? '<small class="table-subtext">Quick Screen applicant</small>' : ''}</td>
        <td>${escapeHtml(user.phone || '—')}</td>
        <td>${escapeHtml(user.email || '—')}</td>
        <td>${escapeHtml(user.nrc || user.nrcNumber || '—')}</td>
        <td>${escapeHtml(getStoreName(user.storeId) || user.storeId || '—')}</td>
        <td>${stats.count}</td>
        <td class="money-cell">${formatCurrency(stats.outstanding)}</td>
        <td>${escapeHtml(formatStatus(stats.status))}</td>
        <td><button type="button" class="row-view" data-user-id="${escapeHtml(user.id)}">View</button></td>
      </tr>
  `;
  }).join('')}</tbody>
  </table>`;
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

  const canNotifyUser = ['admin', 'franchise_admin', 'store_admin'].includes(localStorage.getItem('userRole') || '');
  const applicationHistory = (selectedUser.quickScreenApplications || []).map(application => `
    <article class="customer-application-summary">
      <h3>Quick Screen application ${escapeHtml(application.applicationId || application.id || '')}</h3>
      <p><strong>Status:</strong> ${escapeHtml(formatStatus(application.status || 'pending'))} · <strong>Submitted:</strong> ${escapeHtml(formatDate(application.createdAt))}</p>
      <p><strong>Product:</strong> ${escapeHtml(application.product || '—')} · <strong>Requested:</strong> ${formatCurrency(application.amount)}</p>
      <p><strong>Tenure:</strong> ${escapeHtml(application.tenureWeeks || '—')} week(s) · <strong>Urgency:</strong> ${escapeHtml(formatStatus(application.urgency || 'standard'))}</p>
      <div class="customer-application-files">
        ${application.nrcFront ? `<a class="proof-link" href="#" data-upload-filename="${escapeHtml(application.nrcFront)}">View NRC front</a>` : ''}
        ${application.nrcBack ? `<a class="proof-link" href="#" data-upload-filename="${escapeHtml(application.nrcBack)}">View NRC back</a>` : ''}
        ${application.collateralFront ? `<a class="proof-link" href="#" data-upload-filename="${escapeHtml(application.collateralFront)}">View collateral front</a>` : ''}
        ${application.collateralBack ? `<a class="proof-link" href="#" data-upload-filename="${escapeHtml(application.collateralBack)}">View collateral back</a>` : ''}
      </div>
    </article>
  `).join('');

  modalBody.innerHTML = `
    <h2>Customer: ${escapeHtml(selectedUser.username || 'Unknown user')}</h2>
    <p><strong>Email:</strong> ${escapeHtml(selectedUser.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(selectedUser.phone || 'N/A')}</p>
    <p><strong>Record:</strong> ${selectedUser.quickScreenApplicant ? 'Quick Screen applicant (not a registered login)' : escapeHtml(selectedUser.role || 'user')}</p>
    ${applicationHistory ? `<section class="customer-application-history"><h3>Quick Screen history</h3>${applicationHistory}</section>` : ''}
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
    const loanParams = addAllStoreScope(new URLSearchParams({ email: user.email }));
    const response = await fetch(`/loans?${loanParams}`, {
      headers: getCustomerScopeHeaders()
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
  document.getElementById('createUserForm').reset();
  document.getElementById('newUserRole').querySelector('option[value="user"]').hidden = false;
  document.getElementById('createUserTitle').textContent = 'Create New User';
  const returnPage = createUserReturnPage;
  if (adminPageHistory[adminPageHistory.length - 1] === returnPage) adminPageHistory.pop();
  createUserMode = 'customer';
  setCreateUserMessage('');
  showAdminPage(returnPage, { recordHistory: false });
}

function closeAnnouncementModal() {
  document.getElementById('announcementForm').reset();
  document.getElementById('announcementFeedback').textContent = '';
  showAdminPage('portfolioOverview');
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
    renderDirectoryPagination('hrPagination', 1, 0, 'hr');
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
  if (!list) return;
  if (!hrEmployees.length) {
    if (summary) summary.textContent = '0 staff accounts';
    list.innerHTML = '<div class="directory-empty">No employee accounts are configured for this store.</div>';
    renderDirectoryPagination('hrPagination', 1, 0, 'hr');
    return;
  }
  const term = (document.getElementById('hrSearch')?.value || '').trim().toLowerCase();
  const role = document.getElementById('hrRoleFilter')?.value || '';
  const from = document.getElementById('hrDateFrom')?.value || '';
  const to = document.getElementById('hrDateTo')?.value || '';
  const filtered = hrEmployees.filter(emp => {
    const textMatches = !term || [emp.username, emp.email, emp.phone, emp.nrc, emp.id, emp.storeId]
      .some(value => String(value || '').toLowerCase().includes(term));
    return textMatches && (!role || emp.role === role) && dateMatchesRange(emp.createdAt, from, to);
  });
  const page = getDirectoryPage(filtered, hrDirectoryPage);
  hrDirectoryPage = page.currentPage;
  if (summary) summary.textContent = `${filtered.length} of ${hrEmployees.length} staff accounts match the filters · page ${page.currentPage} of ${page.pageCount}.`;
  if (!filtered.length) {
    list.innerHTML = '<div class="directory-empty" role="status">No staff accounts match these filters.</div>';
    renderDirectoryPagination('hrPagination', page.currentPage, 0, 'hr');
    return;
  }
  list.innerHTML = page.items.map(emp => {
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
  renderDirectoryPagination('hrPagination', page.currentPage, filtered.length, 'hr');
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
async function openAddLoanModal() {
  if (!usersLoaded) await fetchUsers();
  const select = document.getElementById('addLoanCustomer');
  const customers = registeredUsers.filter(user => !['admin', 'franchise_admin', 'store_admin'].includes(user.role));
  select.innerHTML = customers.length
    ? '<option value="">Select a registered customer…</option>' + customers
      .map(user => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.username || '')} — ${escapeHtml(user.email || '')}</option>`)
      .join('')
    : '<option value="" disabled selected>No registered customers found</option>';
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
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.querySelector('[data-close-modal]')?.click();
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openModals = [...document.querySelectorAll('.modal')]
    .filter(modal => !modal.hidden && getComputedStyle(modal).display !== 'none');
  openModals[openModals.length - 1]?.querySelector('[data-close-modal]')?.click();
});
document.querySelectorAll('[data-store]').forEach(button => {
  button.addEventListener('click', () => enterStore(button.dataset.store));
});
document.getElementById('adminThemeToggle')?.addEventListener('click', () => {
  const theme = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('adminTheme', theme);
  applyTheme(theme);
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
document.getElementById('createUserBtn').addEventListener('click', () => {
  openCreateUserModal('customer');
});
document.getElementById('announcementBtn').addEventListener('click', () => {
  showAdminPage('announcementView');
});
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
document.getElementById('addLoanFromLoansBtn')?.addEventListener('click', openAddLoanModal);
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
document.getElementById('hrRefreshBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchHrEmployees));
['hrSearch', 'hrRoleFilter', 'hrDateFrom', 'hrDateTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'hrSearch' ? 'input' : 'change', () => {
    hrDirectoryPage = 1;
    renderHrEmployees();
  });
});
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
  const term = (document.getElementById('userSearch')?.value || '').trim().toLowerCase();
  const sortBy = document.getElementById('userSort')?.value || 'name';
  const dateBasis = document.getElementById('customerDateBasis')?.value || 'loan';
  const from = document.getElementById('userDateFrom')?.value || '';
  const to = document.getElementById('userDateTo')?.value || '';
  let filtered = allUsers.filter((user) => {
    const email = String(user.email || '').trim().toLowerCase();
    const relatedLoans = customerLoans.filter(loan => String(loan.email || '').trim().toLowerCase() === email);
    const fields = [user.username, user.email, user.phone, user.nrc, user.nrcNumber, user.id];
    const loanMatches = relatedLoans.some(loan =>
      [loan.receiptNumber, loan.id, loan.product, loan.status]
        .some(value => String(value || '').toLowerCase().includes(term))
    );
    const textMatches = !term || loanMatches || fields.some(value => String(value || '').toLowerCase().includes(term));
    const dateMatches = dateBasis === 'registered'
      ? dateMatchesRange(user.createdAt || user.registeredAt, from, to)
      : (!from && !to) || relatedLoans.some(loan => dateMatchesRange(loan.createdAt || loan.requestedAt, from, to));
    return textMatches && dateMatches;
  });
  if (sortBy === 'loans') {
    filtered = filtered.slice().sort((a, b) => getCustomerLoanStats(b.email).count - getCustomerLoanStats(a.email).count);
  } else if (sortBy === 'outstanding') {
    filtered = filtered.slice().sort((a, b) => getCustomerLoanStats(b.email).outstanding - getCustomerLoanStats(a.email).outstanding);
  } else {
    filtered = filtered.slice().sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
  }
  const page = getDirectoryPage(filtered, customerDirectoryPage, CUSTOMER_DIRECTORY_PAGE_SIZE);
  customerDirectoryPage = page.currentPage;
  renderUsers(page.items);
  renderDirectoryPagination('customerPagination', customerDirectoryPage, filtered.length, 'customers', CUSTOMER_DIRECTORY_PAGE_SIZE);
  const status = document.getElementById('customerDirectoryStatus');
  const resultCount = document.getElementById('customerResultCount');
  if (resultCount) resultCount.textContent = `${filtered.length} customer records`;
  if (status && usersLoaded) {
    status.textContent = customerLoansError
      ? `${filtered.length} customer${filtered.length === 1 ? '' : 's'} match the filters. Loan totals unavailable: ${customerLoansError}`
      : `${filtered.length} customer${filtered.length === 1 ? '' : 's'} match the filters · page ${customerDirectoryPage} of ${page.pageCount}.`;
  }
}
document.getElementById('userSearch').addEventListener('input', () => {
  customerDirectoryPage = 1;
  applyUserFilterAndSort();
});
document.getElementById('userSort')?.addEventListener('change', () => {
  customerDirectoryPage = 1;
  applyUserFilterAndSort();
});
['customerDateBasis', 'userDateFrom', 'userDateTo'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    customerDirectoryPage = 1;
    applyUserFilterAndSort();
  });
});
document.getElementById('refreshCustomerDirectory')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchUsers));
document.getElementById('refreshRequestsBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchNewRequests));
document.getElementById('refreshPortfolioBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchNewRequests));
document.getElementById('adminDashboard')?.addEventListener('click', event => {
  const navButton = event.target.closest('.admin-nav-item');
  if (navButton) {
    const pageId = navButton.dataset.adminPage;
    const action = navButton.dataset.dashboardAction;
    if (pageId) {
      if (pageId === 'portfolioOverview') showDashboard();
      else if (pageId === 'customersView') showCustomersView();
      else if (pageId === 'hrView') showHrView();
      else if (pageId === 'applicationsView') showApplicationsView();
      else if (pageId === 'createUserView') openCreateUserModal('customer');
      else if (pageId === 'inviteView') openInviteModal();
      else showAdminPage(pageId);
    } else if (action) {
      const actions = {
        'switch-store': () => {
          if (BMF_STORES.length > 1) {
            localStorage.removeItem('adminStore');
            showStoreSelection();
          }
        },
        logout: logoutAdmin
      };
      actions[action]?.();
    }
  }

  const jumpButton = event.target.closest('[data-admin-jump]');
  if (jumpButton) showAdminPage(jumpButton.dataset.adminJump);
});
document.getElementById('jumpCustomersBtn')?.addEventListener('click', showCustomersView);
document.getElementById('loanStatusFilter')?.addEventListener('change', () => {
  loanTablePage = 1;
  renderPortfolioOverview();
});
document.getElementById('allLoansViewBtn')?.addEventListener('click', () => showAdminPage('allLoansView'));
document.getElementById('loanTablePagination')?.addEventListener('click', event => {
  const button = event.target.closest('[data-loan-page]');
  if (!button || button.disabled) return;
  const page = Number(button.dataset.loanPage);
  if (!Number.isInteger(page) || page < 1) return;
  loanTablePage = page;
  renderPortfolioOverview();
});
document.querySelectorAll('[data-collection-range]').forEach(button => {
  button.addEventListener('click', () => {
    activeCollectionRange = button.dataset.collectionRange;
    const error = document.getElementById('collectionRangeError');
    if (error) error.textContent = '';
    renderPortfolioOverview();
  });
});
document.getElementById('collectionRangeFrom')?.addEventListener('change', event => {
  customCollectionFrom = event.currentTarget.value;
  document.getElementById('collectionRangeError').textContent = '';
});
document.getElementById('collectionRangeTo')?.addEventListener('change', event => {
  customCollectionTo = event.currentTarget.value;
  document.getElementById('collectionRangeError').textContent = '';
});
document.getElementById('applyCollectionRange')?.addEventListener('click', () => {
  const error = document.getElementById('collectionRangeError');
  const start = customCollectionFrom ? new Date(`${customCollectionFrom}T00:00:00`) : null;
  const end = customCollectionTo ? new Date(`${customCollectionTo}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    error.textContent = 'Choose both a start date and an end date.';
    return;
  }
  if (start > end) {
    error.textContent = 'The start date must be on or before the end date.';
    return;
  }
  if (end > today) {
    error.textContent = 'The end date cannot be in the future.';
    return;
  }
  error.textContent = '';
  activeCollectionRange = 'CUSTOM';
  renderPortfolioOverview();
});
document.getElementById('dailyReportQuickBtn')?.addEventListener('click', () => {
  pullReport('daily-cashbook', 'xlsx');
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
['allLoansList', 'overdueLoansList', 'defaultersLoansList'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', event => {
    const notifyButton = event.target.closest('[data-notify-loan]');
    if (notifyButton) {
      sendOverdueNotice(notifyButton.dataset.notifyLoan);
      return;
    }
    const userButton = event.target.closest('[data-user-id]');
    if (userButton?.dataset.userId) viewUserDetails(userButton.dataset.userId);
  });
});
['allLoansSearch', 'allLoansStatus', 'allLoansFrom', 'allLoansTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'allLoansSearch' ? 'input' : 'change', () => {
    loanDirectoryPages.allLoansView = 1;
    renderLoanDirectory('allLoansView');
  });
});
['overdueSearch', 'overdueFrom', 'overdueTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'overdueSearch' ? 'input' : 'change', () => {
    loanDirectoryPages.overdueView = 1;
    renderLoanDirectory('overdueView');
  });
});
['defaultersSearch', 'defaultersFrom', 'defaultersTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'defaultersSearch' ? 'input' : 'change', () => {
    loanDirectoryPages.defaultersView = 1;
    renderLoanDirectory('defaultersView');
  });
});
['paymentsSearch', 'paymentsFrom', 'paymentsTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'paymentsSearch' ? 'input' : 'change', () => {
    paymentDirectoryPage = 1;
    renderPaymentsView();
  });
});
document.getElementById('refreshPaymentsBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchPayments));
document.getElementById('refreshAllLoansBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, async () => {
  await fetchCustomerLoans();
  renderLoanDirectory('allLoansView');
}));
document.getElementById('refreshOverdueBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, async () => {
  await fetchCustomerLoans();
  renderLoanDirectory('overdueView');
}));
document.getElementById('refreshDefaultersBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, async () => {
  await fetchCustomerLoans();
  renderLoanDirectory('defaultersView');
}));
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
  const applicationAction = event.target.closest('[data-notification-application-action]');
  if (applicationAction) {
    const applicationId = applicationAction.dataset.applicationId;
    const action = applicationAction.dataset.notificationApplicationAction;
    if (action === 'view') {
      const notification = adminNotifications.find(item =>
        item.type === 'application-request' && String(item.applicationId) === String(applicationId)
      );
      if (notification) markAdminNotificationRead(notification.id);
      document.getElementById('adminNotificationMenu')?.classList.add('hidden');
      showApplicationsView(applicationId);
      return;
    }
    document.getElementById('adminNotificationMenu')?.classList.add('hidden');
    reviewApplication(applicationId, action);
    return;
  }
  const review = event.target.closest('[data-notification-open-loan]');
  if (!review) return;
  const loan = portfolioLoans.find(item => String(item.id) === String(review.dataset.notificationOpenLoan));
  const customer = loan ? findCustomerForLoan(loan) : null;
  markAdminNotificationRead(review.dataset.notificationId);
  if (customer) viewUserDetails(customer.id);
  else document.getElementById('requestQueue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('adminNotificationMenu')?.classList.add('hidden');
});
document.getElementById('viewAllNotifications')?.addEventListener('click', () => {
  showAllAdminNotifications = !showAllAdminNotifications;
  renderAdminNotifications();
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
  showAdminPage('inviteView');
  fetchInvites();
}

function closeInviteModal() {
  document.getElementById('inviteForm').reset();
  showAdminPage('portfolioOverview');
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

// ─── Applications view: action buttons + refresh/back ─────────────────────────
document.getElementById('applicationsList')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-app-action]');
  if (!btn) return;
  const appId = btn.dataset.appId;
  const action = btn.dataset.appAction;
  if (appId && action) reviewApplication(appId, action);
});

document.getElementById('applicationsRefreshBtn')?.addEventListener('click', event => runRefresh(event.currentTarget, fetchApplications));
['applicationSearch', 'applicationStatusFilter', 'applicationDateFrom', 'applicationDateTo'].forEach(id => {
  const control = document.getElementById(id);
  control?.addEventListener(id === 'applicationSearch' ? 'input' : 'change', () => {
    applicationDirectoryPage = 1;
    renderApplications();
  });
});
document.querySelectorAll('.directory-pagination').forEach(nav => {
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-directory-page]');
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (!Number.isInteger(page) || page < 1) return;
    if (button.dataset.directoryPage === 'customers') {
      customerDirectoryPage = page;
      applyUserFilterAndSort();
    } else if (button.dataset.directoryPage === 'hr') {
      hrDirectoryPage = page;
      renderHrEmployees();
    } else if (button.dataset.directoryPage === 'applications') {
      applicationDirectoryPage = page;
      renderApplications();
    } else if (button.dataset.directoryPage === 'payments') {
      paymentDirectoryPage = page;
      renderPaymentsView();
    } else if (['allLoansView', 'overdueView', 'defaultersView'].includes(button.dataset.directoryPage)) {
      loanDirectoryPages[button.dataset.directoryPage] = page;
      renderLoanDirectory(button.dataset.directoryPage);
    }
  });
});

window.onload = () => {
  applyTheme(localStorage.getItem('adminTheme') === 'light' ? 'light' : 'dark');
  restoreSession();
};

window.closeModal = closeModal;
window.closeCreateUserModal = closeCreateUserModal;
window.closeAnnouncementModal = closeAnnouncementModal;
window.viewUserDetails = viewUserDetails;
window.sendOverdueNotice = sendOverdueNotice;
