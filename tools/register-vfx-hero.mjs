// PROTOTYPE - NOT FOR PRODUCTION
// Đăng ký vào manifest chung tools/hero-vfx.json. Không build asset, không commit.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const FAMILIES = ['sigil', 'strike', 'lance', 'volley', 'bloom', 'storm', 'gunfire'];
const [sourceId, heroId, family, name, primary, secondary, accent, intensity, note] = process.argv.slice(2);
assert.ok(sourceId && heroId && family && name && primary && secondary && accent,
  'usage: node tools/register-vfx-hero.mjs <sourceId> <heroId> <family> <name> <primary> <secondary> <accent> [intensity] [note]');
assert.ok(FAMILIES.includes(family), `unknown family ${family}`);
const hero = OATHBOUND_HEROES.find(candidate => candidate.sourceId === sourceId);
assert.ok(hero, `${sourceId} is not a roster source id`);
assert.equal(hero.heroId, heroId, `${sourceId} maps to ${hero.heroId}, not ${heroId}`);
for (const value of [primary, secondary, accent]) assert.match(value, /^[0-9a-f]{6}$/, 'colours must be lowercase hex');
const spec = {
  id: sourceId, heroId, family, name, primary, secondary, accent,
  intensity: Number(intensity || 1),
  note: note || `${name} ${family} effect.`,
};

const specsPath = path.join(root, 'tools/hero-vfx.json');
assert.ok(Number.isFinite(spec.intensity) && spec.intensity > 0 && spec.intensity <= 3, 'invalid intensity');
const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
assert.equal(specs.some(entry => entry.id === sourceId), false, `${sourceId} already registered`);
specs.push(spec);
fs.writeFileSync(specsPath, '[\n' + specs.map(entry => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n');

console.log(JSON.stringify({ registered: spec.id, heroId, family, enabled: specs.length }));
