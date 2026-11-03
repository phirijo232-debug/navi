const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dataStore = require('../middleware/dataStore');
const { canViewFile } = require('../controllers/fileController');

const APPLICATIONS_FILE = dataStore.paths.applications || path.join(dataStore.DATA_DIR, 'applications.json');

test('Quick Screen attachment access is limited to the applicant and authorized store staff', () => {
  dataStore.writeJson(APPLICATIONS_FILE, [{
    id: 'QS-FILE-ACCESS',
    applicationId: 'QS-FILE-ACCESS',
    email: 'applicant@example.test',
    storeId: 'buraza',
    nrcFront: 'quick-screen-nrc-front.jpg',
    nrcBack: 'quick-screen-nrc-back.jpg',
    collateralFront: 'quick-screen-collateral-front.jpg',
    collateralBack: 'quick-screen-collateral-back.jpg'
  }]);

  assert.equal(canViewFile({ email: 'applicant@example.test', role: 'user' }, 'quick-screen-nrc-front.jpg'), true);
  assert.equal(canViewFile({ email: 'main-admin@example.test', role: 'admin' }, 'quick-screen-collateral-back.jpg'), true);
  assert.equal(canViewFile({ email: 'store-admin@example.test', role: 'store_admin', storeId: 'buraza' }, 'quick-screen-collateral-front.jpg'), true);
  assert.equal(canViewFile({ email: 'other-admin@example.test', role: 'store_admin', storeId: 'other-store' }, 'quick-screen-nrc-back.jpg'), false);
  assert.equal(canViewFile({ email: 'other-applicant@example.test', role: 'user' }, 'quick-screen-nrc-front.jpg'), false);
});
