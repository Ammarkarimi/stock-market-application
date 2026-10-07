/**
 * Fictional IPOs used to demonstrate the full lifecycle. Schedules are weekday offsets from the day the
 * database is seeded, so a fresh install always has upcoming, open, closed, allotted and listed issues.
 */
export interface IpoSeed {
  companyName: string;
  symbol: string;
  issueType: 'MAINBOARD' | 'SME';
  sector: string;
  industry: string;
  description: string;
  priceBand: [number, number];
  lotSize: number;
  maxLots: number;
  issueSizeCr: number;
  freshIssueCr: number;
  ofsCr: number;
  schedule: { open: number; close: number; allotment: number; listing: number };
  /** Final subscription (times) per category. */
  demand: { retail: number; nii: number; qib: number };
  registrar: string;
  leadManagers: string[];
  financials: { year: string; revenueCr: number; profitCr: number; assetsCr: number }[];
  /** For issues that are already listed: the price the stock trades at today. */
  currentPrice?: number;
}

export const IPOS: IpoSeed[] = [
  {
    companyName: 'Zenith Renewables Ltd',
    symbol: 'ZENITHRE',
    issueType: 'MAINBOARD',
    sector: 'Utilities',
    industry: 'Renewable Energy',
    description:
      'Independent power producer developing and operating utility-scale solar and wind projects across Rajasthan, Gujarat and Karnataka, with 3.2 GW of contracted capacity.',
    priceBand: [268, 282],
    lotSize: 53,
    maxLots: 13,
    issueSizeCr: 1250,
    freshIssueCr: 900,
    ofsCr: 350,
    schedule: { open: 4, close: 6, allotment: 7, listing: 9 },
    demand: { retail: 6.5, nii: 14.2, qib: 38.4 },
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['Kotak Mahindra Capital', 'Axis Capital', 'JM Financial'],
    financials: [
      { year: 'FY24', revenueCr: 1180, profitCr: 142, assetsCr: 9800 },
      { year: 'FY25', revenueCr: 1560, profitCr: 205, assetsCr: 12450 },
      { year: 'FY26', revenueCr: 2045, profitCr: 288, assetsCr: 15100 },
    ],
  },
  {
    companyName: 'Aarav Fintech Ltd',
    symbol: 'AARAVFIN',
    issueType: 'MAINBOARD',
    sector: 'Financial Services',
    industry: 'Digital Payments & Lending',
    description:
      'Digital financial services platform offering merchant payments, small-business credit and insurance distribution to over 9 million merchants.',
    priceBand: [412, 434],
    lotSize: 34,
    maxLots: 13,
    issueSizeCr: 860,
    freshIssueCr: 600,
    ofsCr: 260,
    schedule: { open: 8, close: 10, allotment: 11, listing: 13 },
    demand: { retail: 4.2, nii: 9.5, qib: 21.3 },
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['ICICI Securities', 'Goldman Sachs (India) Securities'],
    financials: [
      { year: 'FY24', revenueCr: 640, profitCr: -38, assetsCr: 2100 },
      { year: 'FY25', revenueCr: 910, profitCr: 24, assetsCr: 2780 },
      { year: 'FY26', revenueCr: 1235, profitCr: 96, assetsCr: 3540 },
    ],
  },
  {
    companyName: 'Nimbus Cloud Technologies Ltd',
    symbol: 'NIMBUS',
    issueType: 'MAINBOARD',
    sector: 'Information Technology',
    industry: 'Cloud & Data Centre Services',
    description:
      'Provider of managed cloud, colocation and AI-ready data centre capacity with facilities in Mumbai, Chennai and Hyderabad.',
    priceBand: [520, 548],
    lotSize: 27,
    maxLots: 13,
    issueSizeCr: 2100,
    freshIssueCr: 1500,
    ofsCr: 600,
    schedule: { open: -1, close: 1, allotment: 2, listing: 4 },
    demand: { retail: 18.4, nii: 46.2, qib: 112.5 },
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['Morgan Stanley India', 'Kotak Mahindra Capital', 'HDFC Bank'],
    financials: [
      { year: 'FY24', revenueCr: 1420, profitCr: 168, assetsCr: 5200 },
      { year: 'FY25', revenueCr: 1985, profitCr: 251, assetsCr: 7150 },
      { year: 'FY26', revenueCr: 2710, profitCr: 362, assetsCr: 9400 },
    ],
  },
  {
    companyName: 'Saffron Foods Ltd',
    symbol: 'SAFFRON',
    issueType: 'MAINBOARD',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Packaged Foods',
    description:
      'Maker of ready-to-cook spice blends, snacks and frozen foods sold through 4 lakh retail outlets and quick-commerce platforms.',
    priceBand: [180, 190],
    lotSize: 78,
    maxLots: 13,
    issueSizeCr: 540,
    freshIssueCr: 540,
    ofsCr: 0,
    schedule: { open: 0, close: 2, allotment: 3, listing: 5 },
    demand: { retail: 3.1, nii: 5.8, qib: 11.2 },
    registrar: 'Bigshare Services Pvt Ltd',
    leadManagers: ['IIFL Securities', 'Equirus Capital'],
    financials: [
      { year: 'FY24', revenueCr: 820, profitCr: 46, assetsCr: 610 },
      { year: 'FY25', revenueCr: 965, profitCr: 61, assetsCr: 720 },
      { year: 'FY26', revenueCr: 1130, profitCr: 78, assetsCr: 860 },
    ],
  },
  {
    companyName: 'Kaveri Agro Industries Ltd',
    symbol: 'KAVERIAGRO',
    issueType: 'MAINBOARD',
    sector: 'Chemicals',
    industry: 'Agrochemicals & Seeds',
    description:
      'Crop protection and hybrid seed company serving farmers in southern and western India through 6,500 distributors.',
    priceBand: [95, 100],
    lotSize: 150,
    maxLots: 13,
    issueSizeCr: 320,
    freshIssueCr: 200,
    ofsCr: 120,
    schedule: { open: -4, close: -2, allotment: 1, listing: 3 },
    demand: { retail: 0.86, nii: 1.42, qib: 2.05 },
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Unistone Capital'],
    financials: [
      { year: 'FY24', revenueCr: 540, profitCr: 31, assetsCr: 480 },
      { year: 'FY25', revenueCr: 588, profitCr: 36, assetsCr: 525 },
      { year: 'FY26', revenueCr: 642, profitCr: 41, assetsCr: 590 },
    ],
  },
  {
    companyName: 'Orbit Aerospace Systems Ltd',
    symbol: 'ORBITAERO',
    issueType: 'MAINBOARD',
    sector: 'Capital Goods',
    industry: 'Aerospace Components',
    description:
      'Precision manufacturer of aero-structures, landing gear components and satellite sub-systems for global aerospace and defence customers.',
    priceBand: [705, 742],
    lotSize: 20,
    maxLots: 13,
    issueSizeCr: 1780,
    freshIssueCr: 1100,
    ofsCr: 680,
    schedule: { open: -6, close: -4, allotment: -1, listing: 1 },
    demand: { retail: 2.4, nii: 8.7, qib: 31.6 },
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['SBI Capital Markets', 'Axis Capital'],
    financials: [
      { year: 'FY24', revenueCr: 980, profitCr: 118, assetsCr: 2650 },
      { year: 'FY25', revenueCr: 1290, profitCr: 164, assetsCr: 3180 },
      { year: 'FY26', revenueCr: 1705, profitCr: 231, assetsCr: 3920 },
    ],
  },
  {
    companyName: 'Vistaar Logistics Ltd',
    symbol: 'VISTAARLOG',
    issueType: 'MAINBOARD',
    sector: 'Services',
    industry: 'Logistics & Warehousing',
    description:
      'Integrated logistics company with express parcel, part-truckload and warehousing services backed by 140 fulfilment centres.',
    priceBand: [315, 332],
    lotSize: 45,
    maxLots: 13,
    issueSizeCr: 1140,
    freshIssueCr: 700,
    ofsCr: 440,
    schedule: { open: -24, close: -22, allotment: -20, listing: -18 },
    demand: { retail: 9.8, nii: 22.4, qib: 64.1 },
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['JM Financial', 'BofA Securities India'],
    financials: [
      { year: 'FY24', revenueCr: 2240, profitCr: 92, assetsCr: 1980 },
      { year: 'FY25', revenueCr: 2710, profitCr: 131, assetsCr: 2310 },
      { year: 'FY26', revenueCr: 3215, profitCr: 176, assetsCr: 2760 },
    ],
    currentPrice: 395,
  },
  {
    companyName: 'Quantum Medical Devices Ltd',
    symbol: 'QUANTUMMED',
    issueType: 'MAINBOARD',
    sector: 'Healthcare',
    industry: 'Medical Devices',
    description:
      'Designs and manufactures diagnostic imaging equipment, patient monitors and consumables for hospitals in India and 40 export markets.',
    priceBand: [460, 485],
    lotSize: 30,
    maxLots: 13,
    issueSizeCr: 1520,
    freshIssueCr: 820,
    ofsCr: 700,
    schedule: { open: -48, close: -46, allotment: -44, listing: -42 },
    demand: { retail: 42.6, nii: 88.3, qib: 156.2 },
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['Kotak Mahindra Capital', 'Nomura Financial Advisory'],
    financials: [
      { year: 'FY24', revenueCr: 1310, profitCr: 151, assetsCr: 1840 },
      { year: 'FY25', revenueCr: 1585, profitCr: 192, assetsCr: 2215 },
      { year: 'FY26', revenueCr: 1902, profitCr: 240, assetsCr: 2650 },
    ],
    currentPrice: 468,
  },
];

/** Share of equity assumed to be offered in an IPO, used to size shares outstanding at listing. */
export const IPO_FLOAT_FRACTION = 0.25;
