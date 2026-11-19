import {PROP_STATS,quarterMarketName} from '../propMarkets.ts';
import type { StatGame } from './stats.ts';
import { normName } from './stats.ts';
import {activeRoster,UNAVAILABLE_STATUS} from '../availability.ts';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
const APP_TEAMS: Record<string, string> = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX' };
const ESPN_TEAM_SLUG: Record<string, string> = { LA: 'lar', WAS: 'wsh', JAX: 'jax' };

export interface EspnPlayerLookup {
  key: string;
  name: string;
  positions: string[];
  teams: string[];
}

export interface EspnHistoryResult {
  games: Map<string, StatGame[]>;
  teamByLookup: Map<string, string>;
  unmatched: number;
  errors: string[];
}

interface EspnAthlete {
  id: string;
  name: string;
  position: string;
  team: string;
  status?: string;
}

export interface RosterLookup {
  key: string;
  name: string;
  position: string;
  team: string;
}

export interface RosterVerificationResult {
  players: Map<string, EspnAthlete>;
  unmatched: number;
  errors: string[];
}

const appTeam = (team: string) => APP_TEAMS[team.toUpperCase()] ?? team.toUpperCase();
const teamSlug = (team: string) => ESPN_TEAM_SLUG[team.toUpperCase()] ?? team.toLowerCase();
const finiteStat = (value: unknown) => {
  if (value === '' || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

async function fetchJson(url: string, cacheName: string, f: typeof fetch): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await f(url, {
      headers: { 'x-provider-cache-name': `espn:${cacheName}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status} for ${new URL(url).pathname}.`);
    try {
      return await response.json();
    } catch {
      throw new Error(`ESPN returned malformed JSON for ${new URL(url).pathname}.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`ESPN request timed out for ${new URL(url).pathname}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRoster(team: string, f: typeof fetch): Promise<EspnAthlete[]> {
  const slug = teamSlug(team);
  const data = await fetchJson(`${BASE}/teams/${slug}/roster`, `roster:${slug}`, f);
  const groups = Array.isArray(data?.athletes) ? data.athletes : [];
  return groups.flatMap((group: any) => Array.isArray(group?.items) ? group.items.map((athlete: any) => ({ athlete, group })) : [])
    .filter((athlete: any) =>
      typeof athlete.athlete?.id === 'string' &&
      typeof (athlete.athlete.fullName ?? athlete.athlete.displayName) === 'string' &&
      typeof athlete.athlete?.position?.abbreviation === 'string',
    )
    .map(({ athlete, group }: any) => ({
      id: athlete.id,
      name: athlete.fullName ?? athlete.displayName,
      position: athlete.position.abbreviation,
      team: appTeam(data?.team?.abbreviation ?? team),
      status: [
        ...(typeof athlete.status === 'string' ? [athlete.status] :
          [athlete.status?.type, athlete.status?.name, athlete.status?.description, group?.name]
            .filter((value) => typeof value === 'string' && /active|inactive|reserve|practice.?squad|suspend/i.test(value))),
        ...(Array.isArray(athlete.injuries) ? athlete.injuries.map((injury: any) => injury?.status)
          .filter((value: unknown) => typeof value === 'string') : []),
      ].join(' '),
    }));
}

export async function verifyCurrentRoster(
  requests: RosterLookup[],
  f: typeof fetch = fetch,
): Promise<RosterVerificationResult> {
  const players = new Map<string, EspnAthlete>();
  const errors: string[] = [];
  const teams = [...new Set(requests.map((request) => appTeam(request.team)))];
  const rosters = await Promise.all(teams.map(async (team) => {
    try {
      return [team, await fetchRoster(team, f)] as const;
    } catch (error) {
      errors.push(`${team}: ${error instanceof Error ? error.message : String(error)}`);
      return [team, []] as const;
    }
  }));
  const athletes = rosters.flatMap(([, roster]) => roster);
  let unmatched = 0;
  for (const request of requests) {
    const matches = athletes.filter((athlete) =>
      athlete.team === appTeam(request.team) &&
      athlete.position === request.position &&
      normName(athlete.name) === normName(request.name),
    );
    if (matches.length !== 1) {
      unmatched++;
      continue;
    }
    players.set(request.key, matches[0]);
  }
  return { players, unmatched, errors: [...new Set(errors)] };
}

function regularSeasonEvents(data: any, season: number) {
  const events = data?.events;
  if (!events || typeof events !== 'object') return [];
  return Object.values(events).flatMap((event: any) => {
    if (typeof event?.id !== 'string' || typeof event?.gameDate !== 'string' || !Number.isFinite(Date.parse(event.gameDate))) return [];
    const seasonTypeId = String(event.seasonType?.id ?? '');
    const eventLabel = `${event.eventNote ?? ''} ${event.seasonType?.name ?? ''} ${event.seasonType?.type ?? ''}`;
    if (seasonTypeId && seasonTypeId !== '2') return [];
    if (/preseason|postseason|playoff|wild.?card|divisional|conference|super bowl/i.test(eventLabel)) return [];
    return [{
      id: event.id,
      date: Date.parse(event.gameDate),
      season,
      week: Number(event.week),
    }];
  });
}

function statValues(group: any): Record<string, number> {
  const keys: unknown[] = Array.isArray(group?.keys) ? group.keys : [];
  const values: unknown[] = Array.isArray(group?.stats) ? group.stats : [];
  const output: Record<string, number> = {};
  keys.forEach((key, index) => {
    if (typeof key !== 'string') return;
    const raw = values[index];
    if (key === 'completions/passingAttempts' && typeof raw === 'string') {
      const [completions, attempts] = raw.split('/');
      const completionValue = finiteStat(completions), attemptValue = finiteStat(attempts);
      if (completionValue != null) output.completions = completionValue;
      if (attemptValue != null) output.attempts = attemptValue;
    } else {
      const value = finiteStat(raw);
      if (value != null) output[key] = value;
    }
  });
  return output;
}

interface EspnEvent { id: string; date: number; season: number; week: number }
function parseGameSummary(data: any, targetIds: Set<string>, expected: EspnEvent): StatGame[] {
  const header = data?.header;
  const competition = header?.competitions?.[0];
  const competitors: any[] = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((competitor) => competitor?.homeAway === 'home');
  const away = competitors.find((competitor) => competitor?.homeAway === 'away');
  if (!home?.team?.abbreviation || !away?.team?.abbreviation) return [];
  const homeTeam = appTeam(home.team.abbreviation);
  const awayTeam = appTeam(away.team.abbreviation);
  const season = Number(header?.season?.year);
  const week = Number(header?.week?.number ?? header?.week);
  const gameId = String(header?.id ?? competition?.id ?? '');
  const summaryDate = Date.parse(competition?.date ?? header?.competitions?.[0]?.date ?? '');
  if (gameId !== expected.id || season !== expected.season || week !== expected.week ||
      !Number.isFinite(summaryDate) || new Date(summaryDate).toISOString().slice(0, 10) !== new Date(expected.date).toISOString().slice(0, 10) ||
      homeTeam === awayTeam) return [];

  const output = new Map<string, StatGame>();
  const categoriesByAthlete = new Map<string, Set<string>>();
  const teamBlocks: any[] = Array.isArray(data?.boxscore?.players) ? data.boxscore.players : [];
  for (const teamBlock of teamBlocks) {
    const team = appTeam(teamBlock?.team?.abbreviation ?? '');
    const opponent = team === homeTeam ? awayTeam : team === awayTeam ? homeTeam : '';
    if (!team || !opponent) continue;
    for (const group of Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : []) {
      const category = group?.name;
      if (!['passing', 'rushing', 'receiving', 'kickReturns', 'puntReturns'].includes(category)) continue;
      for (const entry of Array.isArray(group?.athletes) ? group.athletes : []) {
        const athlete = entry?.athlete;
        const id = typeof athlete?.id === 'string' ? athlete.id : '';
        if (!targetIds.has(id)) continue;
        const categories = categoriesByAthlete.get(id) ?? new Set<string>();
        categories.add(category);
        categoriesByAthlete.set(id, categories);
        const values = statValues({ keys: group.keys, stats: entry.stats });
        const current = output.get(id) ?? {
          name: athlete.displayName ?? athlete.fullName ?? id,
          pos: '',
          team,
          opp: opponent,
          season,
          week,
          gameId,
          playerId: `espn:${id}`,
          gameDate: new Date(expected.date).toISOString(),
          availableMarkets: [] as string[],
          v: {
            passing_yards: 0, passing_tds: 0, attempts: 0,
            carries: 0, rushing_yards: 0, receptions: 0,
            targets: 0, receiving_yards: 0, rushing_tds: 0,
            receiving_tds: 0, special_teams_tds: 0,
          },
        };
        if (category === 'passing') {
          if (values.passingYards != null) {
            current.v.passing_yards = values.passingYards;
            current.availableMarkets!.push('player_pass_yds');
          }
          if (values.passingTouchdowns != null) {
            current.v.passing_tds = values.passingTouchdowns;
            current.availableMarkets!.push('player_pass_tds');
          }
          current.v.attempts = values.attempts ?? current.v.attempts;
          for(const [key,field,market] of [['attempts','attempts','player_pass_attempts'],['completions','completions','player_pass_completions'],['interceptions','interceptions','player_pass_interceptions']])if(values[key]!=null){(current.v as Record<string,number>)[field]=values[key];current.availableMarkets!.push(market);}
        } else if (category === 'rushing') {
          if (values.rushingAttempts != null) {
            current.v.carries = values.rushingAttempts;
            current.availableMarkets!.push('player_rush_attempts');
          }
          if (values.rushingYards != null) {
            current.v.rushing_yards = values.rushingYards;
            current.availableMarkets!.push('player_rush_yds');
          }
          if(values.rushingTouchdowns!=null){current.v.rushing_tds=values.rushingTouchdowns;current.availableMarkets!.push('player_rush_tds');}
        } else if (category === 'receiving') {
          if (values.receptions != null) {
            current.v.receptions = values.receptions;
            current.availableMarkets!.push('player_receptions');
          }
          current.v.targets = values.receivingTargets ?? current.v.targets;
          if (values.receivingYards != null) {
            current.v.receiving_yards = values.receivingYards;
            current.availableMarkets!.push('player_reception_yds');
          }
          if(values.receivingTouchdowns!=null){current.v.receiving_tds=values.receivingTouchdowns;current.availableMarkets!.push('player_receiving_tds');}
        } else {
          current.v.special_teams_tds += category === 'kickReturns'
            ? values.kickReturnTouchdowns ?? 0
            : values.puntReturnTouchdowns ?? 0;
        }
        output.set(id, current);
      }
    }
  }
  for (const [id, game] of output) {
    const categories = categoriesByAthlete.get(id);
    if (categories?.has('rushing') && categories.has('receiving') && categories.has('kickReturns') && categories.has('puntReturns')) {
      game.availableMarkets!.push('player_anytime_td');
    }
    if(game.availableMarkets?.includes('player_pass_yds')&&game.availableMarkets.includes('player_rush_yds'))game.availableMarkets.push('player_pass_rush_yds');
    game.availableMarkets = [...new Set(game.availableMarkets)];
  }
  return [...output.values()];
}

/** Uses ESPN's free roster, player game-log, and box-score endpoints only when primary history cannot be matched. */
export async function loadEspnFallbackStats(
  requests: EspnPlayerLookup[],
  seasons: number[],
  f: typeof fetch = fetch,
  asOf = Date.now(),
): Promise<EspnHistoryResult> {
  const games = new Map<string, StatGame[]>();
  const teamByLookup = new Map<string, string>();
  const errors: string[] = [];
  if (!requests.length) return { games, teamByLookup, unmatched: 0, errors };

  const teamCodes = [...new Set(requests.flatMap((request) => request.teams.map((team) => team.toUpperCase())))];
  const rosters = await Promise.all(teamCodes.map(async (team) => {
    try {
      return [team, await fetchRoster(team, f)] as const;
    } catch (error) {
      errors.push(`${team}: ${error instanceof Error ? error.message : String(error)}`);
      return [team, []] as const;
    }
  }));
  const athletes = new Map<string, EspnAthlete>();
  for (const [, roster] of rosters) for (const athlete of roster) athletes.set(athlete.id, athlete);

  const byLookup = new Map<string, EspnAthlete>();
  let unmatched = 0;
  for (const request of requests) {
    const teams = new Set(request.teams.map(appTeam));
    const matches = [...athletes.values()].filter((athlete) =>
      teams.has(athlete.team) &&
      request.positions.includes(athlete.position) &&
      normName(athlete.name) === normName(request.name),
    );
    if (matches.length !== 1) {
      unmatched++;
      continue;
    }
    byLookup.set(request.key, matches[0]);
    teamByLookup.set(request.key, matches[0].team);
  }

  const uniqueAthletes = new Map([...byLookup.values()].map((athlete) => [athlete.id, athlete]));
  const logs = await Promise.all([...uniqueAthletes.values()].map(async (athlete) => {
    const results = await Promise.all(seasons.map(async (season) => {
      const url = `${WEB_BASE}/athletes/${athlete.id}/gamelog?${new URLSearchParams({
        region: 'us', lang: 'en', contentorigin: 'espn', season: String(season),
      })}`;
      try {
        const data = await fetchJson(url, `gamelog:${athlete.id}:${season}`, f);
        return regularSeasonEvents(data, season).filter((event: EspnEvent) => event.date < asOf);
      } catch (error) {
        errors.push(`${athlete.name} ${season}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }));
    return [athlete.id, results.flat().sort((a, b) => a.date - b.date).slice(-10)] as const;
  }));

  const targetIds = new Set(uniqueAthletes.keys());
  const eventsByAthlete = new Map<string, EspnEvent[]>();
  const eventDetails = new Map<string, EspnEvent>();
  for (const [athleteId, events] of logs) {
    eventsByAthlete.set(athleteId, events);
    for (const event of events) eventDetails.set(event.id, event);
    for (const [key, matched] of byLookup) {
      if (matched.id === athleteId) games.set(key, []);
    }
  }
  const eventIds = [...eventDetails.keys()];
  const summaries = new Map<string, StatGame[]>();
  for (let index = 0; index < eventIds.length; index += 5) {
    const batch = eventIds.slice(index, index + 5);
    const rows = await Promise.all(batch.map(async (eventId) => {
      const url = `${BASE}/summary?event=${encodeURIComponent(eventId)}`;
      try {
        const data = await fetchJson(url, `summary:${eventId}`, f);
        return [eventId, parseGameSummary(data, targetIds, eventDetails.get(eventId)!)] as const;
      } catch (error) {
        errors.push(`Game ${eventId}: ${error instanceof Error ? error.message : String(error)}`);
        return [eventId, [] as StatGame[]] as const;
      }
    }));
    for (const [eventId, result] of rows) summaries.set(eventId, result);
  }
  for (const [key, athlete] of byLookup) {
    const athleteGames: StatGame[] = [];
    for (const eventId of (eventsByAthlete.get(athlete.id) ?? []).map((event) => event.id)) {
      athleteGames.push(...(summaries.get(eventId) ?? []).filter((game) => game.playerId === `espn:${athlete.id}`));
    }
    for (const game of athleteGames) {
      game.name = athlete.name;
      game.pos = athlete.position;
    }
    games.set(key, athleteGames.sort((a, b) => a.season - b.season || a.week - b.week));
  }
  return { games, teamByLookup, unmatched, errors: [...new Set(errors)] };
}

/** Current roster/injury checks also apply to quarter-only research tickets. */
export async function verifyQuarterAvailability(
  candidates: import('../types.ts').FirstQuarterCandidate[],
  eventTeams: Map<string, string[]>,
  injuries: Map<string, string> | null,
  f: typeof fetch = fetch,
  report?:{currentSnapshotAt:string|null;coveredTeams:string[];now:number},
) {
  const requests = candidates.flatMap((candidate) => {
    const positions = Object.values(PROP_STATS).find(d=>quarterMarketName(d.market+'_q1')===candidate.market.replace(/^[234]Q|^[12]H/,'1Q'))?.positions??[];
    const teams = eventTeams.get(candidate.gameId) ?? [];
    return teams.flatMap((team) => positions.map((position) => ({
      key: `${candidate.id}|${team}|${position}`, name: candidate.player, position, team,
    })));
  });
  const roster = await verifyCurrentRoster(requests, f);
  const rejections:{player:string;gameId:string;market:string;reason:string}[]=[];
  const verified = candidates.flatMap((candidate) => {
    const matches = [...new Map(requests.filter((request) => request.key.startsWith(`${candidate.id}|`))
      .flatMap((request) => {
        const athlete = roster.players.get(request.key);
        return athlete ? [[athlete.id, athlete] as const] : [];
      })).values()];
    const reject=(reason:string)=>{rejections.push({player:candidate.player,gameId:candidate.gameId,market:candidate.market,reason});return [];};
    if(matches.length!==1)return reject('Current roster did not uniquely verify this player, event team and market position.');
    const athlete = matches[0];
    const injury = injuries?.get(`${appTeam(athlete.team)}|${normName(candidate.player)}`);
    if(!activeRoster(athlete.status)||UNAVAILABLE_STATUS.test(`${athlete.status??''} ${injury??''}`))return reject('Explicit Active roster or permitted injury status not verified (questionable/unavailable players excluded).');
    if(injury&&!/^(active|healthy|available|cleared|full participation|probable)$/i.test(injury.trim()))return reject('Listed injury status is unverified for automatic Q1 selection.');
    if(report){const stamp=Date.parse(report.currentSnapshotAt??'');if(!report.coveredTeams.includes(appTeam(athlete.team))||!(report.now-stamp>=-5*60000&&report.now-stamp<=24*3600_000))return reject('Current injury snapshot is missing, stale or does not cover this player’s team.');}
    if(candidate.team!=='Game'&&candidate.team&&appTeam(candidate.team)!==appTeam(athlete.team))return reject('Historical/quote team does not match the verified current roster team.');
    const teams = eventTeams.get(candidate.gameId) ?? [];
    return [{ ...candidate, position:athlete.position,team: athlete.team, opponent: teams.find((team) => appTeam(team) !== appTeam(athlete.team)) ?? candidate.opponent,
      espnPlayerId:athlete.id,rosterVerified:true,rosterStatus:athlete.status,injuryStatus:injury??'Not listed in checked team report; health not guaranteed',injurySnapshotAt:report?.currentSnapshotAt }];
  });
  return { candidates: verified, excluded: candidates.length - verified.length, errors: roster.errors,rejections };
}

/** Settle stored ESPN identities from final same-game boxscores, without requiring a current roster slot. */
export async function loadEspnSettlementStats(
  selections: { playerId: string; season: number; kickoffTs: number; eventId?: string }[], f: typeof fetch = fetch,
) {
  const games: StatGame[] = [], errors: string[] = [];
  const eventStates = new Map<string, string>();
  const ids = new Set(selections.map((selection) => selection.playerId).filter((id) => /^espn:\d+$/.test(id)));
  const targets = new Set([...ids].map((id) => id.slice(5)));
  const events = new Map<string, EspnEvent>();
  for (const selection of selections) {
    if (ids.has(selection.playerId) && selection.eventId && /^\d+$/.test(selection.eventId)) {
      events.set(selection.eventId, { id: selection.eventId, season: selection.season, date: selection.kickoffTs, week: 0 });
    }
  }
  for (const identity of new Set(selections.filter((s) => ids.has(s.playerId) && !s.eventId).map((s) => `${s.playerId}|${s.season}`))) {
    const [playerId, seasonText] = identity.split('|'), id = playerId.slice(5), season = Number(seasonText);
    try {
      const data = await fetchJson(`${WEB_BASE}/athletes/${id}/gamelog?season=${season}`, `gamelog:${id}:${season}`, f);
      for (const event of regularSeasonEvents(data, season) as EspnEvent[]) {
        if (selections.some((s) => s.playerId === playerId && s.season === season && !s.eventId && Math.abs(event.date - s.kickoffTs) <= 36 * 3600_000)) events.set(event.id, event);
      }
    } catch { errors.push(`ESPN final-result game log unavailable for ${playerId} season ${season}.`); }
  }
  for (const [id, event] of events) {
    try {
      const data = await fetchJson(`${BASE}/summary?event=${encodeURIComponent(id)}`, `final-summary:${id}`, f);
      const competition = data?.header?.competitions?.[0], status = competition?.status?.type;
      if (status?.completed !== true) {
        eventStates.set(id, /postpon|delay|cancel|suspend/i.test(`${status?.name ?? ''} ${status?.description ?? ''}`) ? 'postponed-or-cancelled' : 'game-not-final');
        continue;
      }
      if (data?.header?.season?.type != null && Number(data.header.season.type) !== 2) { eventStates.set(id, 'unsupported-season-type'); continue; }
      // A stored authoritative event ID follows rescheduling; the original forecast/kickoff is never rewritten.
      const direct = selections.some((selection) => selection.eventId === id);
      const expected = direct ? { ...event, date: Date.parse(competition.date), week: Number(data?.header?.week?.number ?? data?.header?.week) } : event;
      const parsed = parseGameSummary(data, targets, expected).map((game) => ({ ...game, kickoffTs: Date.parse(competition.date), completed: true }));
      // Void eligibility requires an explicit final-boxscore DNP flag, never an absent row or zero yards.
      if(String(data.header?.id??competition?.id)===expected.id && Number(data.header?.season?.year)===expected.season && Number.isFinite(Date.parse(competition?.date))) {
        for(const block of data?.boxscore?.players??[]) for(const group of block.statistics??[]) for(const entry of group.athletes??[]) {
          const athlete=entry.athlete,playerId=athlete?.id,team=appTeam(block.team?.abbreviation??'');
          const opponents=competition.competitors?.map((c:any)=>appTeam(c.team?.abbreviation??''))??[];
          if(entry.didNotPlay!==true || !targets.has(playerId) || !opponents.includes(team) || opponents.length!==2)continue;
          const existing=parsed.find(g=>g.playerId===`espn:${playerId}`);
          if(existing){if(Object.values(existing.v).some(v=>v>0))existing.participationConflict=true;else existing.nonParticipationVerified=true;}
          else parsed.push({name:athlete.displayName??athlete.fullName,pos:athlete.position?.abbreviation??'',playerId:`espn:${playerId}`,team,opp:opponents.find((t:string)=>t!==team),season:expected.season,week:expected.week,gameId:expected.id,gameDate:new Date(expected.date).toISOString(),kickoffTs:Date.parse(competition.date),completed:true,nonParticipationVerified:true,availableMarkets:[],v:{}});
        }
      }
      games.push(...parsed);
      eventStates.set(id, parsed.length ? 'final' : 'missing-player-result');
    } catch { errors.push(`ESPN final boxscore unavailable for game ${id}.`); eventStates.set(id, 'provider-unavailable'); }
  }
  return { games, errors, eventStates };
}

export type RosterIdentity={verified:boolean;playerId:string|null;name:string|null;team:string|null;position:string|null;status:string|null;checkedAt:string;reason:string;matches:{id:string;name:string;team:string;position:string;status?:string}[]};
/** Resolve current identity independently of prop/stat support and availability. Never infer position from a market. */
export async function resolveRosterIdentities(requests:{key:string;name:string;teams:string[]}[],f:typeof fetch=fetch,now=Date.now()){
 const teams=[...new Set(requests.flatMap(r=>r.teams.map(appTeam)))],rosters=new Map<string,EspnAthlete[]>(),failed=new Set<string>();
 await Promise.all(teams.map(async team=>{try{const athletes=await fetchRoster(team,f);if(athletes.some(a=>appTeam(a.team)!==team))throw new Error('Roster response team mismatch');rosters.set(team,athletes);}catch{failed.add(team);}}));
 const output=new Map<string,RosterIdentity>();
 for(const r of requests){
  const eventTeams=[...new Set(r.teams.map(appTeam))];
  const matches=eventTeams.flatMap(t=>rosters.get(t)??[]).filter(a=>normName(a.name)===normName(r.name)&&['QB','RB','WR','TE'].includes(a.position));
  const unique=[...new Map(matches.map(a=>[JSON.stringify([a.id,a.team,a.position,a.status]),a])).values()];
  const current=unique.filter(a=>/\bactive\b/i.test(a.status??'')&&!/inactive|reserve|practice|released|traded|suspend/i.test(a.status??''));
  const ids=new Set(unique.map(a=>a.id));
  // A single active record may supersede an explicitly inactive old-team record for the same ESPN ID.
  const selected=ids.size===1&&current.length===1?current[0]:unique.length===1?unique[0]:null;
  const complete=eventTeams.length===2&&!eventTeams.some(t=>failed.has(t));
  const verified=complete&&!!selected;
  output.set(r.key,{verified,playerId:verified?selected!.id:null,name:verified?selected!.name:null,team:verified?selected!.team:null,position:verified?selected!.position:null,status:verified?selected!.status??null:null,checkedAt:new Date(now).toISOString(),reason:!eventTeams.length?'Verified game teams unavailable; no roster team assumed.':!complete?'Roster provider failed or game teams are incomplete; unique identity cannot be established.':ids.size>1||unique.length>1&&!selected?'Ambiguous roster identity or conflicting team/position records.':!selected?'No unique current NFL roster record matched this player.':'Unique ESPN roster identity; availability is checked separately.',matches:unique});
 }
 return output;
}
