export const PAPER_START_CENTS=100000,PAPER_STAKE_CENTS=1000;
export const PAPER_STRATEGIES=['Safer','Balanced','Aggressive','Long Shot'] as const;
export type PaperStrategy=typeof PAPER_STRATEGIES[number];
export type PaperOutcome='pending'|'win'|'loss'|'push'|'void'|'push-adjusted-win';
export const paperColor=(status:string)=>status==='win'||status==='push-adjusted-win'?'green':status==='loss'?'red':status==='push'||status==='void'?'gray':'yellow';
export const paperLabel=(status:string)=>status==='push-adjusted-win'?'Win (push/void adjusted)':status==='win'?'Win':status==='loss'?'Loss':status==='push'?'Push':status==='void'?'Void':'Pending';
