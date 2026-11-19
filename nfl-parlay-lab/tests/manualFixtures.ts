import { liveCacheKey } from '../src/server/credentials.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { gzipSync } from 'node:zlib';
import { SCHEMA } from '../src/server/db.ts';
import { loadLive, refreshCandidateHistory } from '../src/lib/service.ts';
import { eligible, generate } from '../src/lib/optimizer.ts';
import { MODEL_VERSION, scoreAll } from '../src/lib/model.ts';
import { recordForecasts, updateValidation, evaluationRows, trackingStatus, calibrationSnapshot } from '../src/server/tracking.ts';
import { loadStats } from '../src/lib/providers/stats.ts';

// Synthetic provider fixtures only: never used as application data.
const NOW = Date.parse('2026-11-09T12:00:00Z');
const kickoff = '2026-11-15T18:00:00Z';
const players = [
  ['QB One', 'QB', 'BUF', 'MIN', 'player_pass_yds', 'g1'],
  ['RB One', 'RB', 'BUF', 'MIN', 'player_rush_yds', 'g1'],
  ['WR One', 'WR', 'MIN', 'BUF', 'player_reception_yds', 'g1'],
  ['RB Two', 'RB', 'SEA', 'LAR', 'player_rush_yds', 'g2'],
  ['WR Two', 'WR', 'LAR', 'SEA', 'player_reception_yds', 'g2'],
  ['TE One', 'TE', 'SEA', 'LAR', 'player_reception_yds', 'g2'],
  ['RB Aggressive', 'RB', 'SEA', 'LAR', 'player_rush_yds', 'g2'],
];
const header = 'player_display_name,position,team,opponent_team,season,week,season_type,game_id,gsis_id,game_date,passing_yards,passing_tds,passing_attempts,rushing_attempts,rushing_yards,receptions,targets,receiving_yards';
const canonical = (team: string) => team === 'LAR' ? 'LA' : team;
const csvRow = (player: string[], week: number, date: string, value: number) => {
  const [name, pos, team, opp] = player;
  return `${name},${pos},${team},${opp},2026,${week},REG,2026_${String(week).padStart(2, '0')}_${[canonical(team), canonical(opp)].sort().join('_')},id-${name},${date},${value},2,25,10,${value},8,10,${value}`;
};
let finalResults = false;
let traded = false;
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if(url.pathname.endsWith('/nfl/injuries'))return Response.json({timestamp:new Date(NOW).toISOString(),season:{year:2026,type:2},injuries:['BUF','MIN','LA','SEA'].map((team,i)=>({id:String(i+1),injuries:[{date:new Date(NOW).toISOString(),status:'Out',athlete:{displayName:'Unrelated Injury Fixture '+team,team:{id:String(i+1),abbreviation:team}}}]}))});
  if (/games\.csv(?:\.gz)?$/.test(url.pathname)) return new Response(gzipSync(Buffer.from('game_id,season,week,game_type,gameday,home_team,away_team,home_score,away_score,espn,gametime\n' + ['2026_10_BUF_MIN,2026,10,REG,2026-11-15,MIN,BUF,', '2026_10_LA_SEA,2026,10,REG,2026-11-15,SEA,LA,'].map((row) => row + (finalResults ? '21,20,,13:00' : ',,,13:00')).join('\n'))));
  if (url.pathname.endsWith('/releases/tags/stats_player')) return Response.json({ assets: [2026, 2025].map((year) => ({ name: `stats_player_week_${year}.csv.gz`, url: `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${year}` })) });
  if (url.pathname.endsWith('/releases/tags/injuries')) return Response.json({ assets: [{ name: 'injuries_2026.csv.gz', url: 'https://api.github.com/repos/nflverse/nflverse-data/releases/assets/injuries' }] });
  if (url.pathname.endsWith('/assets/injuries')) return new Response(gzipSync(Buffer.from('full_name,team,week,report_status\n')));
  if (url.pathname.endsWith('/assets/2025')) return new Response(gzipSync(Buffer.from(header + '\n')));
  if (url.pathname.endsWith('/assets/2026')) {
    const rows = players.flatMap((player) => Array.from({ length: 6 }, (_, i) => csvRow(traded && player[0] === 'QB One' ? [player[0], player[1], 'JAX', 'TEN', player[4], player[5]] : player, i + 1, `2026-10-${String(i + 1).padStart(2, '0')}`, player[0] === 'RB Aggressive' && i < 2 ? 10 : 100)));
    if (finalResults) rows.push(...players.map((player) => csvRow(player, 10, '2026-11-15', 100)));
    return new Response(gzipSync(Buffer.from([header, ...rows].join('\n'))));
  }
  if (url.pathname.endsWith('/events')) return Response.json([
    { id: 'g1', commence_time: kickoff, away_team: 'Buffalo Bills', home_team: 'Minnesota Vikings' },
    { id: 'g2', commence_time: kickoff, away_team: 'Los Angeles Rams', home_team: 'Seattle Seahawks' },
  ]);
  if (url.pathname.endsWith('/roster')) {
    const slug = url.pathname.split('/').at(-2)!;
    const team = slug === 'lar' ? 'LAR' : slug.toUpperCase();
    return Response.json({ team: { abbreviation: team }, athletes: [{ items: players.filter((player) => player[2] === team).map((player) => ({ id: `espn-${player[0]}`, fullName: player[0], position: { abbreviation: player[1] }, status: { type: 'active' } })) }] });
  }
  if (url.pathname.endsWith('/odds')) {
    const event = url.pathname.split('/').at(-2);
    return Response.json({ bookmakers: [{ key: 'fanduel', markets: players.filter((player) => player[5] === event).map((player) => ({
      key: player[4], last_update: new Date(NOW).toISOString(), outcomes: [
        { name: 'Over', description: player[0], point: 50.5, price: player[0] === 'RB Aggressive' ? 190 : -110 },
        { name: 'Under', description: player[0], point: 50.5, price: -110 },
      ],
    })) }] });
  }
  throw new Error(`Unexpected fixture URL ${url.pathname}`);
};


export {fetcher,players,NOW,kickoff};
export const finishFixtureGames=()=>{finalResults=true;};
