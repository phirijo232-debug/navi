'use strict';

// Copy a shop data folder and upload folder into Supabase.
// Default is a dry run: it prints counts and per-store totals and writes nothing.
//   node scripts/import-to-supabase.js --data ./data --uploads ./public/uploads
//   node scripts/import-to-supabase.js --data ./data --uploads ./public/uploads --commit
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { data: 'data', uploads: path.join('public', 'uploads'), commit: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--commit') args.commit = true;
    else if (argv[i] === '--dry-run') args.commit = false;
    else if (argv[i] === '--data') args.data = argv[++i];
    else if (argv[i] === '--uploads') args.uploads = argv[++i];
  }
  return args;
}

function readJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) return null;
    return { key: name, body: JSON.parse(fs.readFileSync(full, 'utf8')) };
  }).filter(Boolean);
}

function listUploads(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = current => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  return files;
}

function loanTotals(loans) {
  const stores = {};
  for (const loan of Array.isArray(loans) ? loans : []) {
    const store = String(loan.storeId || 'buraza');
    const bucket = stores[store] || { count: 0, principal: 0, outstanding: 0, loans: [] };
    const outstanding = Number(Number(loan.outstanding || 0).toFixed(2));
    const principal = Number(Number(loan.amount || 0).toFixed(2));
    bucket.count += 1;
    bucket.principal = Number((bucket.principal + principal).toFixed(2));
    bucket.outstanding = Number((bucket.outstanding + outstanding).toFixed(2));
    bucket.loans.push({
      id: loan.receiptNumber || loan.id,
      status: loan.status || '',
      outstanding
    });
    stores[store] = bucket;
  }
  return stores;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function summarise(files, uploads) {
  const loans = files.find(file => file.key === 'loans.json');
  return {
    documents: files.map(file => file.key).sort(),
    uploadCount: uploads.length,
    stores: loanTotals(loans ? loans.body : [])
  };
}

function commitImport(files, uploads) {
  const supabaseApi = require('../middleware/supabaseApi');
  files.forEach(file => supabaseApi.putDocument(file.key, file.body));
  uploads.forEach(file => {
    supabaseApi.uploadObject(path.basename(file), fs.readFileSync(file), contentType(file));
  });
  const saved = supabaseApi.getDocument('loans.json');
  return loanTotals(saved || []);
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  const dataDir = path.resolve(args.data);
  const uploadsDir = path.resolve(args.uploads);
  const files = readJsonFiles(dataDir);
  const uploads = listUploads(uploadsDir);
  const plan = summarise(files, uploads);
  console.log(JSON.stringify({ mode: args.commit ? 'commit' : 'dry-run', ...plan }, null, 2));
  if (!args.commit) return { plan, committed: false };
  const after = commitImport(files, uploads);
  if (JSON.stringify(after) !== JSON.stringify(plan.stores)) {
    console.error('Imported loan totals do not match the shop folder.');
    process.exitCode = 1;
    return { plan, after, committed: false };
  }
  console.log('Import matched the shop totals, loan by loan.');
  return { plan, after, committed: true };
}

if (require.main === module) main();

module.exports = { parseArgs, readJsonFiles, loanTotals, summarise, main };
