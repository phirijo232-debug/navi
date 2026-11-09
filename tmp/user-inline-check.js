
    const deviceToken = localStorage.getItem('deviceToken');
    localStorage.setItem('lastAppPage', 'user.html');
    const savedMode = localStorage.getItem('mode') || 'dark';
    applyTheme(savedMode);

    async function handleInvalidDeviceToken() {
      localStorage.removeItem('deviceToken');
      localStorage.removeItem('username');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('userRole');
      window.location.href = 'login.html';
    }

    function applyTheme(theme) {
      const activeTheme = theme === 'light' ? 'light' : 'dark';
      document.documentElement.classList.remove('dark', 'light');
      document.body.classList.remove('dark', 'light');
      document.documentElement.classList.add(activeTheme);
      document.body.classList.add(activeTheme);
    }

    document.getElementById('modeBtn').addEventListener('click', function() {
      const body = document.body;
      const nextMode = body.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(nextMode);
      localStorage.setItem('mode', nextMode);
    });

    const username = localStorage.getItem('username') || 'User';
    const userEmail = localStorage.getItem('userEmail');
    const userRole = localStorage.getItem('userRole') || 'user';
    const portalDisplayName = username.split('@')[0];
    const portalInitials = portalDisplayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'BM';
    document.getElementById('portalUserName').textContent = portalDisplayName;
    document.getElementById('portalAvatar').textContent = portalInitials;
    const isNewSignup = localStorage.getItem('newSignup') === 'true';
    const justCreated = isNewSignup; // naming clarity for first-time flow

    let toastTimer;
    function showBmfToast(message, kind = 'success') {
      const node = document.getElementById('bmfToast');
      if (!node) return;
      node.textContent = message;
      node.dataset.kind = kind;
      node.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => node.classList.remove('visible'), 4200);
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function previewDocument(inputId, previewId) {
      const input = document.getElementById(inputId);
      const preview = document.getElementById(previewId);
      input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) { preview?.classList.add('hidden'); preview?.removeAttribute('src'); return; }
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
          input.value = '';
          preview?.classList.add('hidden');
          showBmfToast('Choose a JPG, PNG, or WEBP image up to 5 MB.', 'error');
          return;
        }
        preview.src = URL.createObjectURL(file);
        preview.classList.remove('hidden');
      });
    }
    previewDocument('loanNrcFront', 'loanNrcFrontPreview');
    previewDocument('loanNrcBack', 'loanNrcBackPreview');


    document.getElementById('welcomeName').textContent = username;
    document.getElementById('welcomeAccount').textContent = username;

    if (isNewSignup) {
      document.getElementById('greetingLabel').textContent = 'Welcome Aboard!';
      localStorage.removeItem('newSignup');
    } else {
      document.getElementById('greetingLabel').textContent = 'Welcome Back';
    }
    if (localStorage.getItem('justLoggedIn') === 'true') {
      showBmfToast('Signed in successfully. Your account is ready.');
      localStorage.removeItem('justLoggedIn');
    }

    function formatKwacha(value) {
      const amount = Number(value) || 0;
      return `K ${amount.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function formatDateDisplay(dateValue) {
      if (!dateValue) return '';
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return dateValue;
      return date.toLocaleDateString('en-GB');
    }

    function formatLoanTenure(loan) {
      const days = Number(loan?.tenureDays);
      if (Number.isInteger(days) && days > 0) return days % 7 === 0 ? `${days / 7} week${days === 7 ? '' : 's'}` : `${days} days`;
      const weeks = Number(loan?.tenureWeeks);
      return weeks > 0 ? `${weeks} week${weeks === 1 ? '' : 's'}` : 'Not provided';
    }

    const dueDateInput = document.getElementById('loanDueDate');
    const tenureSelect = document.getElementById('loanTenureWeeks');
    const urgencySelect = document.getElementById('loanUrgency');
    const amountInput = document.getElementById('loanAmount');
    const timeframeButtons = document.querySelectorAll('.timeframe-mode-btn');
    let loanInterestPolicy = null;

    function getCurrentLusakaDateKey() {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    }

    function addDaysToDateKey(dateKey, days) {
      const date = new Date(`${dateKey}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    }

    function calendarDaysBetween(startDate, endDate) {
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return NaN;
      return Math.round((end.getTime() - start.getTime()) / 86400000);
    }

    function getSelectedTermDays() {
      if (dueDateInput.disabled) return (Number(tenureSelect.value) || 1) * 7;
      if (!dueDateInput.value) return NaN;
      return calendarDaysBetween(getCurrentLusakaDateKey(), dueDateInput.value);
    }

    function calculateTermRatePercent(days) {
      if (!loanInterestPolicy || !Number.isInteger(days)) return null;
      const rates = loanInterestPolicy.weeklyRates;
      if (days > 28) {
        const extraRate = Number(loanInterestPolicy.effectiveExtensionDailyRatePercent) || 0;
        return Number((Number(rates[4]) + (days - 28) * extraRate).toFixed(6));
      }
      const lowerWeek = Math.floor(days / 7);
      const upperWeek = Math.ceil(days / 7);
      if (lowerWeek === upperWeek) return Number(rates[lowerWeek]);
      const ratio = (days - lowerWeek * 7) / 7;
      return Number((Number(rates[lowerWeek]) +
        (Number(rates[upperWeek]) - Number(rates[lowerWeek])) * ratio).toFixed(6));
    }

    function updateCustomDateLimits() {
      if (!loanInterestPolicy) return;
      const today = getCurrentLusakaDateKey();
      dueDateInput.min = addDaysToDateKey(today, loanInterestPolicy.minTermDays);
      dueDateInput.max = addDaysToDateKey(today, loanInterestPolicy.maxTermDays);
      if (dueDateInput.value && (dueDateInput.value < dueDateInput.min || dueDateInput.value > dueDateInput.max)) {
        dueDateInput.value = '';
      }
    }

    async function loadCustomerInterestPolicy() {
      const deviceToken = localStorage.getItem('deviceToken');
      try {
        const response = await fetch('/loans/interest-policy', { headers: { 'x-device-token': deviceToken || '' } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Current loan rates could not be loaded.');
        loanInterestPolicy = data;
        updateCustomDateLimits();
        updateLoanEstimateDisplay();
      } catch (error) {
        document.getElementById('loanRateDisplay').textContent = 'Unavailable';
        document.getElementById('loanRequestMessage').textContent = error.message || 'Current loan rates could not be loaded.';
      }
    }

    function getLoanEstimate() {
      const amount = Number(amountInput.value) || 0;
      const days = getSelectedTermDays();
      const rate = calculateTermRatePercent(days);
      const interest = rate == null ? 0 : amount * rate / 100;
      const total = amount + interest;
      const approvalHours = { low: 72, standard: 48, urgent: 24, emergency: 4 };
      const urgency = (urgencySelect.value || 'standard').toLowerCase();
      const approvalTarget = approvalHours[urgency] || 48;
      return { rate, interest, total, approvalTarget, days };
    }

    function setTimeframeMode(mode) {
      const isDateMode = mode === 'date';
      dueDateInput.disabled = !isDateMode;
      dueDateInput.setAttribute('aria-disabled', String(!isDateMode));
      if (!isDateMode) {
        dueDateInput.value = '';
      }
      tenureSelect.disabled = isDateMode;
      tenureSelect.setAttribute('aria-disabled', String(isDateMode));

      timeframeButtons.forEach(button => {
        const isActive = button.dataset.mode === mode;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    }

    function updateLoanEstimateDisplay() {
      if (!loanInterestPolicy) {
        document.getElementById('loanRateDisplay').textContent = 'Loading…';
        return;
      }
      const estimate = getLoanEstimate();
      document.getElementById('loanRateDisplay').textContent = estimate.rate == null ? '—' : `${estimate.rate.toFixed(2)}%`;
      document.getElementById('loanTermDisplay').textContent = Number.isInteger(estimate.days) ? `${estimate.days} days` : 'Choose a date';
      document.getElementById('loanInterestDisplay').textContent = formatKwacha(estimate.interest);
      document.getElementById('loanTotalDisplay').textContent = formatKwacha(estimate.total);
      document.getElementById('loanApprovalDisplay').textContent = `${estimate.approvalTarget}h`;
    }

    amountInput.addEventListener('input', updateLoanEstimateDisplay);
    tenureSelect.addEventListener('change', updateLoanEstimateDisplay);
    dueDateInput.addEventListener('change', updateLoanEstimateDisplay);
    urgencySelect.addEventListener('change', updateLoanEstimateDisplay);

    timeframeButtons.forEach(button => {
      button.addEventListener('click', () => {
        setTimeframeMode(button.dataset.mode);
        updateLoanEstimateDisplay();
      });
    });

    setTimeframeMode('weeks');
    updateLoanEstimateDisplay();
    loadCustomerInterestPolicy();

    const paymentModeSelect = document.getElementById('loanPaymentMode');
    const customPaymentMode = document.getElementById('loanCustomPaymentMode');

    function toggleCustomPaymentMode() {
      const showCustom = paymentModeSelect.value === 'custom';
      customPaymentMode.classList.toggle('hidden', !showCustom);
      customPaymentMode.required = showCustom;
      if (!showCustom) customPaymentMode.value = '';
    }

    paymentModeSelect.addEventListener('change', toggleCustomPaymentMode);

    document.getElementById('loanRequestForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const messageEl = document.getElementById('loanRequestMessage');
      messageEl.textContent = '';
      if (!customerLoansLoaded) {
        pendingRequestOpen = true;
        showRequestLockBox('Checking your account', 'Please wait while we check your current loan balance.');
        await loadLoans(currentHistoryFilter);
        return;
      }
      if (getUnsettledCustomerLoans().length) {
        showRequestLockBox();
        messageEl.textContent = 'Please settle your current outstanding BMF loan before submitting a new request.';
        return;
      }
      const product = document.getElementById('loanProduct').value.trim();
      const amount = document.getElementById('loanAmount').value;
      const dueDate = document.getElementById('loanDueDate').value;
      const selectedWeeks = Number(document.getElementById('loanTenureWeeks').value) || 1;
      const urgency = document.getElementById('loanUrgency').value;
      const agreedToTerms = document.getElementById('loanAgreeTerms').checked;
      const collateralDescription = document.getElementById('loanCollateralDescription').value.trim();
      const collateralGrade = document.getElementById('loanCollateralGrade').value || '';
      const deviceToken = localStorage.getItem('deviceToken');
      if (!loanInterestPolicy) {
        messageEl.textContent = 'Current loan rates are still loading. Please wait and try again.';
        return;
      }
      const termDays = getSelectedTermDays();
      const requestedDueDate = dueDateInput.disabled
        ? addDaysToDateKey(getCurrentLusakaDateKey(), termDays)
        : dueDate;
      const chosenPaymentMode = paymentModeSelect.value === 'custom'
        ? (customPaymentMode.value.trim() || 'Custom')
        : paymentModeSelect.value;

      if (!product || !amount || (!dueDate && !selectedWeeks) || !urgency) {
        messageEl.textContent = 'Please fill all required loan request fields.';
        return;
      }

      if (!dueDate && !selectedWeeks) {
        messageEl.textContent = 'Choose either a custom due date or a fixed duration.';
        return;
      }

      if (!Number.isInteger(termDays) || termDays < loanInterestPolicy.minTermDays || termDays > loanInterestPolicy.maxTermDays) {
        messageEl.textContent = `Choose a loan term between ${loanInterestPolicy.minTermDays} and ${loanInterestPolicy.maxTermDays} days.`;
        return;
      }

      if (!agreedToTerms) {
        messageEl.textContent = 'You must agree to the loan terms to continue.';
        return;
      }

      if (!deviceToken) {
        messageEl.textContent = 'Device token missing. Please login again.';
        return;
      }

      try {
        const formData = new FormData();
        formData.append('email', userEmail);
        formData.append('product', product);
        formData.append('amount', amount);
        formData.append('dueDate', requestedDueDate);
        formData.append('tenureDays', String(termDays));
        formData.append('tenureWeeks', String(Math.ceil(termDays / 7)));
        formData.append('urgency', urgency);
        formData.append('agreedToTerms', String(agreedToTerms));
        formData.append('paymentMode', chosenPaymentMode || '');
        formData.append('collateralDescription', collateralDescription || '');
        formData.append('collateralGrade', collateralGrade || '');

        const frontFile = document.getElementById('loanCollateralFront').files[0];
        const backFile = document.getElementById('loanCollateralBack').files[0];
        const nrcFront = document.getElementById('loanNrcFront').files[0];
        const nrcBack = document.getElementById('loanNrcBack').files[0];
        if (!nrcFront || !nrcBack || nrcFront.size > 5 * 1024 * 1024 || nrcBack.size > 5 * 1024 * 1024) {
          messageEl.textContent = 'Attach both NRC images. Each image must be 5 MB or smaller.';
          return;
        }
        if (frontFile) formData.append('collateralFront', frontFile);
        if (backFile) formData.append('collateralBack', backFile);
        formData.append('nrcFront', nrcFront);
        formData.append('nrcBack', nrcBack);

        const res = await fetch('/loans/request', {
          method: 'POST',
          headers: { 'x-device-token': deviceToken },
          body: formData
        });
        const data = await res.json();
        if (data.error) {
          messageEl.textContent = data.error;
          if (res.status === 409) showRequestLockBox();
        } else {
          messageEl.textContent = data.message || 'Request submitted.';
          showBmfToast(data.message || 'BMF success: loan request submitted.');
          document.getElementById('loanRequestForm').reset();
          document.getElementById('loanTenureWeeks').value = '2';
          document.getElementById('loanUrgency').value = 'standard';
          setTimeframeMode('weeks');
          updateLoanEstimateDisplay();
          paymentModeSelect.value = '';
          toggleCustomPaymentMode();
          setTimeframeMode('weeks');
          updateLoanEstimateDisplay();
          loadLoans(currentHistoryFilter);
        }
      } catch (err) {
        messageEl.textContent = 'Unable to send loan request. Try again later.';
      }
    });

    let allLoans = [];
    let customerLoansLoaded = false;
    let pendingRequestOpen = false;
    let currentLoanFilter = 'all';
    let currentHistoryFilter = 'all';
    let activeSupportPanel = 'payment-history';
    let paymentHistoryRange = 'all';

    function setSupportPanel(panelKey, { persist = true } = {}) {
      const validPanel = ['payment-history', 'inquiries', 'record-payment', 'due-schedule'].includes(panelKey)
        ? panelKey
        : 'payment-history';
      activeSupportPanel = validPanel;
      document.querySelectorAll('[data-support-tab]').forEach(button => {
        const active = button.dataset.supportTab === validPanel;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll('[data-support-panel]').forEach(panel => {
        panel.hidden = panel.dataset.supportPanel !== validPanel;
      });
      if (persist) localStorage.setItem('lastSupportPanel', validPanel);
    }

    function setOverviewSection(sectionKey) {
      document.querySelectorAll('.screen-section').forEach(section => {
        const isMatch = section.id === `${sectionKey}Section`;
        section.classList.toggle('hidden', !isMatch);
      });
      localStorage.setItem('lastUserView', sectionKey);

      if (sectionKey === 'payments') {
        setActiveLoanTab('payments');
        renderPaymentOverview();
        return;
      }
      if (sectionKey === 'reports') {
        setActiveLoanTab('reports');
        return;
      }

      if (sectionKey === 'about') {
        renderAboutSection();
      }
    }

    function setActiveLoanTab(tab) {
      // Lock gate: block New Request if user has any unsettled loans
      if (tab === 'request') {
        if (!customerLoansLoaded) {
          pendingRequestOpen = true;
          showRequestLockBox('Checking your account', 'Please wait while we check your current loan balance.');
          return;
        }
        if (getUnsettledCustomerLoans().length > 0) {
          showRequestLockBox();
          return;
        }
      }
      localStorage.setItem('lastUserView', tab);
      document.querySelectorAll('.loan-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.screen-section').forEach(section => {
        section.classList.toggle('hidden', section.id !== `${tab}Section`);
      });
      if (tab === 'loans') {
        renderLoanList();
      }
      if (tab === 'payments') { renderPaymentOverview(); loadCustomerSupport(); }
      if (tab === 'reports') loadCustomerReport();
      if (tab === 'payments') {
        const savedPanel = localStorage.getItem('lastSupportPanel') || activeSupportPanel;
        setSupportPanel(savedPanel, { persist: false });
      }
    }

    function showRequestLockBox(heading = 'Settle your current loan first', message = 'Our records show an active, grace, or defaulted BMF loan with an outstanding balance. Please settle that balance before continuing or submitting a new loan request.') {
      let box = document.getElementById('requestLockBox');
      if (!box) {
        box = document.createElement('div');
        box.id = 'requestLockBox';
        box.className = 'request-lock-box';
        box.innerHTML = `
          <div class="lock-box-content">
            <div class="lock-icon">🔒</div>
            <h2 class="lock-heading" id="requestLockHeading"></h2>
            <p class="lock-message" id="requestLockMessage"></p>
            <button type="button" class="enter-btn lock-close-btn" id="requestLockAction">Understood</button>
          </div>
        `;
        document.body.appendChild(box);
        box.querySelector('#requestLockAction').addEventListener('click', () => {
          pendingRequestOpen = false;
          hideRequestLockBox();
        });
      }
      box.querySelector('#requestLockHeading').textContent = heading;
      box.querySelector('#requestLockMessage').textContent = message;
      box.querySelector('#requestLockAction').textContent = 'Understood';
      box.classList.remove('hidden');
    }

    function hideRequestLockBox() {
      const box = document.getElementById('requestLockBox');
      if (box) box.classList.add('hidden');
    }

    function renderPaymentOverview() {
      const container = document.getElementById('paymentSummary');
      if (!container) return;

      const entries = allLoans.flatMap(loan => (Array.isArray(loan.payments) ? loan.payments : [])
        .map(payment => ({ loan, payment, date: new Date(payment.paymentDate || payment.date || '') })))
        .sort((a, b) => b.date - a.date);
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const month = today.slice(0, 7);
      const visibleEntries = entries.filter(({ payment, date }) => {
        const rawDate = String(payment.paymentDate || payment.date || '').slice(0, 10);
        if (paymentHistoryRange === 'today') return rawDate === today;
        if (paymentHistoryRange === '7') return !Number.isNaN(date.getTime()) && date >= new Date(now.getTime() - 7 * 86400000);
        if (paymentHistoryRange === 'month') return rawDate.startsWith(month);
        return true;
      });
      const totalPaid = visibleEntries.reduce((sum, { payment }) => sum + (Number(payment.amount) || 0), 0);
      const lastPayment = visibleEntries[0]?.payment;
      const lastPaymentLabel = lastPayment
        ? formatDateDisplay(lastPayment.paymentDate || lastPayment.date)
        : '—';

      container.innerHTML = `
        <div class="summary-inline-card">
          <h3>Total paid</h3>
          <p>${formatKwacha(totalPaid)}</p>
          <span>For selected period</span>
        </div>
        <div class="summary-inline-card">
          <h3>Last payment</h3>
          <p>${escapeHtml(lastPaymentLabel)}</p>
          <span>${lastPayment ? `${formatKwacha(lastPayment.amount)} received` : 'No payment recorded'}</span>
        </div>
        <div class="summary-inline-card">
          <h3>Payments made</h3>
          <p>${visibleEntries.length}</p>
          <span>Recorded on your account</span>
        </div>
      `;
      const history = document.getElementById('customerPaymentHistory');
      if (history) history.innerHTML = visibleEntries.length ? visibleEntries.map(({ loan, payment }) => `<tr><td>${escapeHtml(payment.paymentReceiptId || payment.receiptNumber || '—')}</td><td>${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</td><td class="payment-amount-cell">${formatKwacha(payment.amount)}</td><td>${payment.balanceAfter == null ? '—' : formatKwacha(payment.balanceAfter)}</td><td>${escapeHtml(formatDateDisplay(payment.paymentDate || payment.date))}</td><td>${escapeHtml(payment.recordedBy || '—')}</td><td><span class="loan-badge paid">${escapeHtml(formatStatusLabel(payment.status || 'confirmed'))}</span></td></tr>`).join('') : '<tr><td colspan="7">No payments recorded in this period.</td></tr>';
    }

    async function loadCustomerReport() {
      const summary = document.getElementById('customerReportSummary');
      const loanRows = document.getElementById('customerReportLoans');
      const paymentRows = document.getElementById('customerReportPayments');
      const token = localStorage.getItem('deviceToken');
      if (!summary || !loanRows || !paymentRows || !userEmail || !token) return;
      summary.innerHTML = '<p role="status">Refreshing your report…</p>';
      loanRows.innerHTML = '<tr><td colspan="5">Loading loans…</td></tr>';
      paymentRows.innerHTML = '<tr><td colspan="6">Loading payments…</td></tr>';
      try {
        const response = await fetch(`/reports/user/${encodeURIComponent(userEmail)}`, { headers: { 'x-device-token': token } });
        const report = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(report.error || 'Unable to load your report.');
        const totals = report.totals || {};
        summary.innerHTML = [
          ['Loans', String(totals.totalLoans || 0)], ['Paid', formatKwacha(totals.totalCollected || 0)],
          ['Outstanding', formatKwacha(totals.totalOutstanding || 0)], ['Interest booked', formatKwacha(totals.totalInterestBooked || 0)]
        ].map(([label, value]) => `<div class="summary-inline-card"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></div>`).join('');
        loanRows.innerHTML = report.loans?.length ? report.loans.map(loan => `<tr><td>${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</td><td>${escapeHtml(loan.product || 'Loan')}</td><td>${escapeHtml(loan.businessStatus || loan.status || 'pending')}</td><td>${escapeHtml(formatDateDisplay(loan.approvedAt || loan.borrowedDate || loan.createdAt))}</td><td>${formatKwacha(loan.outstanding || 0)}</td></tr>`).join('') : '<tr><td colspan="5">No loan records found.</td></tr>';
        paymentRows.innerHTML = report.payments?.length ? report.payments.slice().reverse().map(payment => `<tr><td>${escapeHtml(formatDateDisplay(payment.paymentDate || payment.date))}</td><td>${escapeHtml(payment.loanReceiptNumber || '')}</td><td>${formatKwacha(payment.amount)}</td><td>${escapeHtml(payment.mode || 'Payment')}</td><td>${escapeHtml(payment.paymentReceiptId || payment.paymentReceiptNumber || '—')}</td><td>${payment.screenshot ? `<a href="#" data-upload-filename="${escapeHtml(payment.screenshot)}">View proof</a>` : '—'}</td></tr>`).join('') : '<tr><td colspan="6">No payment records found.</td></tr>';
      } catch (error) { summary.textContent = error.message || 'Unable to load your report.'; }
    }

    async function loadCustomerSupport() {
      const history = document.getElementById('customerInquiryHistory');
      const schedule = document.getElementById('customerDueSchedule');
      const token = localStorage.getItem('deviceToken') || '';
      populateSupportLoanOptions();
      if (schedule) {
        const dueLoans = allLoans.filter(loan => Number(loan.outstanding) > 0).sort((a,b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
        schedule.innerHTML = dueLoans.length ? `<div class="table-scroll"><table class="customer-payment-table"><thead><tr><th>Loan</th><th>Due date</th><th>Balance</th><th>Status</th></tr></thead><tbody>${dueLoans.map(loan => `<tr><td>${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</td><td>${escapeHtml(formatDateDisplay(loan.dueDate))}</td><td>${formatKwacha(loan.outstanding)}</td><td>${escapeHtml(formatStatusLabel(loanStatusOf(loan)))}</td></tr>`).join('')}</tbody></table></div>` : '<p>No outstanding loans.</p>';
      }
      if (!history || !token || !userEmail) return false;
      history.innerHTML = '<p>Loading inquiries…</p>';
      try {
        const response = await fetch(`/feedback?email=${encodeURIComponent(userEmail)}`, { headers: { 'x-device-token': token } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load inquiries.');
        const records = Array.isArray(data.feedback) ? data.feedback.slice().reverse() : [];
        history.innerHTML = records.length ? records.map(item => { const linkedLoan = allLoans.find(loan => String(loan.id) === String(item.relatedLoanId)); return `<article class="loan-card"><strong>${escapeHtml(item.category || 'Inquiry')}${item.relatedLoanId ? ` — ${escapeHtml(linkedLoan?.receiptNumber || `BMF-${item.relatedLoanId}`)}` : ''}</strong><span class="loan-badge ${escapeHtml(item.status || 'new')}">${escapeHtml(formatStatusLabel(item.status || 'new'))}</span><p>${escapeHtml(item.message || '')}</p><small>Submitted: ${escapeHtml(formatDateDisplay(item.createdAt))}${item.reviewNote ? ` · ${escapeHtml(item.reviewNote)}` : ''}</small></article>`; }).join('') : '<p>No previous inquiries.</p>';
        return true;
      } catch (error) { history.textContent = error.message || 'Unable to load inquiries.'; return false; }
    }

    function populateSupportLoanOptions() {
      const inquiryLoanSelect = document.getElementById('inquiryLoanId');
      const paymentLoanSelect = document.getElementById('recordPaymentLoanId');
      const allLoanOptions = allLoans.map(loan => `<option value="${escapeHtml(loan.id)}">${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)} · ${escapeHtml(loan.product || 'Loan')}</option>`).join('');
      const eligibleLoans = allLoans.filter(loan => ['active', 'grace', 'defaulted'].includes(loanStatusOf(loan)) && Number(loan.outstanding) > 0);
      const paymentOptions = eligibleLoans.map(loan => `<option value="${escapeHtml(loan.id)}">${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)} · ${escapeHtml(loan.product || 'Loan')}</option>`).join('');
      if (inquiryLoanSelect) {
        const selectedLoanId = inquiryLoanSelect.value;
        inquiryLoanSelect.innerHTML = '<option value="">Choose a loan...</option>' + allLoanOptions;
        if (allLoans.some(loan => String(loan.id) === selectedLoanId)) inquiryLoanSelect.value = selectedLoanId;
      }
      if (paymentLoanSelect) {
        const selectedLoanId = paymentLoanSelect.value;
        paymentLoanSelect.innerHTML = '<option value="">Choose a loan...</option>' + paymentOptions;
        if (eligibleLoans.some(loan => String(loan.id) === selectedLoanId)) paymentLoanSelect.value = selectedLoanId;
        updateRecordPaymentBalance();
      }
    }

    function updateRecordPaymentBalance() {
      const loanSelect = document.getElementById('recordPaymentLoanId');
      const balanceOutput = document.getElementById('recordPaymentExpectedBalance');
      const amountInput = document.getElementById('recordPaymentAmount');
      if (!loanSelect || !balanceOutput || !amountInput) return;
      const loan = allLoans.find(item => String(item.id) === loanSelect.value &&
        ['active', 'grace', 'defaulted'].includes(loanStatusOf(item)) && Number(item.outstanding) > 0);
      if (!loan) {
        balanceOutput.textContent = 'Choose a loan';
        amountInput.removeAttribute('max');
        return;
      }
      const outstanding = Number(loan.outstanding);
      balanceOutput.textContent = formatKwacha(outstanding);
      amountInput.max = outstanding.toFixed(2);
    }

    function renderOverviewSummary(loans) {
      const container = document.getElementById('overviewSummary');
      if (!container) return;

      const totalRequested = loans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
      const totalOutstanding = loans.reduce((sum, loan) => sum + (Number(loan.outstanding) || 0), 0);
      const pending = loans.filter(loan => loanStatusOf(loan) === 'pending').length;
      const active = loans.filter(loan => ['active', 'grace', 'defaulted', 'liquidated'].includes(loanStatusOf(loan))).length;
      const closed = loans.filter(loan => ['paid', 'declined'].includes(loanStatusOf(loan))).length;

      container.innerHTML = `
        <div class="summary-inline-card">
          <h3>Total requested</h3>
          <p>${loans.length}</p>
          <span>${formatKwacha(totalRequested)}</span>
        </div>
        <div class="summary-inline-card">
          <h3>Outstanding</h3>
          <p>${pending + active}</p>
          <span>${formatKwacha(totalOutstanding)}</span>
        </div>
        <div class="summary-inline-card">
          <h3>Settled</h3>
          <p>${closed}</p>
          <span>${formatKwacha(loans.reduce((sum, loan) => sum + (Number(loan.totalRepayment) || Number(loan.amount) || 0), 0))}</span>
        </div>
      `;
    }

    function renderAboutSection() {
      const container = document.getElementById('aboutUserDetails');
      if (!container) return;

      const user = {
        name: localStorage.getItem('username') || 'User',
        email: localStorage.getItem('userEmail') || 'Not available',
        role: localStorage.getItem('userRole') || 'user',
        theme: localStorage.getItem('mode') || 'dark'
      };

      container.innerHTML = `
        <div class="info-row"><strong>Name:</strong> <span>${escapeHtml(user.name)}</span></div>
        <div class="info-row"><strong>Email:</strong> <span>${escapeHtml(user.email)}</span></div>
        <div class="info-row"><strong>Role:</strong> <span>${escapeHtml(user.role)}</span></div>
        <div class="info-row"><strong>Theme:</strong> <span>${escapeHtml(user.theme)}</span></div>
      `;
    }

    function setLoanFilter(filter) {
      currentLoanFilter = filter;
      document.querySelectorAll('.loan-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderLoanList();
    }

    function setHistoryFilter(range) {
      currentHistoryFilter = range;
      document.querySelectorAll('.history-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
      });
      loadLoans(range);
    }

    function formatStatusLabel(status) {
      if (!status) return 'Unknown';
      return String(status).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    // Canonical lifecycle only (config.LOAN_STATUSES): prefer the server's live
    // businessStatus; map legacy stored values so old records render correctly.
    const CANONICAL_STATUSES = ['pending', 'active', 'grace', 'defaulted', 'liquidated', 'paid', 'declined'];
    const LEGACY_STATUS_MAP = {
      awaiting_approval: 'pending', approved: 'active', in_progress: 'active',
      'in-progress': 'active', running: 'active', overdue: 'grace',
      default: 'defaulted', liquidation: 'liquidated', recovered: 'liquidated',
      settled: 'paid', closed: 'paid', completed: 'paid', rejected: 'declined'
    };
    function loanStatusOf(loan) {
      const canonical = String(loan?.businessStatus || '').trim().toLowerCase();
      if (CANONICAL_STATUSES.includes(canonical)) return canonical;
      const raw = String(loan?.status || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
      return LEGACY_STATUS_MAP[raw] || (CANONICAL_STATUSES.includes(raw) ? raw : 'pending');
    }

    function getUnsettledCustomerLoans() {
      return allLoans.filter(loan =>
        ['active', 'grace', 'defaulted'].includes(loanStatusOf(loan)) && Number(loan.outstanding || 0) > 0
      );
    }

    function countLoanStatus(loans) {
      return {
        pending: loans.filter(loan => loanStatusOf(loan) === 'pending').length,
        running: loans.filter(loan => ['active', 'grace', 'defaulted', 'liquidated'].includes(loanStatusOf(loan))).length,
        closed: loans.filter(loan => ['paid', 'declined'].includes(loanStatusOf(loan))).length
      };
    }

    function renderLoanSummaryCounts(loans) {
      const counts = countLoanStatus(loans);
      document.getElementById('loanPending').textContent = counts.pending;
      document.getElementById('loanRunning').textContent = counts.running;
      document.getElementById('loanClosed').textContent = counts.closed;
      renderOverviewSummary(loans);
    }

    function renderLoanList() {
      const loanList = document.getElementById('loan-list');
      const filtered = allLoans.filter(loan => {
        if (currentLoanFilter === 'pending') return loanStatusOf(loan) === 'pending';
        if (currentLoanFilter === 'running') return ['active', 'grace', 'defaulted', 'liquidated'].includes(loanStatusOf(loan));
        if (currentLoanFilter === 'closed') return ['paid', 'declined'].includes(loanStatusOf(loan));
        return true;
      });

      loanList.innerHTML = filtered.length
        ? filtered.map(loan => {
          const total = Number(loan.totalRepayment || loan.amount || 0);
          const outstanding = Math.max(0, Number(loan.outstanding) || 0);
          const paid = Math.min(total, Math.max(0, Number(loan.paidTotal ?? total - outstanding) || 0));
          const progress = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          const status = loanStatusOf(loan);
          return `
            <li class="loan-card" data-loan-status="${escapeHtml(status)}" data-loan-id="${Number(loan.id)}">
              <div class="loan-card-heading">
                <div class="loan-card-identity"><span class="loan-receipt">${escapeHtml(loan.receiptNumber || `BMF-${loan.id}`)}</span><strong>${escapeHtml(loan.product || 'Loan')}</strong></div>
                <span class="loan-badge ${status}">${formatStatusLabel(status).toUpperCase()}</span>
              </div>
              <div class="loan-meta loan-facts">
                Amount: <strong>${formatKwacha(loan.amount)}</strong> · Interest: <strong>${formatKwacha(loan.interestAmount || 0)}</strong> · Total: <strong>${formatKwacha(total)}</strong> · Requested: <strong>${formatDateDisplay(loan.createdAt)}</strong> · Tenure: <strong>${formatLoanTenure(loan)}</strong> · Urgency: <strong>${formatStatusLabel(loan.urgency || 'standard')}</strong>
              </div>
              <div class="loan-progress-meta"><span>Repaid: ${formatKwacha(paid)}</span><span>Balance: ${formatKwacha(outstanding)}</span></div>
              <div class="loan-progress" role="progressbar" aria-label="Loan repayment progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
              ${['active', 'grace', 'defaulted', 'in_progress', 'started'].includes(status) && outstanding > 0 ? `<div class="loan-action"><button type="button" class="record-payment-btn" data-record-payment="${Number(loan.id)}">Record Payment</button></div>` : ''}
              <div class="loan-meta">
                Due: ${formatDateDisplay(loan.dueDate)}
              </div>
            </li>
          `;
        }).join('')
        : '<li class="loan-empty">No loans found for this category.</li>';
    }

    function renderLoanDetailPanel(loan) {
      const panel = document.getElementById('loanDetailPanel');
      if (!panel || !loan) return;
      const collateralText = loan.collateralDescription || loan.collateralFront || loan.collateralBack || 'No collateral provided';
      const decisionText = loan.adminReason || 'No decision reason provided yet.';

      panel.innerHTML = `
        <div class="loan-detail-card">
          <div class="loan-detail-header">
            <h3>${escapeHtml(loan.product || 'Loan Request')}</h3>
            <span class="loan-badge ${loanStatusOf(loan)}">${formatStatusLabel(loanStatusOf(loan)).toUpperCase()}</span>
          </div>
          <div class="loan-detail-grid">
            <p><strong>Requested by:</strong> ${escapeHtml(loan.email || 'Unknown')}</p>
            <p><strong>Amount requested:</strong> ${formatKwacha(loan.amount)}</p>
            <p><strong>Interest rate:</strong> ${loan.interestRate || 0}%</p>
            <p><strong>Interest amount:</strong> ${formatKwacha(loan.interestAmount || 0)}</p>
            <p><strong>Total after interest:</strong> ${formatKwacha(loan.totalRepayment || loan.amount || 0)}</p>
            <p><strong>Amount paid:</strong> ${formatKwacha(loan.paidTotal || 0)}</p>
            <p><strong>Outstanding:</strong> ${formatKwacha(loan.outstanding || 0)}</p>
            <p><strong>Due date:</strong> ${formatDateDisplay(loan.dueDate)}</p>
            <p><strong>Urgency:</strong> ${formatStatusLabel(loan.urgency || 'standard')}</p>
            <p><strong>Collateral:</strong> ${escapeHtml(collateralText)}</p>
            <p><strong>Requested:</strong> ${formatDateDisplay(loan.createdAt)}</p>
            <p class="loan-detail-full"><strong>Decision reason:</strong> ${escapeHtml(decisionText)}</p>
          </div>
          <div class="loan-payment-history">
            <h4>Payment history</h4>
            ${(Array.isArray(loan.payments) && loan.payments.length)
              ? `<ul>${loan.payments.map(payment => `
                  <li>
                    ${formatKwacha(payment.amount)} • ${payment.mode || 'payment'} • ${formatDateDisplay(payment.paymentDate || payment.date)}
                    ${payment.receiptNumber || payment.paymentReceiptId ? ` • Ref: ${payment.receiptNumber || payment.paymentReceiptId}` : ''}
                  </li>`).join('')}</ul>`
              : '<p>No payments recorded yet.</p>'}
          </div>
          <div class="loan-payment-submit">
            <h4>Make a payment</h4>
            <p>Mobile money and bank transfer submissions are reviewed by BMF. Your balance changes only after approval.</p>
            ${(loan.paymentSubmissions || []).map(item => `<p>Submission ${escapeHtml(item.transactionReference)}: <strong>${escapeHtml(item.status)}</strong>${item.reviewReason ? ` · ${escapeHtml(item.reviewReason)}` : ''}</p>`).join('')}
            ${['active', 'grace', 'defaulted', 'in_progress', 'started'].includes(loanStatusOf(loan)) && Number(loan.outstanding) > 0 ?`
            <form data-customer-payment="${Number(loan.id)}" enctype="multipart/form-data">
              <input name="amount" type="number" min="0.01" max="${Number(loan.outstanding)}" step="0.01" required value="${Number(loan.outstanding)}" placeholder="Amount paid (max ${formatKwacha(loan.outstanding)})">
              <select name="mode" required><option value="">Transfer method</option><option>Airtel Money</option><option>MTN MoMo</option><option>Bank Transfer</option></select>
              <input name="transactionReference" maxlength="64" required placeholder="Transaction reference">
              <label>Payment proof <input name="paymentProof" type="file" accept="image/jpeg,image/png,image/webp" required></label>
              <button class="enter-btn" type="submit">Submit for review</button>
            </form>` : '<p>Payments are available when a loan is active.</p>'}
          </div>
        </div>
      `;
      panel.classList.remove('hidden');
    }

    function openRecordPayment(loanId) {
      const loan = allLoans.find(l => Number(l.id) === Number(loanId));
      if (!loan || !['active', 'grace', 'defaulted'].includes(loanStatusOf(loan)) || Number(loan.outstanding) <= 0) {
        showBmfToast('This loan is not eligible for a payment submission.', 'error');
        return;
      }
      setActiveLoanTab('payments');
      populateSupportLoanOptions();
      const loanSelect = document.getElementById('recordPaymentLoanId');
      if (loanSelect) loanSelect.value = String(loan.id);
      updateRecordPaymentBalance();
      setSupportPanel('record-payment');
      document.getElementById('paymentsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function updateStandingBadge(loans) {
      const badge = document.getElementById('standingBadge');
      if (!badge) return;
      const statusOf = loan => loanStatusOf(loan);
      const risky = loans.some(loan => ['defaulted', 'liquidated'].includes(statusOf(loan)));
      const dueSoon = loans.some(loan => statusOf(loan) === 'grace');
      const open = loans.filter(loan => !['paid', 'declined'].includes(statusOf(loan)));
      badge.classList.remove('warn', 'alert');
      if (risky) {
        badge.textContent = '⚠ Payment overdue';
        badge.classList.add('alert');
      } else if (dueSoon) {
        badge.textContent = '⚠ Repayment due soon';
        badge.classList.add('warn');
      } else if (open.length) {
        badge.textContent = '✓ Repayment on track';
      } else if (loans.length) {
        badge.textContent = '✓ All loans settled';
      } else {
        badge.textContent = '✓ No active loans';
      }
    }

    async function loadLoans(filterDays = currentHistoryFilter) {
      const loanList = document.getElementById('loan-list');
      const deviceToken = localStorage.getItem('deviceToken');
      if (!userEmail) {
        customerLoansLoaded = false;
        loanList.innerHTML = '<li>Please login again to see your loan information.</li>';
        document.getElementById('loanTotal').textContent = '0 loans';
        document.getElementById('loanOutstanding').textContent = 'K0';
        updateStandingBadge([]);
        renderLoanSummaryCounts([]);
        if (pendingRequestOpen) showRequestLockBox('Unable to check your account', 'Please sign in again so we can verify your current loan balance.');
        return false;
      }

      if (!deviceToken) {
        customerLoansLoaded = false;
        loanList.innerHTML = '<li>Device token missing. Please login again.</li>';
        if (pendingRequestOpen) showRequestLockBox('Unable to check your account', 'Please sign in again so we can verify your current loan balance.');
        return false;
      }

      try {
        loanList.innerHTML = '<li class="loan-empty">Loading your loans…</li>';
        const params = new URLSearchParams({ email: userEmail });
        if (filterDays && filterDays !== 'all') params.set('filter', String(filterDays));
        const res = await fetch(`/loans?${params.toString()}`, {
          headers: {
            'x-device-token': deviceToken
          }
        });
        const data = await res.json();

        if (data.error) {
          customerLoansLoaded = false;
          loanList.innerHTML = `<li>${escapeHtml(data.error)}</li>`;
          if (pendingRequestOpen) showRequestLockBox('Unable to check your account', data.error);
          return false;
        }

        allLoans = data.loans || [];
        customerLoansLoaded = true;
        populateSupportLoanOptions();
        const totalLoans = data.summary?.total || 0;
        const outstanding = data.summary?.outstanding || 0;
        document.getElementById('loanTotal').textContent = `${totalLoans} loan${totalLoans === 1 ? '' : 's'}`;
        document.getElementById('loanOutstanding').textContent = formatKwacha(outstanding);
        document.getElementById('totalRequestedLabel').textContent = `${formatKwacha(data.summary?.totalRequested || 0)} total requested`;
        const settledLoans = allLoans.filter(loan => loanStatusOf(loan) === 'paid');
        document.getElementById('loanSettled').textContent = String(settledLoans.length);
        document.getElementById('settledTotalLabel').textContent = `${formatKwacha(settledLoans.reduce((sum, loan) => sum + Number(loan.totalRepayment || loan.amount || 0), 0))} fully paid`;
        renderLoanSummaryCounts(allLoans);
        updateStandingBadge(allLoans);
        renderLoanList();
        renderPaymentOverview();
        loadCustomerNotifications();
        if (pendingRequestOpen) {
          pendingRequestOpen = false;
          if (getUnsettledCustomerLoans().length) {
            showRequestLockBox();
          } else {
            hideRequestLockBox();
            setActiveLoanTab('request');
          }
        }
        if (!document.getElementById('requestSection')?.classList.contains('hidden') && getUnsettledCustomerLoans().length) {
          setActiveLoanTab('summary');
          showRequestLockBox();
        }
        return true;
      } catch (err) {
        customerLoansLoaded = false;
        loanList.innerHTML = '<li>Unable to load loan information. Please try again later.</li>';
        if (pendingRequestOpen) showRequestLockBox('Unable to check your account', 'We could not verify your loan balance. Please try again before requesting a new loan.');
        return false;
      }
    }

    async function loadCustomerNotifications() {
      const list = document.getElementById('customerNotifications');
      const token = localStorage.getItem('deviceToken');
      if (!list || !token) return;
      try {
        const response = await fetch('/notifications', { headers: { 'x-device-token': token } });
        if (!response.ok) throw new Error('Unable to load notifications.');
        const items = await response.json();
        list.innerHTML = items.length ? items.slice().reverse().map(item => `<li class="${item.readAt ? 'read' : 'unread'}">${escapeHtml(item.message)} <small>${escapeHtml(formatDateDisplay(item.createdAt))}</small>${item.readAt ? '' : ` <button type="button" data-read-notification="${escapeHtml(item.id)}">Mark read</button>`}</li>`).join('') : '<li>You are all caught up.</li>';
      } catch { list.textContent = 'Notifications are temporarily unavailable.'; }
    }

    document.getElementById('customerNotifications')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-read-notification]');
      if (!button) return;
      const response = await fetch(`/notifications/${encodeURIComponent(button.dataset.readNotification)}/read`, {
        method: 'PATCH', headers: { 'x-device-token': localStorage.getItem('deviceToken') || '' }
      });
      if (response.ok) loadCustomerNotifications();
    });

    document.getElementById('loanDetailPanel')?.addEventListener('submit', async event => {
      const form = event.target.closest('[data-customer-payment]');
      if (!form) return;
      event.preventDefault();
      const file = form.elements.paymentProof.files[0];
      if (!file || file.size > 5 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        showBmfToast('Attach a JPG, PNG, or WEBP proof image up to 5 MB.', 'error');
        return;
      }
      try {
        const response = await fetch(`/loans/${Number(form.dataset.customerPayment)}/payment-submissions`, {
          method: 'POST', headers: { 'x-device-token': localStorage.getItem('deviceToken') || '' }, body: new FormData(form)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not submit payment proof.');
        showBmfToast(`BMF success: ${result.message}`);
        await openLoanDetails(Number(form.dataset.customerPayment));
        loadLoans(currentHistoryFilter);
      } catch (error) { showBmfToast(error.message || 'Payment submission failed.', 'error'); }
    });

    document.addEventListener('click', async event => {
      const link = event.target.closest('[data-upload-filename]');
      if (!link) return;
      event.preventDefault();
      const previewWindow = window.open('about:blank', '_blank');
      if (previewWindow) previewWindow.opener = null;
      try {
        const response = await fetch('/uploads/sign', { method: 'POST', headers: {
          'Content-Type': 'application/json', 'x-device-token': localStorage.getItem('deviceToken') || ''
        }, body: JSON.stringify({ filename: link.dataset.uploadFilename }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to open file.');
        if (previewWindow) previewWindow.location.replace(result.url);
        else window.location.assign(result.url);
      } catch (error) { previewWindow?.close(); showBmfToast(error.message, 'error'); }
    });

    // First-time / loan-business behavior:
    // - On first-time signup, user should see ONLY what they entered (their current loan requests).
    // - Keep tab defaults consistent.
    // - Any invitation/unique onboarding is handled by /signup.html?invite=... and auth flow (no backend change).
    // If a signup just happened, force the UI to stay on Loan Summary (do not show other tabs by default).
    if (isNewSignup) {
      currentLoanFilter = 'all';
    }

    const savedUserView = localStorage.getItem('lastUserView');
    if (savedUserView && ['summary', 'loans', 'request', 'payments', 'reports', 'complaints', 'about'].includes(savedUserView)) {
      if (['payments', 'reports', 'complaints', 'about'].includes(savedUserView)) {
        setOverviewSection(savedUserView);
      } else {
        setActiveLoanTab(savedUserView);
      }
    }

    loadLoans(currentHistoryFilter);

    document.querySelectorAll('.loan-tab').forEach(btn => {
      btn.addEventListener('click', () => setActiveLoanTab(btn.dataset.tab));
    });

    document.querySelectorAll('[data-support-tab]').forEach(button => {
      button.addEventListener('click', () => setSupportPanel(button.dataset.supportTab));
    });
    document.querySelectorAll('[data-payment-range]').forEach(button => {
      button.addEventListener('click', () => {
        paymentHistoryRange = button.dataset.paymentRange;
        document.querySelectorAll('[data-payment-range]').forEach(option => {
          const active = option === button;
          option.classList.toggle('active', active);
          option.setAttribute('aria-pressed', String(active));
        });
        renderPaymentOverview();
      });
    });

    document.querySelectorAll('.loan-filter').forEach(btn => {
      btn.addEventListener('click', () => setLoanFilter(btn.dataset.filter));
    });

    document.getElementById('loan-list')?.addEventListener('click', event => {
      const paymentButton = event.target.closest('[data-record-payment]');
      if (paymentButton) {
        event.preventDefault();
        event.stopPropagation();
        openRecordPayment(Number(paymentButton.dataset.recordPayment));
        return;
      }
      const loanCard = event.target.closest('[data-loan-id]');
      if (loanCard) openLoanDetails(Number(loanCard.dataset.loanId));
    });

    document.querySelectorAll('.history-filter').forEach(btn => {
      btn.addEventListener('click', () => setHistoryFilter(btn.dataset.range));
    });
    document.getElementById('refreshCustomerReport')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'Refreshing…';
      try { await loadCustomerReport(); } finally { button.disabled = false; button.textContent = 'Refresh report'; }
    });
    document.getElementById('recordPaymentLoanId')?.addEventListener('change', updateRecordPaymentBalance);
    document.getElementById('refreshSupportBtn')?.addEventListener('click', async event => {
      const button = event.currentTarget; const note = document.getElementById('supportMessage');
      button.disabled = true; button.textContent = 'Refreshing…'; note.textContent = 'Refreshing payment history and support…';
      try { const loansLoaded = await loadLoans(currentHistoryFilter); const supportLoaded = await loadCustomerSupport(); note.textContent = loansLoaded && supportLoaded ? 'Updated just now.' : 'Some information could not be refreshed. Please try again.'; }
      catch { note.textContent = 'Refresh failed. Please try again.'; }
      finally { button.disabled = false; button.textContent = 'Refresh'; }
    });
    document.getElementById('customerInquiryForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.getElementById('submitInquiryBtn'); const note = document.getElementById('supportMessage');
      const category = document.getElementById('inquiryType').value;
      const details = document.getElementById('inquiryDetails').value.trim();
      const relatedLoanId = document.getElementById('inquiryLoanId').value;
      button.disabled = true; button.textContent = 'Submitting…'; note.textContent = 'Submitting your inquiry…';
      try {
        const response = await fetch('/feedback', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-token': localStorage.getItem('deviceToken') || '' },
          body: JSON.stringify({ category: 'inquiry', message: `${category}: ${details}`, relatedLoanId })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not submit your inquiry.');
        form.reset();
        note.textContent = 'Inquiry submitted successfully.';
        showBmfToast('Inquiry submitted successfully.');
        await loadCustomerSupport();
      } catch (error) { note.textContent = `Could not submit your inquiry: ${error.message}`; }
      finally { button.disabled = false; button.textContent = 'Submit Inquiry'; }
    });
    document.getElementById('customerRecordPaymentForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.getElementById('recordPaymentSubmitBtn'); const note = document.getElementById('supportMessage');
      const loanId = document.getElementById('recordPaymentLoanId').value;
      const loan = allLoans.find(item => String(item.id) === loanId &&
        ['active', 'grace', 'defaulted'].includes(loanStatusOf(item)) && Number(item.outstanding) > 0);
      const amount = Number(document.getElementById('recordPaymentAmount').value);
      if (!loan) { note.textContent = 'Choose an eligible loan with an outstanding balance.'; return; }
      if (!Number.isFinite(amount) || amount < 0.01 || amount > Number(loan.outstanding) || amount !== Number(amount.toFixed(2))) {
        note.textContent = "Enter an amount up to the loan's current outstanding balance, with no more than two decimal places.";
        return;
      }
      button.disabled = true; button.textContent = 'Submitting…'; note.textContent = 'Submitting payment proof for review…';
      try {
        const formData = new FormData();
        formData.append('amount', String(amount));
        formData.append('mode', document.getElementById('recordPaymentMode').value);
        formData.append('transactionReference', document.getElementById('recordPaymentReference').value.trim());
        formData.append('paymentProof', document.getElementById('recordPaymentProof').files[0]);
        const notes = document.getElementById('recordPaymentNotes').value.trim();
        if (notes) formData.append('note', notes);
        const response = await fetch(`/loans/${encodeURIComponent(loanId)}/payment-submissions`, {
          method: 'POST', headers: { 'x-device-token': localStorage.getItem('deviceToken') || '' }, body: formData
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not submit payment proof.');
        form.reset();
        updateRecordPaymentBalance();
        note.textContent = 'Payment proof submitted. Your balance will change after BMF approves it.';
        showBmfToast('Payment proof submitted for review.');
        await loadLoans(currentHistoryFilter);
        await loadCustomerSupport();
      } catch (error) { note.textContent = `Could not submit payment proof: ${error.message}`; }
      finally { button.disabled = false; button.textContent = 'Submit Payment for Review'; }
    });

    document.querySelectorAll('.support-link').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.view;
        if (view === 'reports') { setOverviewSection('reports'); }
        if (view === 'complaints') { setOverviewSection('complaints'); }
        if (view === 'inquiries') { setOverviewSection('complaints'); }
        if (view === 'experience') { setOverviewSection('complaints'); }
        if (view === 'about') { setOverviewSection('about'); }
      });
    });

    document.getElementById('submitComplaintBtn').addEventListener('click', async () => {
      const field = document.getElementById('complaintMessage');
      const categoryField = document.getElementById('feedbackCategory');
      const message = document.getElementById('complaintMessageText');

      if (!field || !field.value.trim()) {
        message.textContent = 'Please add a complaint, improvement area, or inquiry before sending.';
        return;
      }

      try {
        const res = await fetch('/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-token': localStorage.getItem('deviceToken') || ''
          },
          body: JSON.stringify({
            email: userEmail,
            message: field.value.trim(),
            category: categoryField ? categoryField.value : 'complaint'
          })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          message.textContent = data.error || 'Unable to send feedback right now.';
          return;
        }

        message.textContent = 'Thank you. Your feedback has been saved and categorized for review.';
        showBmfToast('Your feedback has been saved for review.');
        field.value = '';
      } catch (err) {
        message.textContent = 'Unable to send feedback right now.';
      }
    });

    document.querySelectorAll('.menu-action').forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.view;
        const menu = document.getElementById('menuDropdown');

        if (view === 'loans') { setActiveLoanTab('loans'); }
        if (view === 'payments') { setOverviewSection('payments'); }
        if (view === 'reports') { setOverviewSection('reports'); }
        if (menu) menu.classList.remove('active');
      });
    });

    function setupMenu() {
      const toggle = document.getElementById('menuBtn');
      const dropdown = document.getElementById('menuDropdown');
      const logout = document.getElementById('logoutBtn');
      if (toggle && dropdown) {
        toggle.addEventListener('click', () => dropdown.classList.toggle('active'));
        window.addEventListener('click', event => {
          if (!dropdown.contains(event.target) && event.target !== toggle) {
            dropdown.classList.remove('active');
          }
        });
      }
      if (logout) {
        logout.addEventListener('click', () => {
          localStorage.removeItem('deviceToken');
          localStorage.removeItem('username');
          localStorage.removeItem('userEmail');
          window.location.href = 'login.html';
        });
      }
    }

    setupMenu();

    // Loan Details modal
    function closeLoanModal() {
      const m = document.getElementById('loanModal');
      if (!m) return;
      m.classList.remove('active');
      m.setAttribute('aria-hidden', 'true');
    }

    // This script is loaded before the loan modal markup, so use delegation to
    // bind close/backdrop clicks after the modal has been parsed.
    document.addEventListener('click', event => {
      const modal = document.getElementById('loanModal');
      if (!modal) return;
      if (event.target.closest?.('[data-modal-close="loanModal"]') || event.target === modal) closeLoanModal();
    });
    document.addEventListener('keydown', event => {
      const modal = document.getElementById('loanModal');
      if (event.key === 'Escape' && modal?.classList.contains('active')) closeLoanModal();
    });

    async function submitLoanDecision(action, loanId) {
      const reasonField = document.getElementById('adminDecisionReason');
      const reason = (reasonField?.value || '').trim();
      const token = localStorage.getItem('deviceToken');
      if (!token) return window.location.href = 'login.html';

      try {
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
          document.getElementById('loanRequestMessage').textContent = data.error || 'Unable to update loan status.';
          return;
        }

        document.getElementById('loanRequestMessage').textContent = `Loan marked as ${formatStatusLabel(action)}.`;
        closeLoanModal();
        await loadLoans(currentHistoryFilter);
      } catch (err) {
        document.getElementById('loanRequestMessage').textContent = 'Unable to update loan status.';
      }
    }

    async function openLoanDetails(id) {
      const token = localStorage.getItem('deviceToken');
      if (!token) return window.location.href = 'login.html';
      try {
        const res = await fetch(`/loans/${id}`, {
          headers: { 'x-device-token': token }
        });
        if (res.status === 403) return handleInvalidDeviceToken();
        const data = await res.json();
        const loan = data.loan;
        const adminBox = document.getElementById('adminDecisionBox');
        // Loan DECISIONS are store_admin-only (backend returns 403 for role
        // 'admin' per tested franchise-scoping policy) — match that gate here so
        // the buttons we show are exactly the ones the API will accept.
        const hasAdminAccess = ['store_admin', 'franchise_admin'].includes(userRole);
        const collateralText = loan.collateralDescription || loan.collateralFront || loan.collateralBack || 'No collateral provided';

        renderLoanDetailPanel(loan);

        document.getElementById('modalLoanProduct').dataset.loanId = String(loan.id || '');
        document.getElementById('modalLoanProduct').textContent = loan.product || 'Loan';
        document.getElementById('modalLoanBorrower').textContent = loan.email || 'Unknown';
        document.getElementById('modalLoanReceipt').textContent = loan.receiptNumber || `BMF-${loan.id}`;
        document.getElementById('modalLoanAmount').textContent = formatKwacha(loan.amount);
        document.getElementById('modalLoanInterestRate').textContent = `${loan.interestRate || 0}%`;
        document.getElementById('modalLoanInterest').textContent = formatKwacha(loan.interestAmount || 0);
        document.getElementById('modalLoanTotal').textContent = formatKwacha(loan.totalRepayment || loan.amount || 0);
        document.getElementById('modalLoanOutstanding').textContent = formatKwacha(loan.outstanding || 0);
        document.getElementById('modalLoanPaid').textContent = formatKwacha(loan.paidTotal || Math.max(0, Number(loan.totalRepayment || loan.amount || 0) - Number(loan.outstanding || 0)));
        document.getElementById('modalLoanDue').textContent = formatDateDisplay(loan.dueDate);
        document.getElementById('modalLoanStatus').textContent = formatStatusLabel(loan.status);
        document.getElementById('modalLoanRequested').textContent = formatDateDisplay(loan.createdAt);
        document.getElementById('modalLoanBorrowed').textContent = loan.approvedAt || loan.borrowedDate ? formatDateDisplay(loan.approvedAt || loan.borrowedDate) : 'Not yet approved';
        document.getElementById('modalLoanTenure').textContent = formatLoanTenure(loan);
        document.getElementById('modalLoanPaymentMode').textContent = loan.paymentMode || 'Not provided';
        document.getElementById('modalLoanUrgency').textContent = formatStatusLabel(loan.urgency || 'standard');
        document.getElementById('modalLoanCollateral').textContent = collateralText;
        document.getElementById('modalLoanDecision').textContent = loan.adminReason || 'No decision reason provided yet.';
        const modalPayments = document.getElementById('modalLoanPayments');
        const paymentRecords = Array.isArray(loan.payments) ? loan.payments : [];
        modalPayments.innerHTML = paymentRecords.length
          ? `<ul>${paymentRecords.map(payment => `<li>${formatKwacha(payment.amount)} · ${escapeHtml(payment.mode || 'Payment')} · ${escapeHtml(formatDateDisplay(payment.paymentDate || payment.date))}${payment.paymentReceiptId ? ` · ${escapeHtml(payment.paymentReceiptId)}` : ''}${payment.note ? `<br>${escapeHtml(payment.note)}` : ''}</li>`).join('')}</ul>`
          : '<p>No payments recorded yet.</p>';
        document.getElementById('adminDecisionReason').value = loan.adminReason || '';

        adminBox.hidden = !hasAdminAccess;
        const modal = document.getElementById('loanModal');
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.querySelector('[data-modal-close="loanModal"]')?.focus();
      } catch (err) {
        console.warn('Could not load loan details', err);
      }
    }

    document.querySelectorAll('.decision-btn').forEach(button => {
      button.addEventListener('click', () => {
        const loanId = document.getElementById('modalLoanProduct').dataset.loanId;
        const action = button.dataset.action;
        if (!loanId) return;
        submitLoanDecision(action, Number(loanId));
      });
    });
  