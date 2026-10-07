import { percentOf, toPaise, toRupees } from '../lib/money.js';
import { getSetting } from './settings.service.js';

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiFees: number;
  stampDuty: number;
  gst: number;
  total: number;
}

/** Brokerage and statutory charges for a delivery trade of the given value (all in paise). */
export function calculateCharges(side: 'BUY' | 'SELL', value: number): ChargeBreakdown {
  const rates = getSetting('charges');
  const brokerage = Math.min(percentOf(value, rates.brokeragePct), toPaise(rates.brokerageMax));
  const stt = percentOf(value, rates.sttPct);
  const exchangeCharges = percentOf(value, rates.exchangePct);
  const sebiFees = Math.round((value * rates.sebiPerCrore) / 1e7);
  const stampDuty = side === 'BUY' ? percentOf(value, rates.stampDutyPct) : 0;
  const gst = percentOf(brokerage + exchangeCharges + sebiFees, rates.gstPct);
  return {
    brokerage,
    stt,
    exchangeCharges,
    sebiFees,
    stampDuty,
    gst,
    total: brokerage + stt + exchangeCharges + sebiFees + stampDuty + gst,
  };
}

export function chargesToRupees(charges: ChargeBreakdown): Record<keyof ChargeBreakdown, number> {
  return {
    brokerage: toRupees(charges.brokerage),
    stt: toRupees(charges.stt),
    exchangeCharges: toRupees(charges.exchangeCharges),
    sebiFees: toRupees(charges.sebiFees),
    stampDuty: toRupees(charges.stampDuty),
    gst: toRupees(charges.gst),
    total: toRupees(charges.total),
  };
}
