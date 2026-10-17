const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:', { allowExtension: true });
db.exec('CREATE VIRTUAL TABLE test USING fts5(content)');
db.prepare('INSERT INTO test(content) VALUES (?)').run('offline semantic video');
assert.equal(db.prepare("SELECT count(*) AS n FROM test WHERE test MATCH 'video'").get().n, 1);
const result = { checked: new Date().toISOString(), versions: process.versions, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, loadExtensionMethod: typeof db.loadExtension, fts5: true, extensionActuallyLoaded: false };
db.close();
const output = path.join(__dirname, `sqlite-${process.versions.electron ? `electron-${process.versions.electron}` : `node-${process.version}`}.json`);
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
