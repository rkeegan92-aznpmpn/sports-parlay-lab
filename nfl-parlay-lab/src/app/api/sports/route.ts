import {NextResponse} from 'next/server';
import {listSports} from '@/lib/sports/registry.ts';
import {allRiskChoices} from '@/lib/riskPresets.ts';
import {DEFAULT_PAPER_STAKE_CENTS,MIN_PAPER_STAKE_CENTS,MAX_PAPER_STAKE_CENTS} from '@/lib/stake.ts';
export const dynamic='force-dynamic';
/** Static capability listing. Makes no provider request and exposes no credentials. */
export async function GET(){return NextResponse.json({sports:listSports(),riskChoices:allRiskChoices(),paperStake:{defaultCents:DEFAULT_PAPER_STAKE_CENTS,minCents:MIN_PAPER_STAKE_CENTS,maxCents:MAX_PAPER_STAKE_CENTS}},{headers:{'Cache-Control':'no-store'}});}
