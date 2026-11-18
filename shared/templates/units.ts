/**
 * The fixed, short unit list. One line per unit: symbol, kind, factor to the kind's base unit
 * (and an offset for temperatures). Only units of the same kind convert. A new unit is one line.
 *
 * Deliberately NOT inter-convertible (different kinds): % RH and g/kg; IU, CFU and activity
 * units (U) with each other or with any mass; % w/w and % w/v (that needs a density).
 */
import { Dec } from './dec.js';
import { refuse } from './refuse.js';

export type Kind =
  | 'number' | 'count' | 'mass' | 'volume' | 'length' | 'area' | 'time'
  | 'temperature' | 'temperature difference' | 'force' | 'pressure'
  | 'fraction' | 'mass concentration' | 'density' | 'rotation speed' | 'angle' | 'mass per area' | 'Strong-Cobb hardness'
  | 'mass rate' | 'volume rate' | 'count rate' | 'current' | 'power' | 'specific energy'
  | 'relative humidity' | 'absolute humidity' | 'absolute humidity per volume' | 'log' | 'frequency' | 'rpm per Hz' | 'charge'
  | 'IU' | 'CFU' | 'activity units' | 'IU per mass' | 'CFU per mass' | 'activity units per mass' | 'mass per IU';

export interface Unit {
  readonly symbol: string;
  readonly kind: Kind;
  /** value in base unit = value × factor + offset */
  readonly factor: Dec;
  readonly offset: Dec;
}

const d = (x: string | number): Dec => new Dec(x);
const PSI = d('0.45359237').times('9.80665').div(d('0.0254').pow(2)); // lbf/in², exact by definition
const TWO_PI = Dec.acos(-1).times(2);
const US_GALLON = d('3785.411784'); // mL, exact (231 in³)
const CFM = d('28316.846592').times(60); // mL/h: 1 ft³ = 28 316.846592 mL exactly

// symbol, kind, factor (to base), offset — base unit of each kind is the one with factor 1.
const TABLE: [string, Kind, Dec | string, string?][] = [
  ['', 'number', '1'],
  ['units', 'count', '1'], ['tablets', 'count', '1'], ['packs', 'count', '1'], ['nos', 'count', '1'], // nos: pieces, as master data counts them
  ['µg', 'mass', '0.000001'], ['mg', 'mass', '0.001'], ['g', 'mass', '1'], ['kg', 'mass', '1000'],
  ['mm³', 'volume', '0.001'], ['µL', 'volume', '0.001'], ['mL', 'volume', '1'], ['L', 'volume', '1000'], ['m³', 'volume', '1000000'],
  ['US gal', 'volume', US_GALLON], ['imp gal', 'volume', '4546.09'], // an imperial gallon is 20 % larger
  ['µm', 'length', '0.001'], ['mm', 'length', '1'], ['cm', 'length', '10'], ['m', 'length', '1000'],
  ['mm²', 'area', '1'], ['cm²', 'area', '100'],
  ['s', 'time', '1'], ['min', 'time', '60'], ['h', 'time', '3600'], ['d', 'time', '86400'],
  ['°C', 'temperature', '1', '0'], ['K', 'temperature', '1', '-273.15'],
  ['°F', 'temperature', d(5).div(9), d(-160).div(9).toString()], // °C = (°F − 32) × 5/9
  ['Δ°C', 'temperature difference', '1'], ['ΔK', 'temperature difference', '1'], ['Δ°F', 'temperature difference', d(5).div(9)],
  ['N', 'force', '1'], ['kN', 'force', '1000'], ['kp', 'force', '9.80665'], ['kgf', 'force', '9.80665'], // 1 kp = 1 kgf = 9.80665 N exactly
  ['Pa', 'pressure', '1'], ['hPa', 'pressure', '100'], ['kPa', 'pressure', '1000'], ['MPa', 'pressure', '1000000'],
  ['N/mm²', 'pressure', '1000000'], ['bar', 'pressure', '100000'], ['mbar', 'pressure', '100'], ['psi', 'pressure', PSI],
  ['mmHg', 'pressure', '133.322387415'], ['atm', 'pressure', '101325'],
  ['kgf/cm²', 'pressure', '98066.5'], ['kN/cm²', 'pressure', '10000000'],
  ['%', 'fraction', '1'], ['%w/w', 'fraction', '1'], ['ppm', 'fraction', '0.0001'],
  ['µg/mg', 'fraction', '0.1'], ['mg/g', 'fraction', '0.1'], // potency per mass of material: 1000 µg/mg = 100 %
  ['%w/v', 'mass concentration', '10'], ['mg/mL', 'mass concentration', '1'], ['g/L', 'mass concentration', '1'],
  ['g/mL', 'density', '1'], ['g/cm³', 'density', '1'], ['kg/L', 'density', '1'], ['kg/m³', 'density', '0.001'],
  ['rpm', 'rotation speed', '1'], ['rad/min', 'rotation speed', d(1).div(TWO_PI)], // 1 rpm = 2π rad/min
  ['°', 'angle', '1'],
  ['mg/cm²', 'mass per area', '1'], ['g/m²', 'mass per area', '0.1'], // 1 g/m² = 1000 mg ÷ 10000 cm²
  // Strong-Cobb units (old hardness testers). Published conversions disagree (both "1 SCU ≈ 0.7 kp" and
  // "1 SCU ≈ 1.4 kp" are found) and none is a definition, so SCU is its own kind and never converts.
  ['SCU', 'Strong-Cobb hardness', '1'],
  ['g/h', 'mass rate', '1'], ['g/min', 'mass rate', '60'], ['kg/h', 'mass rate', '1000'], ['g/s', 'mass rate', '3600'],
  ['mL/h', 'volume rate', '1'], ['mL/min', 'volume rate', '60'], ['L/h', 'volume rate', '1000'], ['L/min', 'volume rate', '60000'], ['m³/h', 'volume rate', '1000000'], ['cfm', 'volume rate', CFM],
  ['units/h', 'count rate', '1'], ['units/min', 'count rate', '60'], ['tablets/h', 'count rate', '1'], ['tablets/min', 'count rate', '60'],
  ['mA', 'current', '0.001'], ['A', 'current', '1'],
  ['W', 'power', '1'], ['kW', 'power', '1000'],
  ['kJ/kg', 'specific energy', '1'], ['kWh/kg', 'specific energy', '3600'],
  ['%RH', 'relative humidity', '1'],
  ['g/kg', 'absolute humidity', '1'], // g water per kg dry air
  ['g/m³', 'absolute humidity per volume', '1'], // g water per m³ of air (T25)
  // A drive frequency: it becomes rpm only through the factor (rpm per Hz) from the equipment record (T8 product).
  ['Hz', 'frequency', '1'], ['rpm/Hz', 'rpm per Hz', '1'],
  // Milliequivalents of an ion: mmol = mEq ÷ the ion's charge, from the material record (T11).
  ['mEq', 'charge', '1'],
  ['log', 'log', '1'],
  ['IU', 'IU', '1'], ['CFU', 'CFU', '1'], ['U', 'activity units', '1'],
  ['IU/g', 'IU per mass', '1'], ['IU/mg', 'IU per mass', '1000'],
  ['CFU/g', 'CFU per mass', '1'], ['CFU/mg', 'CFU per mass', '1000'],
  ['U/g', 'activity units per mass', '1'], ['U/mg', 'activity units per mass', '1000'],
  ['mg/IU', 'mass per IU', '1'],
];

/** Other spellings people type. */
const ALIASES: Record<string, string> = {
  ug: 'µg', 'mcg/mg': 'µg/mg', 'ug/mg': 'µg/mg', mcg: 'µg', μg: 'µg', ml: 'mL', l: 'L', uL: 'µL', μL: 'µL', 'cm3': 'mL', 'cm³': 'mL', mm3: 'mm³', deg: '°', 'mg/cm2': 'mg/cm²', 'g/m2': 'g/m²', um: 'µm', μm: 'µm',
  mm2: 'mm²', cm2: 'cm²', sec: 's', hr: 'h', degC: '°C', degF: '°F', kP: 'kp', Kp: 'kp',
  '% w/w': '%w/w', '% w/v': '%w/v', '% RH': '%RH', RH: '%RH', cfu: 'CFU', 'cfu/g': 'CFU/g', 'cfu/mg': 'CFU/mg',
  'kg/cm²': 'kgf/cm²', 'N/mm2': 'N/mm²', 'g/m3': 'g/m³', 'ft³/min': 'cfm', 'ft3/min': 'cfm', meq: 'mEq', mEQ: 'mEq', 'US gallon': 'US gal', 'imperial gallon': 'imp gal', 'kg/cm2': 'kgf/cm²', 'g/cm3': 'g/cm³', 'm3/h': 'm³/h', tablet: 'tablets', unit: 'units', pack: 'packs', no: 'nos', 'nos.': 'nos',
};

/** Every unit symbol with its kind, in table order (the designer's unit pick lists). */
export const UNIT_LIST: readonly { symbol: string; kind: Kind }[] = TABLE.map(([symbol, kind]) => ({ symbol, kind }));

const UNITS = new Map<string, Unit>(TABLE.map(([symbol, kind, factor, offset]) => [symbol, { symbol, kind, factor: d(factor.toString()), offset: d(offset ?? '0') }]));

export function findUnit(symbol: string): Unit | undefined {
  const s = symbol.trim();
  const alias = ALIASES[s];
  return UNITS.get(s) ?? (alias === undefined ? undefined : UNITS.get(alias));
}

const POTENCY: Kind[] = ['IU', 'CFU', 'activity units'];

/** Why two units cannot convert, in plain words; undefined when they can. */
export function whyNot(from: Unit, to: Unit): string | undefined {
  if (from.kind === to.kind) return undefined;
  if (from.kind === 'temperature difference' && to.kind === 'temperature') return undefined; // limit written as °C on a difference
  if (POTENCY.includes(from.kind) || POTENCY.includes(to.kind)) {
    return `${from.symbol || 'a plain number'} cannot be turned into ${to.symbol || 'a plain number'}: a potency in IU, CFU or activity units is never a mass or any other unit; use the lot's content (for example IU/g) in the content-adjusted quantity`;
  }
  if ((from.kind === 'relative humidity' && to.kind === 'absolute humidity') || (from.kind === 'absolute humidity' && to.kind === 'relative humidity')) {
    return '% RH and g/kg cannot be converted into each other directly; use the absolute humidity template (T25) with the temperature';
  }
  if (from.kind === 'frequency' || to.kind === 'frequency') {
    return 'Hz is a drive frequency: it becomes rpm only through the factor (rpm per Hz) from the equipment record (T8 product: Hz × rpm/Hz)';
  }
  if (from.kind.startsWith('absolute humidity') && to.kind.startsWith('absolute humidity')) {
    return 'g/kg (per kg of dry air) and g/m³ (per m³ of air) cannot be converted into each other directly; use T25 with the temperature';
  }
  if (from.kind === 'Strong-Cobb hardness' || to.kind === 'Strong-Cobb hardness') {
    return 'Strong-Cobb units (SCU) are not converted: published conversions to kp disagree and none is a definition. Record hardness in N or kp, or keep the limit in SCU';
  }
  if (from.kind === 'temperature' && to.kind === 'temperature difference') {
    return `${from.symbol} is a temperature reading, ${to.symbol} is a temperature difference`;
  }
  return `${from.symbol || 'a plain number'} (${from.kind}) cannot be converted to ${to.symbol || 'a plain number'} (${to.kind})`;
}

/**
 * Converts a value between two units of the same kind. Temperatures use their offsets.
 * A temperature difference compared with a limit written in °C/°F/K uses the matching difference unit.
 */
export function convert(value: Dec, from: Unit, to: Unit): Dec {
  if (from.symbol === to.symbol) return value;
  const reason = whyNot(from, to);
  if (reason !== undefined) refuse(reason);
  if (from.kind === 'temperature difference' && to.kind === 'temperature') {
    const target = UNITS.get(to.symbol === 'K' ? 'ΔK' : `Δ${to.symbol}`);
    if (target === undefined) throw new Error(`no difference unit for ${to.symbol}`);
    return value.times(from.factor).div(target.factor);
  }
  return value.times(from.factor).plus(from.offset).minus(to.offset).div(to.factor);
}

/** The difference unit that matches a temperature unit (°C -> Δ°C). */
export function differenceUnitOf(u: Unit): Unit {
  if (u.kind !== 'temperature') return u;
  const r = UNITS.get(u.symbol === 'K' ? 'ΔK' : `Δ${u.symbol}`);
  if (r === undefined) throw new Error(`no difference unit for ${u.symbol}`);
  return r;
}

export function unit(symbol: string): Unit {
  const u = findUnit(symbol);
  if (u === undefined) throw new Error(`unknown unit "${symbol}"`);
  return u;
}
