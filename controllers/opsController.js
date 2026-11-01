const { logError, logBreakage } = require('../middleware/logger');
const { BUSINESS_DATA_FILES } = require('../middleware/dataFiles');
const { listStores, addStore } = require('../middleware/stores');
const { isFranchiseAdmin } = require('../middleware/storeScope');

function listPublicStores(req, res) {
  try {
    const stores = listStores()
      .filter(store => store.active !== false)
      .map(store => ({ id: store.id, name: store.name, code: store.code }));
    return res.json({ stores });
  } catch (err) {
    logError(`STORE LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Stores are temporarily unavailable.' });
  }
}

function createStore(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) {
      return res.status(403).json({ error: 'Only a franchise admin or the main admin can add a store.' });
    }
    const result = addStore(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ message: 'Store added. Existing Buraza records are unchanged.', store: result.store, stores: result.stores });
  } catch (err) {
    logBreakage('opsController.js', 'createStore', err, 'STORE CREATE FAILED');
    return res.status(503).json({ error: 'The store could not be added.' });
  }
}

function goLiveChecklist(req, res) {
  try {
    if (req.authUser?.role !== 'admin') {
      return res.status(403).json({ error: 'The main admin checks this list.' });
    }
    const mode = String(process.env.MAIL_MODE || 'auto').toLowerCase();
    const smtpReady = Boolean(process.env.SMTP_USER || process.env.GMAIL_USER)
      && Boolean(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD);
    const items = [
      { id: 'mail', ok: mode !== 'preview' && smtpReady, label: 'Real email is configured and not stuck in preview.' },
      { id: 'masterKey', ok: Boolean(process.env.MASTER_KEY), label: 'A master password is set in the environment.' },
      { id: 'expenses', ok: BUSINESS_DATA_FILES.includes('expenses.json'), label: 'Backups include the expense book.' },
      { id: 'publicOff', ok: String(process.env.PUBLIC_DEPLOY || '').toLowerCase() !== 'true', label: 'Public mode is off.' },
      { id: 'signing', ok: Boolean(process.env.UPLOAD_SIGNING_KEY), label: 'Photo links can be signed (UPLOAD_SIGNING_KEY).' },
      { id: 'buraza', ok: listStores().some(store => store.id === 'buraza' && store.active !== false), label: 'Buraza is still an active store.' }
    ];
    return res.json({ ready: items.every(item => item.ok), items });
  } catch (err) {
    logError(`GO LIVE CHECK FAILED: ${err.message}`);
    return res.status(503).json({ error: 'The checklist could not be loaded.' });
  }
}

module.exports = { listPublicStores, createStore, goLiveChecklist };
