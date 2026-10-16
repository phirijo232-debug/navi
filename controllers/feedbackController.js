const fs = require('fs');
const path = require('path');
const { logError } = require('../middleware/logger');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');

const FEEDBACK_FILE = dataStore.paths.feedback;

function getFeedbackData() {
  return dataStore.readJson(FEEDBACK_FILE, [], Array.isArray);
}

function saveFeedbackData(entries) {
  try {
    dataStore.writeJson(FEEDBACK_FILE, entries);
  } catch (err) {
    logError(`FEEDBACK WRITE FAILED: ${err.message}`);
    throw err;
  }
}

function classifyFeedback(message = '') {
  const text = String(message).toLowerCase().trim();
  if (!text) return 'inquiry';

  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchesTerm = (terms) => terms.some(term => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(text));

  const complaint = ['crash', 'crashing', 'broken', 'error', 'issue', 'problem', 'bug', 'failed', 'not working', 'fault', 'delay', 'missing', 'incorrect', 'frustrated', 'angry', 'unable'];
  const improvement = ['improve', 'improvement', 'better dashboard', 'history filter', 'suggestion', 'suggest', 'idea', 'feature request', 'feature', 'enhance', 'upgrade', 'optimize', 'add a', 'add more', 'add another', 'better experience'];
  const experience = ['good experience', 'great service', 'helpful', 'friendly', 'smooth', 'easy', 'excellent', 'satisfied', 'positive', 'very helpful', 'pleasant experience'];

  if (matchesTerm(complaint)) return 'complaint';
  if (matchesTerm(improvement)) return 'improvement';
  if (matchesTerm(experience)) return 'experience';

  const isInquiry = /(how|what|when|where|why|can|could|please|do i|may i|is it|will it|which|who|need)/.test(text);
  return isInquiry ? 'inquiry' : 'inquiry';
}

function normalizeCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (['complaint', 'issue', 'problem'].includes(normalized)) return 'complaint';
  if (['improvement', 'improve', 'suggestion', 'idea', 'feature'].includes(normalized)) return 'improvement';
  if (['experience', 'feedback', 'review'].includes(normalized)) return 'experience';
  return 'inquiry';
}

function submitFeedback(req, res) {
  try {
    const { email, message, category } = req.body || {};
    const authEmail = req.authUser?.email || email;

    if (!req.authUser || !authEmail) {
      return res.status(403).json({ error: 'Authentication required to submit feedback.' });
    }

    if (email && authEmail !== email) {
      return res.status(403).json({ error: 'Feedback submission does not match this account.' });
    }

    const content = String(message || '').trim();
    if (!content) {
      return res.status(400).json({ error: 'Please add your feedback details.' });
    }

    const finalCategory = normalizeCategory(category || classifyFeedback(content));
    const feedbackEntries = getFeedbackData();
    const nextId = feedbackEntries.length ? Math.max(...feedbackEntries.map(item => Number(item.id) || 0)) + 1 : 1;

    const item = {
      id: nextId,
      email: authEmail,
      storeId: req.authUser.storeId || config.DEFAULT_STORE_ID,
      category: finalCategory,
      message: content,
      status: 'new',
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewNote: null
    };

    feedbackEntries.push(item);
    saveFeedbackData(feedbackEntries);

    res.json({ message: 'Feedback submitted successfully.', feedback: item });
  } catch (err) {
    logError(`FEEDBACK SUBMIT FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to submit feedback right now.' });
  }
}

function getFeedback(req, res) {
  try {
    if (!req.authUser) {
      return res.status(403).json({ error: 'Authentication required.' });
    }

    const entries = getFeedbackData();
    const isAdmin = isAdminRole(req.authUser?.role);
    const email = req.query?.email;
    const storeId = getRequestedStoreId(req);

    if (isAdmin && !canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    if (!isAdmin && !email) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (!isAdmin && email && req.authUser.email !== email) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    let filtered = isAdmin
      ? entries.filter(item => storeId === 'all' || getRecordStoreId(item) === storeId)
      : entries.filter(item => getRecordStoreId(item) === getRecordStoreId(req.authUser));
    if (!isAdmin && email) {
      filtered = filtered.filter(item => item.email === email);
    }

    const summary = {
      total: filtered.length,
      complaint: filtered.filter(item => item.category === 'complaint').length,
      improvement: filtered.filter(item => item.category === 'improvement').length,
      inquiry: filtered.filter(item => item.category === 'inquiry').length,
      experience: filtered.filter(item => item.category === 'experience').length,
      new: filtered.filter(item => item.status === 'new').length
    };

    res.json({ feedback: filtered, summary });
  } catch (err) {
    logError(`FEEDBACK FETCH FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load feedback.' });
  }
}

function updateFeedbackStatus(req, res) {
  try {
    const { id, status, reviewNote } = req.body || {};
    if (req.authUser?.role !== 'store_admin') {
      return res.status(403).json({ error: 'BMF store admin access required.' });
    }

    const feed = getFeedbackData();
    const index = feed.findIndex(item => String(item.id) === String(id));
    if (index === -1) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }
    if (!canAccessRecord(req, feed[index])) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    const nextStatus = ['new', 'reviewing', 'resolved', 'closed'].includes(String(status || '').toLowerCase())
      ? String(status).toLowerCase()
      : 'reviewing';

    feed[index].status = nextStatus;
    feed[index].reviewNote = reviewNote || feed[index].reviewNote || null;
    feed[index].reviewedBy = req.authUser?.email || null;
    feed[index].reviewedAt = new Date().toISOString();

    saveFeedbackData(feed);
    res.json({ message: 'Feedback updated.', feedback: feed[index] });
  } catch (err) {
    logError(`FEEDBACK UPDATE FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to update feedback.' });
  }
}

module.exports = {
  getFeedbackData,
  saveFeedbackData,
  classifyFeedback,
  normalizeCategory,
  submitFeedback,
  getFeedback,
  updateFeedbackStatus
};
