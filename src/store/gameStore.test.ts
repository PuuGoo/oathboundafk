// PROTOTYPE - NOT FOR PRODUCTION
// Integration checks for authorized Oathbound save creation and legacy loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, loadSavedData, useGameStore } from './gameStore';
import { createOathboundFormation, OATHBOUND_HEROES } from '../game/oathboundHeroes';

const SOURCE_STARTERS = ['estrilda', 'celestial_guardian', 'raine', 'belinda', 'fawkes'];

function storageFixture(value: unknown) {
  return { getItem: (key: string) => key === 'eternal_realms_save_v1' ? JSON.stringify(value) : null };
}

function legacyFixture() {
  const fresh = createInitialData();
  return {
    ...fresh,
    gold: 555, heroExp: 777, essenceGems: 99,
    formation: ['storm_empress', null, 'celestial_guardian', null, 'pyre_archon'],
    savedPresets: [{ id: 'legacy', name: 'Untouched', slots: [null, null, null, null, null] }],
    ownedHeroes: {
      celestial_guardian: { heroId: 'celestial_guardian', level: 77, stars: 4, copies: 12,
        equipment: { weapon: 4, armor: 3, relic: 2 } },
    },
  };
}

test('explicit encounter restart preserves earned rewards, ownership and chosen navigation destination', () => {
  const previous = useGameStore.getState();
  try {
    for (const won of [false, true]) {
      useGameStore.setState({ ...createInitialData(), battleInstanceKey: 1, currentStageId: 1 });
      useGameStore.getState().recordBattleOutcome(1, won);
      const settled = useGameStore.getState();
      for (const screen of ['formation', 'upgrades'] as const) {
        const before = useGameStore.getState();
        before.restartCurrentBattle();
        useGameStore.getState().setActiveScreen(screen);
        const after = useGameStore.getState();
        assert.equal(after.battleInstanceKey, before.battleInstanceKey + 1);
        assert.equal(after.activeScreen, screen);
        for (const key of ['gold', 'heroExp', 'essenceGems', 'clearedStageIds', 'formation', 'ownedHeroes'] as const) {
          assert.deepEqual(after[key], settled[key], `${won}/${screen}/${key}`);
        }
      }
    }
  } finally {
    useGameStore.setState(previous, true);
  }
});

test('new saves own all 22 transferred heroes and visibly deploy the source five', () => {
  const fresh = createInitialData();
  assert.deepEqual(fresh.formation, SOURCE_STARTERS);
  for (const { heroId } of OATHBOUND_HEROES) assert.ok(fresh.ownedHeroes[heroId]);
  for (const heroId of SOURCE_STARTERS) assert.ok(fresh.ownedHeroes[heroId]);
  assert.deepEqual(fresh.ownedHeroes.estrilda, {
    heroId: 'estrilda', level: 1, stars: 1, copies: 1,
    equipment: { weapon: 0, armor: 0, relic: 0 },
  });
  assert.equal(fresh.ownedHeroes.celestial_guardian.level, 5);
  assert.equal(fresh.ownedHeroes.celestial_guardian.equipment.weapon, 1);
  const preset = fresh.savedPresets.find((team) => team.id === 'preset_oathbound');
  assert.equal(preset?.name, 'Oathbound');
  assert.deepEqual(preset?.slots, SOURCE_STARTERS);
  assert.notStrictEqual(preset?.slots, fresh.formation);
});

test('legacy saves are migrated after their fields override defaults, preserving progress and teams', () => {
  const old = legacyFixture();
  const loaded = loadSavedData(storageFixture(old));
  for (const { heroId } of OATHBOUND_HEROES) assert.ok(loaded.ownedHeroes[heroId]);
  for (const [key, value] of Object.entries(old)) {
    if (key !== 'ownedHeroes') assert.deepEqual(loaded[key as keyof typeof loaded], value);
  }
  assert.deepEqual(loaded.ownedHeroes.celestial_guardian, old.ownedHeroes.celestial_guardian);
  assert.equal(loaded.savedPresets.some((team) => team.id === 'preset_oathbound'), false);
  assert.deepEqual(loadSavedData(storageFixture(loaded)), loaded);
});

test('malformed ownership in an otherwise valid old save does not reset resources or formation', () => {
  for (const ownedHeroes of [null, undefined, [], 'broken']) {
    const old = { ...legacyFixture(), ownedHeroes };
    const loaded = loadSavedData(storageFixture(old));
    assert.equal(loaded.gold, old.gold);
    assert.deepEqual(loaded.formation, old.formation);
    assert.deepEqual(loaded.savedPresets, old.savedPresets);
    assert.equal(Object.keys(loaded.ownedHeroes).length, 22);
  }
});

test('quick source squad selection preserves ownership and resources from every opening order', () => {
  const previous = useGameStore.getState();
  const permutations = (ids: string[]): string[][] => ids.length === 0 ? [[]] : ids.flatMap((id, i) =>
    permutations(ids.filter((_, index) => index !== i)).map(rest => [id, ...rest]));
  try {
    const fresh = createInitialData();
    const formations = [
      ...permutations(createOathboundFormation()),
      [...fresh.savedPresets.find(preset => preset.id === 'preset_balanced')!.slots],
      [null, null, null, null, null],
    ];
    for (const formation of formations) {
      useGameStore.setState({ ...fresh, formation: formation as typeof fresh.formation });
      const before = useGameStore.getState();
      createOathboundFormation().forEach((heroId, slot) => before.assignHeroToSlot(heroId, slot));
      const after = useGameStore.getState();
      assert.deepEqual(after.formation, SOURCE_STARTERS);
      assert.equal(new Set(after.formation).size, 5);
      assert.strictEqual(after.ownedHeroes, before.ownedHeroes);
      assert.strictEqual(after.savedPresets, before.savedPresets);
      assert.equal(after.gold, before.gold);
      assert.equal(after.heroExp, before.heroExp);
      assert.equal(after.essenceGems, before.essenceGems);
    }
  } finally { useGameStore.setState(previous, true); }
});

test('migrated imported progression survives actual store persistence and repeated loading', () => {
  const previous = useGameStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  };
  const old = legacyFixture();
  const loaded = loadSavedData(storageFixture(old));
  const awakenedId = 'hero_248_eluard';
  const progressed = { ...old.ownedHeroes.celestial_guardian, heroId: awakenedId,
    equipment: { ...old.ownedHeroes.celestial_guardian.equipment } };
  loaded.ownedHeroes = { ...loaded.ownedHeroes, [awakenedId]: progressed };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
      value: { localStorage: storage } });
    for (let cycle = 0; cycle < 3; cycle++) {
      useGameStore.setState(loaded);
      useGameStore.getState().assignHeroToSlot(awakenedId, 0);
      const next = loadSavedData(storage);
      assert.ok(saved.has('eternal_realms_save_v1'), 'store action must persist a real payload');
      assert.deepEqual(next.ownedHeroes, loaded.ownedHeroes);
      assert.deepEqual(next.ownedHeroes[awakenedId], progressed);
      assert.deepEqual(next.ownedHeroes.celestial_guardian, old.ownedHeroes.celestial_guardian);
      assert.equal(next.formation[0], awakenedId);
      assert.equal(next.gold, old.gold);
      assert.equal(next.heroExp, old.heroExp);
      assert.equal(next.essenceGems, old.essenceGems);
      assert.deepEqual(next.savedPresets, old.savedPresets);
      assert.equal(OATHBOUND_HEROES.filter(hero => next.ownedHeroes[hero.heroId]).length, 22);
      Object.assign(loaded, next);
    }
  } finally {
    useGameStore.setState(previous, true);
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('denied save writes preserve imported team in memory and recover on a later write', () => {
  const previous = useGameStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const saved = new Map<string, string>();
  let denied = true;
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (denied) throw new Error('fixture storage quota denied');
      saved.set(key, value);
    },
  };
  const initial = createInitialData();
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
      value: { localStorage: storage } });
    useGameStore.setState(initial);
    const before = useGameStore.getState();
    const awakenedId = 'hero_248_eluard';
    assert.doesNotThrow(() => before.assignHeroToSlot(awakenedId, 0));
    const inMemory = useGameStore.getState();
    assert.equal(inMemory.formation[0], awakenedId);
    assert.strictEqual(inMemory.ownedHeroes, before.ownedHeroes);
    assert.strictEqual(inMemory.savedPresets, before.savedPresets);
    assert.equal(inMemory.gold, before.gold);
    assert.equal(inMemory.heroExp, before.heroExp);
    assert.equal(inMemory.essenceGems, before.essenceGems);
    assert.equal(saved.size, 0, 'denied write must not be represented as persisted');
    denied = false;
    inMemory.assignHeroToSlot(awakenedId, 0);
    const loaded = loadSavedData(storage);
    assert.equal(loaded.formation[0], awakenedId);
    assert.deepEqual(loaded.ownedHeroes, before.ownedHeroes);
    assert.equal(loaded.gold, before.gold);
    assert.deepEqual(loaded.savedPresets, before.savedPresets);
  } finally {
    useGameStore.setState(previous, true);
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('missing, invalid or inaccessible storage safely returns a fully migrated new save', () => {
  for (const storage of [
    { getItem: () => null },
    { getItem: () => '{bad-json' },
    { getItem: () => { throw new Error('storage denied'); } },
    storageFixture({ gold: 1, formation: [] }),
  ]) {
    const loaded = loadSavedData(storage);
    assert.deepEqual(loaded.formation, SOURCE_STARTERS);
    for (const { heroId } of OATHBOUND_HEROES) assert.ok(loaded.ownedHeroes[heroId]);
  }
});
