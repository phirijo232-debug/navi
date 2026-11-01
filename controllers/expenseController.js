const path = require('path');
const { logError, logBreakage } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');

const EXPENSES_FILE = path.join(path.dirname(dataStore.paths.loans), 'expenses.json');

function getExpensesData() {
  return dataStore.readJson(EXPENSES_FILE, [], Array.isArray);
}

function saveExpensesData(expenses) {
  dataStore.writeJson(EXPENSES_FILE, expenses);
}

function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Number(amount.toFixed(2));
}

function parseDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return raw;
}

function cleanExpenseInput(body = {}) {
  const date = parseDate(body.date);
  const category = String(body.category || '').trim();
  const amount = parseAmount(body.amount);
  const note = String(body.note || '').trim();
  if (!date) return { error: 'Date is required and must be YYYY-MM-DD.' };
  if (!category || category.length > 80) return { error: 'Category is required (up to 80 characters).' };
  if (amount === null) return { error: 'Amount must be greater than zero.' };
  if (note.length > 500) return { error: 'Note must be 500 characters or fewer.' };
  return { date, category, amount, note };
}

function requireExpenseAccess(req, res) {
  if (!isAdminRole(req.authUser?.role)) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  const storeId = getRequestedStoreId(req);
  if (!canAccessStore(req, storeId)) {
    res.status(403).json({ error: 'Access to this store is not allowed.' });
    return null;
  }
  return storeId;
}

function listExpenses(req, res) {
  try {
    const storeId = requireExpenseAccess(req, res);
    if (!storeId) return;
    const expenses = getExpensesData()
      .filter(item => storeId === 'all' || getRecordStoreId(item) === storeId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id));
    res.json({ expenses });
  } catch (err) {
    logError(`EXPENSE LIST FAILED: ${err.message}`);
    res.status(503).json({ error: 'Expenses are temporarily unavailable.' });
  }
}

function createExpense(req, res) {
  try {
    const storeId = requireExpenseAccess(req, res);
    if (!storeId) return;
    if (storeId === 'all') {
      return res.status(400).json({ error: 'Choose a store before recording an expense.' });
    }
    const input = cleanExpenseInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });

    const expenses = getExpensesData();
    const nextId = expenses.length ? Math.max(...expenses.map(item => Number(item.id) || 0)) + 1 : 1;
    const now = new Date().toISOString();
    const expense = {
      id: nextId,
      storeId,
      date: input.date,
      category: input.category,
      amount: input.amount,
      note: input.note,
      recordedBy: req.authUser?.email || req.authUser?.username || 'admin',
      createdAt: now,
      updatedAt: now
    };
    expenses.push(expense);
    saveExpensesData(expenses);
    res.status(201).json({ message: 'Expense recorded.', expense });
  } catch (err) {
    logBreakage('expenseController.js', 'createExpense', err, 'EXPENSE RECORD FAILED');
    res.status(503).json({ error: 'Unable to record the expense.' });
  }
}

function updateExpense(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });
    const id = Number(req.params.id);
    const expenses = getExpensesData();
    const index = expenses.findIndex(item => Number(item.id) === id);
    if (index < 0) return res.status(404).json({ error: 'Expense not found.' });
    if (!canAccessRecord(req, expenses[index])) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const input = cleanExpenseInput({ ...expenses[index], ...req.body });
    if (input.error) return res.status(400).json({ error: input.error });
    expenses[index] = {
      ...expenses[index],
      date: input.date,
      category: input.category,
      amount: input.amount,
      note: input.note,
      updatedAt: new Date().toISOString()
    };
    saveExpensesData(expenses);
    res.json({ message: 'Expense updated.', expense: expenses[index] });
  } catch (err) {
    logBreakage('expenseController.js', 'updateExpense', err, 'EXPENSE UPDATE FAILED');
    res.status(503).json({ error: 'Unable to update the expense.' });
  }
}

function deleteExpense(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });
    const id = Number(req.params.id);
    const expenses = getExpensesData();
    const existing = expenses.find(item => Number(item.id) === id);
    if (!existing) return res.status(404).json({ error: 'Expense not found.' });
    if (!canAccessRecord(req, existing)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    saveExpensesData(expenses.filter(item => Number(item.id) !== id));
    res.json({ message: 'Expense deleted.' });
  } catch (err) {
    logBreakage('expenseController.js', 'deleteExpense', err, 'EXPENSE DELETE FAILED');
    res.status(503).json({ error: 'Unable to delete the expense.' });
  }
}

module.exports = {
  EXPENSES_FILE,
  getExpensesData,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense
};
