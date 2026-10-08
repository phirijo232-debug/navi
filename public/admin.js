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
let storeFeedback = [];
let activeFeedbackFilter = 'all';
let pendingEmail = '';
let pendingResetEmail = '';

function applyTheme(theme) {
  document.documentElement.classList.remove('dark', 'light');
  document.body.classList.remove('dark', 'light');
  document.documentElement.classList.add(theme);
  document.body.classList.add(theme);
}

function toggleTheme() {
  const nextMode = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(nextMode);
  localStorage.setItem('mode', nextMode);
}

function showAuthScreen() {
  document.getElementById('storeSelect').classList.add('hidden');
  document.getElementById('adminAuth').classList.remove('hidden');
  document.getElementById('adminDashboard').classList.add('hidden');
  showAdminLogin();
}

function showDashboard() {
  document.getElementById('storeSelect').classList.add('hidden');
  document.getElementById('adminAuth').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
}

function showStoreSelection() {
  document.getElementById('storeSelect').classList.remove('hidden');
  document.getElementById('adminAuth').classList.add('hidden');
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('storeContext').textContent = '';
}

function enterStore(storeId) {
  if (storeId !== 'buraza') return;
  localStorage.setItem('adminStore', storeId);
  document.getElementById('storeContext').textContent = 'Buraza Micro Finance · BMF';

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
  el.style.color = isError ? '#ff9ca9' : '#d6e7ff';
}

function setCreateUserMessage(text, isError = false) {
  const el = document.getElementById('createUserMessage');
  el.textContent = text;
  el.style.color = isError ? '#ff9ca9' : '#d6e7ff';
}

function setLoader(active) {
  document.getElementById('loader').classList.toggle('active', active);
}

function getDeviceToken() {
  return localStorage.getItem('deviceToken') || '';
}

function getStoreHeaders(extraHeaders = {}) {
  return {
    'x-device-token': getDeviceToken(),
    'x-business-unit': localStorage.getItem('adminStore') || 'buraza',
    ...extraHeaders
  };
}

function ensureAdminAccess() {
  const token = getDeviceToken();
  const role = localStorage.getItem('userRole');
  const userStoreId = localStorage.getItem('userStoreId') || 'buraza';
  const isStoreOperator = role === 'store_admin' && userStoreId === 'buraza';
  if (!token || (role !== 'admin' && !isStoreOperator)) {
    showAuthScreen();
    return false;
  }
  return true;
}

function applyRolePermissions() {
  const role = localStorage.getItem('userRole');
  const canManageStore = role === 'store_admin';
  document.getElementById('announcementBtn').hidden = !canManageStore;
  document.getElementById('notifyOverdueBtn').hidden = !canManageStore;
  document.querySelector('#newUserRole option[value="store_admin"]').hidden = role !== 'admin';
}

async function fetchUsers() {
  if (!ensureAdminAccess()) return;

  try {
    const response = await fetch('/users', {
      headers: getStoreHeaders()
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to fetch users');
    }

    allUsers = await response.json();
    renderUsers(allUsers);
    await Promise.all([fetchStoreReport(), fetchStoreFeedback()]);
  } catch (err) {
    console.error(err);
    setAuthMessage('Access denied or session expired. Please login again.', true);
    localStorage.removeItem('deviceToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('username');
    showAuthScreen();
  }
}

async function fetchStoreReport() {
  const metrics = document.getElementById('storeReportMetrics');
  try {
    const response = await fetch('/reports/buraza/summary', { headers: getStoreHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load BMF reports.');
    const summary = data.summary;
    const values = [
      ['Cash collected', formatCurrency(summary.cashCollected)],
      ['Gross interest booked', formatCurrency(summary.grossInterestBooked)],
      ['Outstanding', formatCurrency(summary.totalOutstanding)],
      ['Pending payments', String(summary.pendingPayments)],
      ['Partial payments', String(summary.partialPayments)],
      ['Settled loans', String(summary.settledLoans)],
      ['Defaulters', String(summary.defaulters)],
      ['Loyal customers', String(summary.loyalCustomers)]
    ];
    metrics.innerHTML = values.map(([label, value]) => `
      <div class="report-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join('');
    document.getElementById('storeReportNote').textContent = data.note || '';
  } catch (err) {
    metrics.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load BMF reports.')}</p>`;
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

async function downloadStoreReport(format) {
  const note = document.getElementById('storeReportNote');
  try {
    const response = await fetch(`/reports/buraza/export?format=${encodeURIComponent(format)}`, {
      headers: getStoreHeaders()
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to download report.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `buraza-ledger-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    note.textContent = 'Report downloaded.';
  } catch (err) {
    note.textContent = err.message || 'Unable to download report.';
  }
}

function renderUsers(users) {
  const list = document.getElementById('userList');
  if (!users.length) {
    list.innerHTML = '<div class="panel" style="padding: 22px;">No users found.</div>';
    return;
  }

  list.innerHTML = users.map((user) => `
    <button type="button" class="user-card" data-user-id="${escapeHtml(user.id)}">
      <h3>${escapeHtml(user.username || 'Unknown user')}</h3>
      <p class="user-meta">${escapeHtml(user.email || '')}</p>
      <p class="user-meta">Phone: ${escapeHtml(user.phone || 'N/A')}</p>
      <p class="user-meta">Role: ${escapeHtml(user.role || 'user')}</p>
    </button>
  `).join('');
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

function formatDate(dateValue) {
  if (!dateValue) return 'Not set';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleString();
}

function getLoanStatus(loan) {
  const status = String(loan.status || 'pending').toLowerCase().replace(/\s+/g, '_');
  // Lifecycle statuses that must never be masked by the overdue derivation.
  if (['declined', 'paid', 'defaulted', 'liquidated'].includes(status)) return status;
  const dueDate = String(loan.dueDate || '').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (Number(loan.outstanding || 0) > 0 && dueDate && dueDate < today) {
    return 'overdue';
  }
  return status;
}

function renderLoanDetails(loan) {
  const status = getLoanStatus(loan);
  const canManageStore = localStorage.getItem('userRole') === 'store_admin';
  const history = Array.isArray(loan.statusHistory) && loan.statusHistory.length
    ? loan.statusHistory.map(entry => `
        <li>
          <strong>${escapeHtml(String(entry.status || 'updated').replace(/_/g, ' '))}</strong>
          <div>${escapeHtml(entry.reason || 'No reason provided.')}</div>
          <small>${escapeHtml(formatDate(entry.updatedAt || loan.updatedAt))}</small>
        </li>
      `).join('')
    : '<li>No status history.</li>';
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  const paymentHistory = payments.length ? payments.map(payment => `
    <li>
      ${formatCurrency(payment.amount)} · ${escapeHtml(payment.mode || 'payment')} · ${escapeHtml(formatDate(payment.date))}
      ${payment.note ? `<div>${escapeHtml(payment.note)}</div>` : ''}
      ${payment.screenshot ? `<a class="proof-link" href="/uploads/${encodeURIComponent(payment.screenshot)}" target="_blank" rel="noopener">View proof of payment</a>` : '<span>No proof attached</span>'}
    </li>
  `).join('') : '<li>No payments recorded.</li>';
  const proofLinks = [loan.collateralFront, loan.collateralBack].filter(Boolean).map((filename, index) => `
    <a class="proof-link" href="/uploads/${encodeURIComponent(filename)}" target="_blank" rel="noopener">View collateral ${index ? 'back' : 'front'}</a>
  `).join('');
  const outstanding = Number(loan.outstanding || 0);
  // Accept both the legacy vocabulary (approved/in_progress/overdue) and the
  // migrated lifecycle (active/grace/defaulted) — stored statuses are 'active'
  // after the migration, so the old list alone hid the Post payment form.
  const canRecordPayment = canManageStore && outstanding > 0 &&
    ['approved', 'in_progress', 'overdue', 'active', 'grace', 'defaulted'].includes(status);
  const canReview = canManageStore &&
    ['pending', 'approved', 'in_progress', 'active', 'grace'].includes(status);

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
        <p><strong>Requested:</strong> ${escapeHtml(formatDate(loan.createdAt))}</p>
        <p><strong>Borrowed (approved):</strong> ${loan.approvedAt || loan.borrowedDate ? escapeHtml(formatDate(loan.approvedAt || loan.borrowedDate)) : 'Not yet approved'}</p>
      </div>
      ${proofLinks ? `<div>${proofLinks}</div>` : ''}
      ${canReview ? `
        <input type="text" class="modal-input" data-decision-reason="${escapeHtml(loan.id)}" maxlength="300" value="${escapeHtml(loan.adminReason || '')}" placeholder="Decision reason" style="margin-top: 12px;">
        <div class="button-row" style="margin-top: 12px;">
          <button class="toggle-mode" type="button" data-loan-action="approve" data-loan-id="${escapeHtml(loan.id)}">Approve</button>
          <button class="toggle-mode" type="button" data-loan-action="in_progress" data-loan-id="${escapeHtml(loan.id)}">Set in progress</button>
          <button class="toggle-mode" type="button" data-loan-action="decline" data-loan-id="${escapeHtml(loan.id)}">Decline</button>
        </div>` : ''}
      ${canRecordPayment ? `
        <form class="payment-form panel" data-payment-form="${escapeHtml(loan.id)}" style="padding: 14px; margin-top: 14px;">
          <h3>Record payment</h3>
          <input type="number" name="amount" class="modal-input" min="0.01" max="${outstanding}" step="0.01" placeholder="Amount" required>
          <select name="mode" class="modal-input" style="margin-top: 10px;">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="mobile_money">Mobile money</option>
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
// Loans are grouped by approval (borrowed) date; pending loans without an
// approval date fall back to their request date.
const LOAN_STATUS_FILTERS = ['all', 'pending', 'approved', 'in_progress', 'active', 'grace', 'defaulted', 'overdue', 'declined', 'paid'];
const TIMEFRAME_FILTERS = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7', 'Last 7 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['custom', 'Custom range']
];

function getLoanPeriodDate(loan) {
  const source = loan.approvedAt || loan.borrowedDate || loan.createdAt;
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

  modalBody.innerHTML = `
    <h2>Customer: ${escapeHtml(selectedUser.username || 'Unknown user')}</h2>
    <p><strong>Email:</strong> ${escapeHtml(selectedUser.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(selectedUser.phone || 'N/A')}</p>
    <p><strong>Role:</strong> ${escapeHtml(selectedUser.role || 'user')}</p>
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
    <p class="timeframe-note">Showing ${visibleLoans.length} of ${selectedLoans.length} loans — grouped by approval (borrowed) date; pending loans use their request date.</p>
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
    if (selectedUserId !== null) {
      await viewUserDetails(selectedUserId);
    }
  } catch (err) {
    document.getElementById('detailFeedback').textContent = err.message || 'Error recording payment.';
  }
}

async function updateLoanStatus(loanId, action, reason) {
  try {
    const response = await fetch(`/loans/${loanId}/action`, {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, reason: String(reason || '').trim() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not update loan status.');
    document.getElementById('detailFeedback').textContent = data.message || 'Loan status updated.';
    await viewUserDetails(selectedUserId);
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
    alert(result.message || result.error || 'Notification sent');
  } catch (err) {
    alert('Error sending notification');
  }
}

function closeModal() {
  document.getElementById('userModal').style.display = 'none';
}

function closeCreateUserModal() {
  document.getElementById('createUserModal').style.display = 'none';
  document.getElementById('createUserForm').reset();
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
  const recipients = allUsers.filter(user => user.role !== 'admin' && user.role !== 'store_admin').length;

  if (!subject || !message) {
    document.getElementById('announcementFeedback').textContent = 'Enter a subject and message.';
    return;
  }

  if (!window.confirm(`Send this announcement to ${recipients} registered Buraza customers?`)) return;

  const feedback = document.getElementById('announcementFeedback');
  feedback.textContent = 'Sending announcement...';

  try {
    const response = await fetch('/admin/announcements', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subject, message })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send announcement.');
    feedback.textContent = data.message || `Sent to ${data.sent} customers; ${data.failed} failed.`;
  } catch (err) {
    feedback.textContent = err.message || 'Unable to send announcement.';
  }
}

async function notifyAllOverdue() {
  const confirmed = window.confirm('Send overdue notices to all Buraza customers with an overdue balance?');
  if (!confirmed) return;

  const button = document.getElementById('notifyOverdueBtn');
  button.disabled = true;
  try {
    const response = await fetch('/loans/notify-overdue', {
      method: 'POST',
      headers: getStoreHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send overdue notices.');
    window.alert(data.message || `Sent: ${data.sent}; failed: ${data.failed}; no overdue loans: ${data.skipped}.`);
  } catch (err) {
    window.alert(err.message || 'Unable to send overdue notices.');
  } finally {
    button.disabled = false;
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
    document.getElementById('resetOtpSentTo').textContent = `Reset code sent to: ${data.otpSentTo}`;
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
      if (!['admin', 'store_admin'].includes(data.role)) {
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
  localStorage.removeItem('deviceToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userStoreId');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('username');
  localStorage.removeItem('lastAppPage');
  localStorage.removeItem('adminStore');
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
    role: document.getElementById('newUserRole').value,
    password: document.getElementById('newUserPassword').value,
    confirmPassword: document.getElementById('newUserConfirmPassword').value
  };

  if (!payload.username || !payload.email || !payload.password || !payload.confirmPassword) {
    setCreateUserMessage('All required fields must be filled.', true);
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
    await fetchUsers();
    setTimeout(closeCreateUserModal, 700);
  } catch (err) {
    setCreateUserMessage(err.message || 'User creation failed.', true);
  }
}

document.getElementById('modeBtn').addEventListener('click', toggleTheme);
document.querySelectorAll('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => {
    const modalId = button.dataset.closeModal;
    if (modalId === 'userModal') closeModal();
    if (modalId === 'createUserModal') closeCreateUserModal();
    if (modalId === 'announcementModal') closeAnnouncementModal();
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
  localStorage.removeItem('adminStore');
  showStoreSelection();
});
document.getElementById('createUserBtn').addEventListener('click', () => {
  document.getElementById('createUserModal').style.display = 'block';
});
document.getElementById('announcementBtn').addEventListener('click', () => {
  document.getElementById('announcementModal').style.display = 'block';
});
document.querySelectorAll('[data-report-format]').forEach(button => {
  button.addEventListener('click', () => downloadStoreReport(button.dataset.reportFormat));
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
document.getElementById('userList').addEventListener('click', event => {
  const button = event.target.closest('[data-user-id]');
  if (button) viewUserDetails(button.dataset.userId);
});
document.getElementById('modalBody').addEventListener('click', event => {
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
    updateLoanStatus(actionButton.dataset.loanId, actionButton.dataset.loanAction, reasonInput?.value);
  }
});
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
document.getElementById('userSearch').addEventListener('input', (event) => {
  const term = event.target.value.toLowerCase();
  const filtered = allUsers.filter((user) => {
    const username = (user.username || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    return username.includes(term) || email.includes(term);
  });
  renderUsers(filtered);
});

window.onload = () => {
  const savedMode = localStorage.getItem('mode') || 'dark';
  applyTheme(savedMode);
  showStoreSelection();
};

window.closeModal = closeModal;
window.closeCreateUserModal = closeCreateUserModal;
window.closeAnnouncementModal = closeAnnouncementModal;
window.viewUserDetails = viewUserDetails;
window.sendOverdueNotice = sendOverdueNotice;
