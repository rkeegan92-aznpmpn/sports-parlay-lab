// Synthetic Q1 play-by-play used only by isolated tests.
export const quarterCsv=(year=2026)=>{
 const head='game_id,season,week,season_type,qtr,home_team,away_team,total_home_score,total_away_score,pass_attempt,complete_pass,passer_player_id,receiver_player_id,rush_attempt,rusher_player_id,yards_gained';
 if(year!==2026)return head;
 return [head,...Array.from({length:6},(_,i)=>{
  const prefix=`2026_${String(i+1).padStart(2,'0')}_BUF_MIN,2026,${i+1},REG,1,MIN,BUF,0,0`,yards=i%2?30:10;
  return [`${prefix},1,1,id-QB One,,0,,${yards}`,`${prefix},1,1,,id-WR One,0,,${yards}`,`${prefix},0,0,,,1,id-RB One,${yards}`].join('\n');
 })].join('\n');
};
