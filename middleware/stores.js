const path = require('path');
const config = require('../config');
const dataStore = require('./dataStore');

const STORES_FILE = path.join(dataStore.DATA_DIR, 'stores.json');

function listStores() {
  const saved = dataStore.readJson(STORES_FILE, null, Array.isArray);
  if (Array.isArray(saved) && saved.length) return saved;
  const seeded = (config.STORES || []).map(store => ({
    id: store.id,
    name: store.name,
    code: store.code,
    active: store.active !== false
  }));
  dataStore.writeJson(STORES_FILE, seeded);
  return seeded;
}

function addStore({ id, name, code }) {
  const stores = listStores();
  const storeId = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(storeId)) {
    return { error: 'Store id must be 2 to 32 letters, numbers, or dashes.' };
  }
  if (stores.some(store => store.id === storeId)) {
    return { error: 'That store already exists.' };
  }
  const entry = {
    id: storeId,
    name: String(name || '').trim(),
    code: String(code || storeId).trim().toUpperCase().slice(0, 8),
    active: true
  };
  if (!entry.name) return { error: 'A store name is required.' };
  stores.push(entry);
  dataStore.writeJson(STORES_FILE, stores);
  return { store: entry, stores };
}

module.exports = { listStores, addStore, STORES_FILE };
