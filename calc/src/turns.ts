import type {Generation} from './data/interface';
import type {Field, Side} from './field';
import type {Move} from './move';
import type {Pokemon} from './pokemon';
import {calculate} from './calc';
import {combine, getEndOfTurn, getHazards} from './desc';

/** Boolean Side flags that can run out (screens, Tailwind, Leech Seed, ...). */
export type TimedSideFlag = {
  [K in keyof Side]-?: Side[K] extends boolean | undefined ? K : never
}[keyof Side];
/** Field effects that can run out. */
export type TimedFieldEffect = 'weather' | 'terrain' | 'isGravity' | 'isMagicRoom' | 'isWonderRoom';

export interface KOChanceByTurnOptions {
  /**
   * Turns each effect has left, counting the current turn (1 = ends after this turn).
   * Effects not listed are treated as permanent, as in the rest of the calc.
   */
  turnsLeft?: {[K in TimedFieldEffect]?: number} & {
    attackerSide?: {[K in TimedSideFlag]?: number};
    defenderSide?: {[K in TimedSideFlag]?: number};
  };
  /** The defender switches in first and takes the defender side's entry hazards. Default false. */
  entryHazards?: boolean;
  /**
   * Which turn (1 = the current one) the first hit lands on: effect timers are
   * shifted by this, e.g. 2 when the attacker spends this turn switching in.
   */
  firstTurn?: number;
  /** How many hits to look ahead. Default 10. */
  maxTurns?: number;
}

export interface KOChanceByTurn {
  /** chances[i] = probability the defender has fainted after hit i + 1 and its end of turn. */
  chances: number[];
  hazards: {damage: number; texts: string[]};
  /** End-of-turn effects on the first turn, e.g. ['Leftovers recovery']. */
  endOfTurn: string[];
}

/**
 * Probability of a KO by each turn when `attacker` uses `move` every turn, tracking the
 * defender's whole HP distribution: every damage roll, end-of-turn damage and healing
 * (capped at max HP), Toxic's growing damage, and field effects that run out. Crits and
 * misses are not included, as in `kochance()`. The defender's HP-dependent effects
 * (e.g. a Sitrus Berry) are not re-evaluated as its HP changes.
 */
export function getKOChanceByTurn(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  options: KOChanceByTurnOptions = {}
): KOChanceByTurn {
  const maxTurns = options.maxTurns ?? 10;
  const firstTurn = options.firstTurn ?? 1;
  const turnsLeft = options.turnsLeft ?? {};
  const maxHP = defender.maxHP();

  const hazards = options.entryHazards
    ? getHazards(gen, defender, field.defenderSide)
    : {damage: 0, texts: [] as string[]};

  // Field as it will be on a given turn: effects past their last turn are switched off.
  const fieldOn = (turn: number) => {
    const f = field.clone();
    const over = (left?: number) => left !== undefined && turn > left;
    if (over(turnsLeft.weather)) f.weather = undefined;
    if (over(turnsLeft.terrain)) f.terrain = undefined;
    if (over(turnsLeft.isGravity)) f.isGravity = false;
    if (over(turnsLeft.isMagicRoom)) f.isMagicRoom = false;
    if (over(turnsLeft.isWonderRoom)) f.isWonderRoom = false;
    const sides = [['attackerSide', f.attackerSide], ['defenderSide', f.defenderSide]] as const;
    for (const [key, side] of sides) {
      for (const [flag, left] of Object.entries(turnsLeft[key] ?? {})) {
        if (over(left)) (side as any)[flag] = false;
      }
    }
    return f;
  };

  // Damage rolls and end-of-turn change only depend on which effects are still up.
  const perTurn = new Map<string, {rolls: number[]; eot: number; texts: string[]}>();
  const turnData = (turn: number) => {
    const f = fieldOn(turn);
    const key = JSON.stringify(f);
    let data = perTurn.get(key);
    if (!data) {
      const result = calculate(gen, attacker.clone(), defender.clone(), move.clone(), f);
      const [rolls] = combine(result.damage);
      const eot = getEndOfTurn(gen, attacker, defender, move, f);
      data = {rolls, eot: eot.damage, texts: eot.texts};
      perTurn.set(key, data);
    }
    return data;
  };

  let toxicCounter = defender.hasStatus('tox') && !defender.hasAbility('Magic Guard', 'Poison Heal')
    ? Math.max(defender.toxicCounter, 1) : 0;

  const chances: number[] = [];
  let hp = new Map<number, number>();
  const start = defender.curHP() - hazards.damage;
  if (start > 0) hp.set(start, 1);

  for (let i = 0; i < maxTurns; i++) {
    const {rolls, eot} = turnData(firstTurn + i);
    const toxic = toxicCounter ? Math.floor((Math.min(toxicCounter, 15) * maxHP) / 16) : 0;
    const next = new Map<number, number>();
    const weight = 1 / rolls.length;
    for (const [current, p] of hp) {
      for (const roll of rolls) {
        let left = current - roll;
        // Healing applies before Toxic and can't exceed max HP.
        if (left > 0) left = Math.min(maxHP, left + eot) - toxic;
        if (left > 0) next.set(left, (next.get(left) ?? 0) + p * weight);
      }
    }
    hp = next;
    if (toxicCounter) toxicCounter++;
    // 1 - surviving mass, so a certain KO is exactly 1 despite rounding.
    let survives = 0;
    for (const p of hp.values()) survives += p;
    chances.push(hp.size ? Math.max(0, 1 - survives) : 1);
  }
  return {chances, hazards, endOfTurn: turnData(firstTurn).texts};
}
