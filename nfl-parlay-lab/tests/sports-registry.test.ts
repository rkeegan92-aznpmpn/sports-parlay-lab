import test from 'node:test';
import assert from 'node:assert/strict';
import { SPORT_IDS } from '../src/lib/sports/types.ts';
import { listSports, getSport, resolveSport, isSportId, implementedSports } from '../src/lib/sports/registry.ts';
import { SLOTS, MAX_LEGS_PER_GAME } from '../src/lib/optimizer.ts';
import { PROP_STATS } from '../src/lib/propMarkets.ts';

test('registry covers NFL, NBA, MLB, NHL and MMA, each exactly once', () => {
  assert.deepEqual(listSports().map((s) => s.id), [...SPORT_IDS]);
  assert.deepEqual([...SPORT_IDS], ['nfl', 'nba', 'mlb', 'nhl', 'mma']);
});
test('NFL descriptor reads live optimizer/market constants and is the only implemented sport', () => {
  const nfl = getSport('nfl');
  assert.deepEqual(nfl.ticketRules.slots, SLOTS);
  assert.equal(nfl.ticketRules.maxLegsPerGame, MAX_LEGS_PER_GAME);
  assert.equal(nfl.ticketRules.legs, 6);
  assert.equal(nfl.ticketRules.provisional, false);
  assert.equal(nfl.providerSportKey, 'football_nfl');
  for (const d of Object.values(PROP_STATS)) assert.ok(nfl.markets.some((m) => m.id === d.market), d.market);
  assert.ok(nfl.markets.some((m) => m.id === 'player_anytime_td'));
  assert.deepEqual(implementedSports().map((s) => s.id), ['nfl']);
});
test('planned sports invent no provider keys and mark every market unverified', () => {
  for (const id of ['nba', 'mlb', 'nhl', 'mma'] as const) {
    const s = getSport(id);
    assert.equal(s.status, 'planned');
    assert.equal(s.providerSportKey, null);
    assert.equal(s.ticketRules.provisional, true);
    assert.equal(s.ticketRules.legs, 6);
    assert.ok(s.markets.length > 0);
    assert.ok(s.markets.every((m) => m.coverage === 'unverified'), id);
  }
});
test('MMA/UFC lists winner, round total, method, KO/TKO, submission and decision plus fighter props', () => {
  const ids = getSport('mma').markets.map((m) => m.id);
  for (const id of ['fight_winner', 'round_total', 'method_of_victory', 'ko_tko', 'submission', 'decision']) assert.ok(ids.includes(id), id);
  assert.equal(getSport('mma').participantNoun, 'fighter');
  assert.ok(getSport('mma').markets.some((m) => m.scope === 'fighter'));
});
test('market ids are unique within a sport; unknown sport input falls back to NFL', () => {
  for (const s of listSports()) assert.equal(new Set(s.markets.map((m) => m.id)).size, s.markets.length, s.id);
  assert.equal(resolveSport(undefined).id, 'nfl');
  assert.equal(resolveSport('cricket').id, 'nfl');
  assert.equal(resolveSport('nba').id, 'nba');
  assert.equal(isSportId('mma'), true);
  assert.equal(isSportId('NFL'), false);
});
