/* eslint-disable max-len */
/* eslint-env jest */

import {koChanceByTurn} from '../index';
import {inGen} from './helper';

describe('koChanceByTurn', () => {
  inGen(9, ({gen, calculate, Pokemon, Move, Field, Side}) => {
    const chances = (...args: Parameters<typeof koChanceByTurn> extends [any, ...infer R] ? R : never) =>
      koChanceByTurn(gen, ...args).chances;

    test('agrees with kochance() when nothing changes between turns', () => {
      const cases = [
        [Pokemon('Arceus', {item: 'Meadow Plate'}), Pokemon('Blastoise'), Move('Judgment')],
        [Pokemon('Garchomp', {evs: {atk: 252}}), Pokemon('Blissey'), Move('Earthquake')],
        [Pokemon('Gholdengo', {evs: {spa: 252}}), Pokemon('Corviknight', {evs: {hp: 252}}), Move('Make It Rain')],
      ] as const;
      for (const [attacker, defender, move] of cases) {
        const ko = calculate(attacker, defender, move, Field()).kochance();
        const byTurn = chances(attacker, defender, move, Field());
        expect(byTurn[ko.n - 2] ?? 0).toBe(0);
        expect(byTurn[ko.n - 1]).toBeCloseTo(ko.chance!, 6);
      }
    });

    test('a guaranteed KO is exactly 1', () => {
      const byTurn = chances(Pokemon('Garchomp'), Pokemon('Heatran'), Move('Earthquake'), Field());
      expect(byTurn[0]).toBe(1);
    });

    test('Leftovers slows the KO, and healing never exceeds max HP', () => {
      const attacker = Pokemon('Garchomp', {evs: {atk: 252}});
      const plain = chances(attacker, Pokemon('Corviknight'), Move('Dragon Claw'), Field());
      const lefties = chances(attacker, Pokemon('Corviknight', {item: 'Leftovers'}), Move('Dragon Claw'), Field());
      expect(plain.findIndex(c => c === 1)).toBeGreaterThan(0);
      expect(lefties.findIndex(c => c === 1)).toBeGreaterThan(plain.findIndex(c => c === 1));
      // Max-roll Tackle from a level 1 Magikarp is less than Leftovers heals: never a KO.
      const weak = chances(Pokemon('Magikarp', {level: 1}), Pokemon('Snorlax', {item: 'Leftovers'}), Move('Tackle'), Field());
      expect(weak.every(c => c === 0)).toBe(true);
    });

    test('Toxic damage grows each turn', () => {
      const tox = Pokemon('Snorlax', {status: 'tox', toxicCounter: 1});
      const attacker = Pokemon('Magikarp', {level: 1});
      const byTurn = chances(attacker, tox, Move('Tackle'), Field(), {maxTurns: 16});
      // 1/16 + 2/16 + ... is 15/16 after 5 turns and over 16/16 after 6; Tackle's chip is tiny.
      expect(byTurn[4]).toBe(0);
      expect(byTurn[5]).toBe(1);
    });

    test('a screen that runs out stops reducing damage', () => {
      const attacker = Pokemon('Garchomp', {evs: {atk: 252}});
      const defender = Pokemon('Blissey', {evs: {hp: 252}});
      const reflect = Field({defenderSide: Side({isReflect: true})});
      const always = chances(attacker, defender, Move('Earthquake'), reflect);
      const oneTurn = chances(attacker, defender, Move('Earthquake'), reflect, {turnsLeft: {defenderSide: {isReflect: 1}}});
      const never = chances(attacker, defender, Move('Earthquake'), Field());
      expect(oneTurn[0]).toBe(always[0]);
      expect(oneTurn.findIndex(c => c === 1)).toBeLessThan(always.findIndex(c => c === 1));
      expect(oneTurn.findIndex(c => c === 1)).toBeGreaterThanOrEqual(never.findIndex(c => c === 1));
      // Starting a turn later, the screen is already gone.
      const later = chances(attacker, defender, Move('Earthquake'), reflect, {turnsLeft: {defenderSide: {isReflect: 1}}, firstTurn: 2});
      expect(later).toEqual(never);
    });

    test('entry hazards come off once, before the first hit', () => {
      const zard = Pokemon('Charizard');
      const sr = Field({defenderSide: Side({isSR: true})});
      const result = koChanceByTurn(gen, Pokemon('Snorlax'), zard, Move('Body Slam'), sr, {entryHazards: true});
      expect(result.hazards.damage).toBe(Math.floor(zard.maxHP() / 2));
      expect(result.hazards.texts).toEqual(['Stealth Rock']);
      const without = chances(Pokemon('Snorlax'), zard, Move('Body Slam'), sr);
      expect(result.chances.findIndex(c => c === 1)).toBeLessThan(without.findIndex(c => c === 1));
    });
  });
});
