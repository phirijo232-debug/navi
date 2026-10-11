const adminState = { loans: [], selectedId: null, statusFilter: 'pending' };

function getUrgencyPriority(loan) {
  const urgency = String(loan?.urgency || 'standard').toLowerCase();
  const order = { emergency: 0, urgent: 1, standard: 2, low: 3 };
  return order[urgency] ?? 2;
}

const CANONICAL_STATUSES = ['pending', 'active', 'grace', 'defaulted', 'liquidated', 'paid', 'declined'];
const LEGACY_STATUS_MAP = {
  awaiting_approval: 'pending', approved: 'active', in_progress: 'active',
  'in-progress': 'active', running: 'active', overdue: 'grace',
  default: 'defaulted', liquidation: 'liquidated', recovered: 'liquidated',
  settled: 'paid', closed: 'paid', completed: 'paid', rejected: 'declined'
};
// Canonical lifecycle only — prefer the server's live businessStatus.
function getLoanStatusKey(loan) {
  const canonical = String(loan?.businessStatus || '').trim().toLowerCase();
  if (CANONICAL_STATUSES.includes(canonical)) return canonical;
  const raw = String(loan?.status || '').trim().toLowerCase().replace(/\s+/g, '_');
  return LEGACY_STATUS_MAP[raw] || (CANONICAL_STATUSES.includes(raw) ? raw : 'pending');
}

function getAdminLoanTimeline(loan) {
  const createdAt = new Date(loan?.createdAt || loan?.updatedAt || Date.now());
  if (Number.isNaN(createdAt.getTime())) return 'Recent';

  const diffMs = Date.now() - createdAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Last 7 days';
  if (diffDays <= 30) return 'Last 30 days';
  if (diffDays <= 90) return 'Last 3 months';
  return 'Older request';
}

function getLoanTimeframeLabel(loan) {
  if (loan?.tenureWeeks) return `${loan.tenureWeeks} week${loan.tenureWeeks > 1 ? 's' : ''}`;
  if (loan?.dueDate) return `Due ${formatDate(loan.dueDate)}`;
  return 'Flexible';
}

function formatKwacha(value) {
  const amount = Number(value) || 0;
  return `K${amount.toLocaleString('en-ZM')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB');
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

async function fetchAdminLoans() {
  const token = localStorage.getItem('deviceToken') || '';
  if (!token) {
    document.getElementById('adminLoanList').innerHTML = '<p>Device token missing. Please log in again.</p>';
    return;
  }

  try {
    const res = await fetch('/loans/all', {
      headers: { 'x-device-token': token }
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      document.getElementById('adminLoanList').innerHTML = `<p>${data.error || 'Unable to load loans.'}</p>`;
      return;
    }

    adminState.loans = data.loans || [];
    renderAdminLoanList();
  } catch (err) {
    console.error('Loan review fetch error:', err);
    document.getElementById('adminLoanList').innerHTML = '<p>Unable to load loan review queue.</p>';
  }
}

function renderAdminLoanList() {
  const container = document.getElementById('adminLoanList');
  const statusFilter = adminState.statusFilter || 'pending';

  const filtered = adminState.loans
    .filter(loan => {
      const currentStatus = getLoanStatusKey(loan);
      if (statusFilter === 'all') return true;
      return currentStatus === statusFilter;
    })
    .sort((a, b) => getUrgencyPriority(a) - getUrgencyPriority(b) || new Date(a.createdAt) - new Date(b.createdAt));

  if (!filtered.length) {
    container.innerHTML = '<p>No loans in this review bucket.</p>';
    document.getElementById('adminLoanDetail').classList.add('hidden');
    return;
  }

  container.innerHTML = filtered.map(loan => {
    const statusKey = getLoanStatusKey(loan);
    const badgeClass = statusKey;
    return `
      <button type="button" class="admin-loan-card ${adminState.selectedId === loan.id ? 'selected' : ''}" data-id="${loan.id}">
        <div class="admin-loan-head">
          <strong>${loan.product || 'Loan request'}</strong>
          <span class="loan-badge ${badgeClass || 'pending'}">${formatStatus(loan.status || 'pending')}</span>
        </div>
        <div class="admin-loan-meta">
          <span class="urgency-pill ${String(loan.urgency || 'standard').toLowerCase()}">${formatStatus(loan.urgency || 'standard')}</span>
          <span>${getLoanTimeframeLabel(loan)}</span>
          <span>• ${getAdminLoanTimeline(loan)}</span>
        </div>
        <div class="admin-loan-meta">${loan.email || 'Unknown user'}</div>
        <div class="admin-loan-meta">${formatKwacha(loan.amount)} • Due ${formatDate(loan.dueDate)}</div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.admin-loan-card').forEach(card => {
    card.addEventListener('click', () => openAdminReview(Number(card.dataset.id)));
  });

  if (!adminState.selectedId || !filtered.some(loan => loan.id === adminState.selectedId)) {
    openAdminReview(filtered[0].id);
  }
}

function renderAdminReviewDetail(loan) {
  const detail = document.getElementById('adminLoanDetail');
  if (!loan) {
    detail.classList.add('hidden');
    return;
  }

  const frontName = loan.collateralFront ? loan.collateralFront.replace(/^[^\-]+-/, '') : '';
  const backName = loan.collateralBack ? loan.collateralBack.replace(/^[^\-]+-/, '') : '';
  const frontLink = loan.collateralFront ? `<a href="/uploads/${loan.collateralFront}" target="_blank" rel="noreferrer" class="attachment-btn">View front image</a>` : '<span class="attachment-empty">No front image</span>';
  const backLink = loan.collateralBack ? `<a href="/uploads/${loan.collateralBack}" target="_blank" rel="noreferrer" class="attachment-btn">View back image</a>` : '<span class="attachment-empty">No back image</span>';
  const statusKey = getLoanStatusKey(loan);
  const statusLabel = formatStatus(loan.businessStatus || loan.status || 'pending');
  const activityLog = Array.isArray(loan.statusHistory) && loan.statusHistory.length
    ? loan.statusHistory.map(entry => `
        <li>
          <span>${formatStatus(entry.status || 'pending')}</span>
          <small>${new Date(entry.updatedAt || Date.now()).toLocaleString()}</small>
          <p>${entry.reason || 'No reason provided.'}</p>
        </li>
      `).join('')
    : '<li><p>No activity recorded yet.</p></li>';

  detail.innerHTML = `
    <div class="admin-review-box">
      <div class="admin-review-header">
        <div>
          <h3>${loan.product || 'Loan Request'}</h3>
          <div class="admin-review-meta-row">
            <span class="loan-badge ${statusKey || 'pending'}">${statusLabel}</span>
            <span>${loan.email || 'Unknown borrower'}</span>
          </div>
        </div>
        <span class="timeframe-chip">${getLoanTimeframeLabel(loan)}</span>
      </div>

      <div class="admin-review-grid">
        <p><strong>Borrower:</strong> ${loan.email || 'Unknown'}</p>
        <p><strong>Amount:</strong> ${formatKwacha(loan.amount)}</p>
        <p><strong>Interest:</strong> ${formatKwacha(loan.interestAmount || 0)}</p>
        <p><strong>Total:</strong> ${formatKwacha(loan.totalRepayment || loan.amount || 0)}</p>
        <p><strong>Outstanding:</strong> ${formatKwacha(loan.outstanding || 0)}</p>
        <p><strong>Due date:</strong> ${formatDate(loan.dueDate)}</p>
        <p><strong>Urgency:</strong> ${formatStatus(loan.urgency || 'standard')}</p>
        <p><strong>Tenure:</strong> ${loan.tenureWeeks ? `${loan.tenureWeeks} week${loan.tenureWeeks > 1 ? 's' : ''}` : 'Not provided'}</p>
        <p><strong>Payment mode:</strong> ${loan.paymentMode || 'Not specified'}</p>
        <p><strong>Collateral:</strong> ${loan.collateralDescription || 'No description provided'}</p>
        <p><strong>Collateral grade:</strong> ${loan.collateralGrade || 'Pending review'}</p>
        <p><strong>Verified:</strong> ${loan.collateralVerified ? 'Yes' : 'No'}</p>
        <p><strong>Approval target:</strong> ${formatDate(loan.approvalDeadline)}</p>
        <p class="admin-review-full"><strong>Reason:</strong> ${loan.adminReason || 'No decision reason provided yet.'}</p>
      </div>

      <div class="attachment-panel">
        <h4>Attachments</h4>
        <div class="attachment-actions">
          ${frontLink}
          ${backLink}
        </div>
      </div>

      <div class="admin-review-history">
        <h4>Loan activity log</h4>
        <ul>${activityLog}</ul>
      </div>

      <label for="adminDecisionReason">Decision reason</label>
      <textarea id="adminDecisionReason" rows="3" placeholder="Add the reason for the approval, in-progress, or decline decision."></textarea>

      <div class="admin-actions">
        <button type="button" class="decision-btn" data-action="in_progress">In Progress</button>
        <button type="button" class="decision-btn" data-action="approve">Approve</button>
        <button type="button" class="decision-btn decline" data-action="decline">Decline</button>
      </div>
    </div>
  `;

  detail.classList.remove('hidden');
  detail.querySelectorAll('.decision-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const reason = document.getElementById('adminDecisionReason').value.trim();
      await submitAdminDecision(loan.id, button.dataset.action, reason);
    });
  });
}

function openAdminReview(loanId) {
  adminState.selectedId = loanId;
  const loan = adminState.loans.find(item => item.id === loanId);
  renderAdminReviewDetail(loan);
}

async function submitAdminDecision(loanId, action, reason) {
  const token = localStorage.getItem('deviceToken') || '';
  if (!token) return;

  const res = await fetch(`/loans/${loanId}/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-token': token
    },
    body: JSON.stringify({ action, reason })
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    alert(data.error || 'Unable to update loan status.');
    return;
  }

  adminState.selectedId = null;
  await fetchAdminLoans();
}

function renderFeedbackSummary(feedback) {
  const summaryWrap = document.getElementById('feedbackSummary');
  if (!summaryWrap) return;

  const summary = feedback.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, { complaint: 0, improvement: 0, inquiry: 0, experience: 0 });

  summaryWrap.innerHTML = `
    <div class="feedback-pill complaint">Complaints: <strong>${summary.complaint}</strong></div>
    <div class="feedback-pill improvement">Improvements: <strong>${summary.improvement}</strong></div>
    <div class="feedback-pill inquiry">Inquiries: <strong>${summary.inquiry}</strong></div>
    <div class="feedback-pill experience">Experience: <strong>${summary.experience}</strong></div>
  `;
}

function renderFeedbackList(feedback) {
  const list = document.getElementById('feedbackList');
  if (!list) return;

  const categoryFilter = window.currentFeedbackCategory || 'all';
  const filtered = categoryFilter === 'all'
    ? feedback
    : feedback.filter(item => item.category === categoryFilter);

  if (!filtered.length) {
    list.innerHTML = '<p>No customer feedback in this category yet.</p>';
    return;
  }

  list.innerHTML = filtered.slice(-8).reverse().map(item => `
    <div class="feedback-item">
      <div class="feedback-head">
        <span class="feedback-tag ${item.category}">${formatStatus(item.category)}</span>
        <span>${item.status || 'new'}</span>
      </div>
      <p>${item.message}</p>
      <small>${item.email} • ${new Date(item.createdAt).toLocaleString('en-GB')}</small>
    </div>
  `).join('');
}

async function fetchFeedbackData() {
  const token = localStorage.getItem('deviceToken') || '';
  if (!token || localStorage.getItem('userRole') !== 'admin') return;

  try {
    const res = await fetch('/feedback', { headers: { 'x-device-token': token } });
    const data = await res.json();
    if (!res.ok || data.error) {
      const list = document.getElementById('feedbackList');
      if (list) list.innerHTML = `<p>${data.error || 'Unable to load feedback.'}</p>`;
      return;
    }

    const entries = data.feedback || [];
    renderFeedbackSummary(entries);
    renderFeedbackList(entries);
  } catch (err) {
    console.error('Feedback load error:', err);
    const list = document.getElementById('feedbackList');
    if (list) list.innerHTML = '<p>Unable to load feedback.</p>';
  }
}

window.currentFeedbackCategory = 'all';

document.querySelectorAll('.admin-loan-filter').forEach(button => {
  button.addEventListener('click', () => {
    adminState.statusFilter = button.dataset.adminStatus || 'pending';
    document.querySelectorAll('.admin-loan-filter').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    renderAdminLoanList();
  });
});

document.querySelectorAll('.feedback-filter').forEach(button => {
  button.addEventListener('click', () => {
    window.currentFeedbackCategory = button.dataset.category || 'all';
    document.querySelectorAll('.feedback-filter').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    fetchFeedbackData();
  });
});

document.querySelectorAll('.menu-action').forEach(button => {
  button.addEventListener('click', () => {
    const category = button.dataset.feedback || 'all';
    window.currentFeedbackCategory = category;
    document.querySelectorAll('.feedback-filter').forEach(item => {
      const isMatch = item.dataset.category === category;
      item.classList.toggle('active', isMatch || (category === 'all' && item.dataset.category === 'all'));
    });
    fetchFeedbackData();
    document.getElementById('menuDropdown').classList.remove('active');
  });
});

async function fetchData() {
  try {
    const token = localStorage.getItem('deviceToken') || '';
    const headers = { 'x-device-token': token };

    const status = await fetch('/status', { headers }).then(r => r.json());
    const sessions = await fetch('/sessions', { headers }).then(r => r.json());
    const accessLogs = await fetch('/logs/access', { headers }).then(r => r.json());
    const errorLogs = await fetch('/logs/errors', { headers }).then(r => r.json());

    document.getElementById('status').textContent = status.status.toUpperCase();
    document.getElementById('uptime').textContent = status.uptime;
    document.getElementById('ram').textContent = status.ram.used;
    document.getElementById('cpu').textContent = status.cpu.cores + ' Cores';
    document.getElementById('sessions').textContent = sessions.total;

    const accessList = document.getElementById('access-log');
    accessList.innerHTML = accessLogs.logs.slice(-10).reverse()
      .map(l => `<li>${l}</li>`).join('');

    const errorList = document.getElementById('error-log');
    errorList.innerHTML = errorLogs.logs.slice(-10).reverse()
      .map(l => `<li class="threat">${l}</li>`).join('');

  } catch (err) {
    console.error('Dashboard fetch error:', err);
  }
}

async function fetchFranchiseReport() {
  if (localStorage.getItem('userRole') !== 'admin') return;
  const metrics = document.getElementById('franchiseMetrics');
  try {
    const response = await fetch('/reports/franchise/summary', {
      headers: { 'x-device-token': localStorage.getItem('deviceToken') || '' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load franchise report.');
    const summary = data.summary;
    const values = [
      ['Customer accounts', summary.customerAccounts],
      ['Loan records', summary.totalLoans],
      ['Principal approved', formatKwacha(summary.approvedLoanPrincipal)],
      ['Cash collected', formatKwacha(summary.cashCollected)],
      ['Gross interest booked', formatKwacha(summary.grossInterestBooked)],
      ['Outstanding balances', formatKwacha(summary.totalOutstanding)],
      ['Pending payments', summary.pendingPayments],
      ['Partial payments', summary.partialPayments],
      ['Defaulters', summary.defaulters],
      ['Settled loans', summary.settledLoans],
      ['Loyal customers', summary.loyalCustomers]
    ];
    metrics.innerHTML = values.map(([label, value]) => `
      <div class="report-metric"><span>${label}</span><strong>${value}</strong></div>
    `).join('');
    document.getElementById('franchiseReportNote').textContent = data.note || '';
  } catch (err) {
    metrics.innerHTML = `<p>${err.message || 'Unable to load franchise report.'}</p>`;
  }
}

async function downloadFranchiseReport(format) {
  try {
    const response = await fetch(`/reports/franchise/export?format=${encodeURIComponent(format)}`, {
      headers: { 'x-device-token': localStorage.getItem('deviceToken') || '' }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to download report.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pryme-vertex-franchise-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    document.getElementById('franchiseReportNote').textContent = err.message || 'Unable to download report.';
  }
}

document.querySelectorAll('[data-franchise-export]').forEach(button => {
  button.addEventListener('click', () => downloadFranchiseReport(button.dataset.franchiseExport));
});

fetchData();
setInterval(fetchData, 5000);
fetchFranchiseReport();
setInterval(fetchFranchiseReport, 5 * 60 * 1000);