// PROTOTYPE - NOT FOR PRODUCTION
// Read-only package integrity check; does not need or read the original source project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'public/assets/oathbound');
const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
const sprites = JSON.parse(fs.readFileSync(path.join(root, 'src/game/oathboundSprites.json'), 'utf8'));
assert.equal(provenance.ships, false);
assert.equal(provenance.licence.id, 'UNKNOWN');
assert.equal(provenance.assets.length, 22);
assert.equal(sprites.length, 22);
const seen = new Set();
let totalBytes = 0;
for (const entry of provenance.assets) {
  const prefix = 'public/assets/oathbound/';
  assert.ok(entry.path.startsWith(prefix), 'Asset must stay inside the local package');
  const basename = entry.path.slice(prefix.length);
  assert.ok(/^[a-z0-9-]+\.png$/.test(basename), 'Expected a flat PNG filename');
  assert.ok(!seen.has(entry.sourceId), 'Source identities must be unique');
  seen.add(entry.sourceId);
  const sprite = sprites.find(spec => spec.sourceId === entry.sourceId);
  assert.ok(sprite, `Missing sprite metadata: ${entry.sourceId}`);
  assert.equal(sprite.unitId, entry.unitId);
  assert.equal(sprite.src, `/assets/oathbound/${basename}`);
  assert.equal(entry.ships, false);
  assert.equal(entry.licence.id, 'UNKNOWN');
  const bytes = fs.readFileSync(path.join(directory, basename));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', basename);
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', basename);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.source.sha256, basename);
  assert.equal(bytes.readUInt32BE(16), entry.source.width, basename);
  assert.equal(bytes.readUInt32BE(20), entry.source.height, basename);
  assert.equal(sprite.width, entry.source.width, basename);
  assert.equal(sprite.height, entry.source.height, basename);
  totalBytes += bytes.length;
}
assert.equal(new Set(sprites.map(spec => spec.sourceId)).size, seen.size);
const actualPngs = fs.readdirSync(directory).filter(name => name.endsWith('.png')).sort();
assert.deepEqual(actualPngs, provenance.assets.map(entry => path.basename(entry.path)).sort());
console.log(JSON.stringify({ assets: seen.size, totalBytes, sha256AndDimensionsMatch: true,
  sourceProjectRequired: false, rights: provenance.licence.id, ships: provenance.ships }, null, 2));
