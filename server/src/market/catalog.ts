/**
 * Reference data for the simulated market. Prices and fundamentals are approximate and illustrative;
 * financial metrics are derived from a handful of inputs so they stay internally consistent:
 *   EPS = price / PE, book value = price / PB, ROE = PB / PE, shares = market cap / price.
 */

export interface StockSeed {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  /** Current price in rupees. */
  price: number;
  /** Market capitalisation in ₹ crore. */
  marketCapCr: number;
  pe: number;
  pb: number;
  /** Dividend yield in percent. */
  dividendYield: number;
  /** Net profit margin in percent, used to derive revenue. */
  netMargin: number;
  debtToEquity: number | null;
  beta: number;
  /** Annualised volatility (0.25 = 25%). */
  volatility: number;
  /** Average daily traded shares. */
  avgVolume: number;
  founded: number;
  headquarters: string;
  description: string;
  listingDate?: string;
  faceValue?: number;
  circuitPct?: number;
}

export interface FundSeed {
  symbol: string;
  name: string;
  type: 'ETF' | 'REIT' | 'INVIT';
  sector: string;
  industry: string;
  price: number;
  volatility: number;
  beta: number;
  avgVolume: number;
  description: string;
  /** Expense ratio (ETFs) in percent. */
  expenseRatio?: number;
  /** Distribution yield (REITs/InvITs) in percent. */
  dividendYield?: number;
  /** Index symbol the ETF tracks; its price is derived from that index. */
  underlying?: string;
  founded: number;
  headquarters: string;
  listingDate?: string;
}

export interface IndexSeed {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  value: number;
  description: string;
  constituents: string[];
}

const s = (
  symbol: string,
  name: string,
  sector: string,
  industry: string,
  price: number,
  marketCapCr: number,
  pe: number,
  pb: number,
  dividendYield: number,
  netMargin: number,
  debtToEquity: number | null,
  beta: number,
  volatility: number,
  avgVolume: number,
  founded: number,
  headquarters: string,
  description: string,
  extra: Partial<StockSeed> = {},
): StockSeed => ({
  symbol,
  name,
  sector,
  industry,
  price,
  marketCapCr,
  pe,
  pb,
  dividendYield,
  netMargin,
  debtToEquity,
  beta,
  volatility,
  avgVolume,
  founded,
  headquarters,
  description,
  ...extra,
});

export const STOCKS: StockSeed[] = [
  // Financial services
  s('HDFCBANK', 'HDFC Bank Ltd', 'Financial Services', 'Private Sector Bank', 980, 1_500_000, 21, 2.8, 1.1, 18, null, 0.9, 0.2, 15_000_000, 1994, 'Mumbai',
    "India's largest private sector bank by assets, offering retail banking, wholesale banking and treasury services through a nationwide branch network.", { faceValue: 1 }),
  s('ICICIBANK', 'ICICI Bank Ltd', 'Financial Services', 'Private Sector Bank', 1420, 1_010_000, 19, 3.2, 0.8, 20, null, 1.0, 0.22, 12_000_000, 1994, 'Mumbai',
    'Large private sector bank providing retail, corporate and treasury banking along with insurance and asset management through subsidiaries.', { faceValue: 2 }),
  s('SBIN', 'State Bank of India', 'Financial Services', 'Public Sector Bank', 860, 790_000, 10, 1.5, 1.8, 14, null, 1.1, 0.25, 14_000_000, 1955, 'Mumbai',
    "India's largest commercial bank, serving individuals, businesses and government with a vast domestic network and international offices.", { faceValue: 1 }),
  s('KOTAKBANK', 'Kotak Mahindra Bank Ltd', 'Financial Services', 'Private Sector Bank', 2080, 413_000, 22, 2.6, 0.1, 25, null, 0.85, 0.22, 4_000_000, 1985, 'Mumbai',
    'Diversified financial services group offering banking, stock broking, asset management, insurance and investment banking.', { faceValue: 5 }),
  s('AXISBANK', 'Axis Bank Ltd', 'Financial Services', 'Private Sector Bank', 1160, 360_000, 13, 1.9, 0.1, 18, null, 1.1, 0.25, 8_000_000, 1993, 'Mumbai',
    'Private sector bank serving large and mid corporates, SMEs, agriculture and retail customers.', { faceValue: 2 }),
  s('INDUSINDBK', 'IndusInd Bank Ltd', 'Financial Services', 'Private Sector Bank', 760, 59_000, 18, 0.9, 0.5, 5, null, 1.3, 0.35, 7_000_000, 1994, 'Mumbai',
    'New-generation private sector bank with strengths in vehicle finance, microfinance and corporate banking.', { faceValue: 10 }),
  s('BAJFINANCE', 'Bajaj Finance Ltd', 'Financial Services', 'Non-Banking Financial Company', 1000, 620_000, 33, 6, 0.6, 25, 3.8, 1.2, 0.28, 9_000_000, 1987, 'Pune',
    'Consumer-focused non-banking financial company offering consumer durable loans, personal loans, SME lending and deposits.', { faceValue: 1 }),
  s('BAJAJFINSV', 'Bajaj Finserv Ltd', 'Financial Services', 'Financial Holding Company', 2000, 320_000, 34, 4, 0.05, 7, 3.5, 1.0, 0.25, 1_500_000, 2007, 'Pune',
    'Holding company for the Bajaj group’s lending, life insurance and general insurance businesses.', { faceValue: 1 }),
  s('HDFCLIFE', 'HDFC Life Insurance Company Ltd', 'Financial Services', 'Life Insurance', 760, 164_000, 88, 10, 0.3, 2, null, 0.7, 0.24, 3_000_000, 2000, 'Mumbai',
    'Leading private life insurer offering protection, savings, investment and annuity products.', { faceValue: 10 }),
  s('SBILIFE', 'SBI Life Insurance Company Ltd', 'Financial Services', 'Life Insurance', 1820, 182_000, 75, 10.5, 0.15, 2.5, null, 0.7, 0.24, 1_500_000, 2000, 'Mumbai',
    'Life insurer with a bancassurance partnership with State Bank of India, offering individual and group products.', { faceValue: 10 }),
  s('SHRIRAMFIN', 'Shriram Finance Ltd', 'Financial Services', 'Non-Banking Financial Company', 650, 122_000, 13, 2.1, 1.5, 22, 4.2, 1.3, 0.32, 8_000_000, 1979, 'Chennai',
    'Retail-focused NBFC known for commercial vehicle finance, along with MSME, gold and personal loans.', { faceValue: 2 }),
  s('JIOFIN', 'Jio Financial Services Ltd', 'Financial Services', 'Non-Banking Financial Company', 310, 197_000, 120, 1.3, 0.2, 60, 0.1, 1.1, 0.35, 20_000_000, 2023, 'Mumbai',
    'Financial services platform spanning lending, payments, insurance broking and asset management.', { faceValue: 10, listingDate: '2023-08-21' }),
  s('LICI', 'Life Insurance Corporation of India', 'Financial Services', 'Life Insurance', 900, 570_000, 12, 4.5, 1.3, 5, null, 0.8, 0.25, 1_200_000, 1956, 'Mumbai',
    "India's largest life insurer by premiums and policies, with a pan-India agency network.", { faceValue: 10, listingDate: '2022-05-17' }),

  // Information technology
  s('TCS', 'Tata Consultancy Services Ltd', 'Information Technology', 'IT Services & Consulting', 3100, 1_120_000, 23, 11.5, 4, 19, 0.1, 0.6, 0.22, 2_500_000, 1968, 'Mumbai',
    'Global IT services, consulting and business solutions company serving clients across banking, retail, manufacturing and more.', { faceValue: 1 }),
  s('INFY', 'Infosys Ltd', 'Information Technology', 'IT Services & Consulting', 1500, 625_000, 23, 6.8, 2.8, 17, 0.1, 0.7, 0.24, 7_000_000, 1981, 'Bengaluru',
    'Digital services and consulting company helping enterprises with cloud, data, AI and application services.', { faceValue: 5 }),
  s('HCLTECH', 'HCL Technologies Ltd', 'Information Technology', 'IT Services & Consulting', 1480, 400_000, 23, 5.8, 3.6, 15, 0.1, 0.7, 0.24, 3_000_000, 1991, 'Noida',
    'IT services company with engineering, R&D services and a software products portfolio.', { faceValue: 2 }),
  s('WIPRO', 'Wipro Ltd', 'Information Technology', 'IT Services & Consulting', 250, 262_000, 20, 3.3, 2.4, 14, 0.2, 0.7, 0.25, 10_000_000, 1945, 'Bengaluru',
    'Technology services and consulting company offering cloud, digital, cybersecurity and engineering services.', { faceValue: 2 }),
  s('TECHM', 'Tech Mahindra Ltd', 'Information Technology', 'IT Services & Consulting', 1480, 145_000, 33, 5.5, 3, 8, 0.1, 0.8, 0.27, 2_500_000, 1986, 'Pune',
    'IT services provider with a strong presence in communications, media and enterprise transformation.', { faceValue: 5 }),
  s('LTIM', 'LTIMindtree Ltd', 'Information Technology', 'IT Services & Consulting', 5500, 163_000, 34, 7.7, 1.2, 13, 0.1, 0.8, 0.28, 600_000, 1996, 'Mumbai',
    'Technology consulting and digital solutions company formed by the merger of L&T Infotech and Mindtree.', { faceValue: 1 }),

  // Energy, utilities and conglomerates
  s('RELIANCE', 'Reliance Industries Ltd', 'Energy', 'Integrated Oil & Gas', 1390, 1_880_000, 24, 2.2, 0.4, 7.5, 0.4, 1.0, 0.22, 10_000_000, 1973, 'Mumbai',
    'Conglomerate spanning oil-to-chemicals, retail, digital services and new energy businesses.', { faceValue: 10 }),
  s('ONGC', 'Oil and Natural Gas Corporation Ltd', 'Energy', 'Oil Exploration & Production', 240, 302_000, 8, 0.9, 5, 6, 0.5, 0.9, 0.28, 12_000_000, 1956, 'New Delhi',
    "India's largest crude oil and natural gas producer, with refining and overseas upstream assets.", { faceValue: 5 }),
  s('BPCL', 'Bharat Petroleum Corporation Ltd', 'Energy', 'Oil Refining & Marketing', 330, 143_000, 9, 1.6, 3, 3, 0.7, 1.1, 0.3, 8_000_000, 1952, 'Mumbai',
    'Integrated oil refining and fuel marketing company with a large retail outlet network.', { faceValue: 10 }),
  s('NTPC', 'NTPC Ltd', 'Utilities', 'Power Generation', 340, 330_000, 14, 1.8, 2.4, 12, 1.4, 0.8, 0.24, 10_000_000, 1975, 'New Delhi',
    "India's largest power generation company with thermal, hydro and a growing renewable portfolio.", { faceValue: 10 }),
  s('POWERGRID', 'Power Grid Corporation of India Ltd', 'Utilities', 'Power Transmission', 290, 270_000, 17, 2.9, 3.8, 33, 1.5, 0.6, 0.22, 10_000_000, 1989, 'Gurugram',
    'Central transmission utility operating most of the inter-state power transmission network.', { faceValue: 10 }),
  s('COALINDIA', 'Coal India Ltd', 'Metals & Mining', 'Coal Mining', 390, 240_000, 7, 2.6, 6.5, 25, 0.1, 0.8, 0.25, 7_000_000, 1975, 'Kolkata',
    "The world's largest coal producer, supplying the bulk of India's thermal coal.", { faceValue: 10 }),
  s('ADANIENT', 'Adani Enterprises Ltd', 'Diversified', 'Conglomerate', 2400, 277_000, 40, 5, 0.05, 7, 1.5, 1.5, 0.4, 2_000_000, 1988, 'Ahmedabad',
    'Flagship incubator of the Adani group with businesses in airports, roads, mining, data centres and new energy.', { faceValue: 1 }),
  s('ADANIPORTS', 'Adani Ports and Special Economic Zone Ltd', 'Services', 'Ports & Logistics', 1420, 307_000, 27, 4.5, 0.5, 35, 0.8, 1.3, 0.32, 3_000_000, 1998, 'Ahmedabad',
    "India's largest private port operator with integrated logistics and SEZ businesses.", { faceValue: 2 }),

  // Consumer goods and retail
  s('HINDUNILVR', 'Hindustan Unilever Ltd', 'Fast Moving Consumer Goods', 'Personal & Home Care', 2500, 587_000, 55, 11, 1.7, 17, 0, 0.5, 0.18, 1_500_000, 1933, 'Mumbai',
    'Leading FMCG company with brands across home care, beauty, personal care, foods and refreshments.', { faceValue: 1 }),
  s('ITC', 'ITC Ltd', 'Fast Moving Consumer Goods', 'Diversified FMCG', 410, 513_000, 25, 7, 3.5, 27, 0, 0.6, 0.18, 14_000_000, 1910, 'Kolkata',
    'Diversified company with cigarettes, packaged foods, paperboards, hotels and agri businesses.', { faceValue: 1 }),
  s('NESTLEIND', 'Nestle India Ltd', 'Fast Moving Consumer Goods', 'Packaged Foods', 1200, 231_000, 72, 55, 1.1, 15, 0.2, 0.5, 0.18, 1_200_000, 1959, 'Gurugram',
    'Food and beverage company known for noodles, dairy, coffee, confectionery and infant nutrition brands.', { faceValue: 1 }),
  s('BRITANNIA', 'Britannia Industries Ltd', 'Fast Moving Consumer Goods', 'Packaged Foods', 5800, 140_000, 63, 32, 1.3, 12, 0.4, 0.6, 0.2, 300_000, 1892, 'Kolkata',
    'Food company best known for biscuits, along with bread, cakes, rusk and dairy products.', { faceValue: 1 }),
  s('TATACONSUM', 'Tata Consumer Products Ltd', 'Fast Moving Consumer Goods', 'Beverages & Foods', 1100, 109_000, 85, 5.5, 0.75, 7, 0.1, 0.7, 0.24, 1_500_000, 1962, 'Mumbai',
    'Consumer products company with tea, coffee, water, salt, pulses and ready-to-eat brands.', { faceValue: 1 }),
  s('DABUR', 'Dabur India Ltd', 'Fast Moving Consumer Goods', 'Personal Care & Ayurveda', 500, 88_600, 50, 8.5, 1.1, 14, 0.1, 0.5, 0.2, 2_000_000, 1884, 'Ghaziabad',
    'Ayurvedic and natural consumer products company spanning health care, personal care and foods.', { faceValue: 1 }),
  s('ASIANPAINT', 'Asian Paints Ltd', 'Consumer Durables', 'Paints', 2400, 230_000, 60, 12, 1.1, 11, 0.1, 0.6, 0.22, 1_200_000, 1942, 'Mumbai',
    "India's largest paint company with decorative and industrial coatings and home décor businesses.", { faceValue: 1 }),
  s('TITAN', 'Titan Company Ltd', 'Consumer Durables', 'Jewellery & Watches', 3500, 310_000, 85, 25, 0.3, 6, 0.8, 0.9, 0.24, 1_000_000, 1984, 'Bengaluru',
    'Lifestyle company with leading jewellery, watches, eyewear and wearables brands.', { faceValue: 1 }),
  s('HAVELLS', 'Havells India Ltd', 'Consumer Durables', 'Electrical Equipment', 1500, 94_000, 65, 11, 0.7, 6.5, 0, 0.8, 0.24, 1_000_000, 1958, 'Noida',
    'Electrical equipment maker with switchgear, cables, lighting, fans and consumer appliances.', { faceValue: 1 }),
  s('TRENT', 'Trent Ltd', 'Consumer Services', 'Retail', 4800, 171_000, 110, 25, 0.1, 9, 0.3, 1.1, 0.35, 1_000_000, 1952, 'Mumbai',
    'Fashion and lifestyle retailer operating Westside, Zudio and other formats.', { faceValue: 1 }),
  s('DMART', 'Avenue Supermarts Ltd', 'Consumer Services', 'Retail', 4200, 273_000, 95, 13, 0, 5, 0.02, 0.6, 0.25, 500_000, 2000, 'Mumbai',
    'Value retailer operating the DMart chain of hypermarkets and supermarkets.', { faceValue: 10 }),
  s('ETERNAL', 'Eternal Ltd', 'Consumer Services', 'Internet & Food Delivery', 330, 318_000, 400, 10, 0, 2, 0, 1.4, 0.4, 40_000_000, 2008, 'Gurugram',
    'Internet company behind food delivery, quick commerce and dining-out platforms.', { faceValue: 1 }),
  s('IRCTC', 'Indian Railway Catering and Tourism Corporation Ltd', 'Consumer Services', 'Travel & Tourism', 720, 57_600, 43, 15, 1.1, 30, 0, 0.9, 0.28, 2_000_000, 1999, 'New Delhi',
    'Railway ticketing, catering, packaged drinking water and tourism services provider.', { faceValue: 2 }),

  // Automobiles
  s('MARUTI', 'Maruti Suzuki India Ltd', 'Automobile', 'Passenger Vehicles', 16000, 503_000, 33, 5.3, 0.85, 9, 0, 0.8, 0.22, 500_000, 1981, 'New Delhi',
    "India's largest passenger car manufacturer with a wide range of hatchbacks, sedans and SUVs.", { faceValue: 5 }),
  s('M&M', 'Mahindra & Mahindra Ltd', 'Automobile', 'Passenger & Utility Vehicles', 3500, 435_000, 30, 5.5, 0.75, 9, 1.4, 1.0, 0.25, 2_500_000, 1945, 'Mumbai',
    'Leader in utility vehicles and tractors, with interests in financial services, IT and real estate.', { faceValue: 5 }),
  s('BAJAJ-AUTO', 'Bajaj Auto Ltd', 'Automobile', 'Two & Three Wheelers', 8700, 243_000, 32, 8, 0.9, 16, 0.1, 0.8, 0.24, 500_000, 1945, 'Pune',
    'Motorcycle and three-wheeler maker with a large export business.', { faceValue: 10 }),
  s('EICHERMOT', 'Eicher Motors Ltd', 'Automobile', 'Two Wheelers & Commercial Vehicles', 6800, 186_000, 38, 9, 1, 23, 0, 0.9, 0.26, 600_000, 1948, 'Gurugram',
    'Maker of Royal Enfield motorcycles with a commercial vehicles joint venture.', { faceValue: 1 }),
  s('HEROMOTOCO', 'Hero MotoCorp Ltd', 'Automobile', 'Two Wheelers', 5300, 106_000, 23, 5.4, 3.1, 11, 0, 0.8, 0.26, 600_000, 1984, 'New Delhi',
    "One of the world's largest two-wheeler manufacturers by volume.", { faceValue: 2 }),

  // Healthcare
  s('SUNPHARMA', 'Sun Pharmaceutical Industries Ltd', 'Healthcare', 'Pharmaceuticals', 1650, 396_000, 36, 5.6, 1, 20, 0, 0.5, 0.22, 2_500_000, 1983, 'Mumbai',
    "India's largest pharmaceutical company with specialty and generic medicines sold globally.", { faceValue: 1 }),
  s('CIPLA', 'Cipla Ltd', 'Healthcare', 'Pharmaceuticals', 1550, 125_000, 24, 4, 1, 19, 0, 0.5, 0.22, 1_500_000, 1935, 'Mumbai',
    'Pharmaceutical company focused on respiratory, anti-infective and chronic therapies.', { faceValue: 2 }),
  s('DRREDDY', "Dr. Reddy's Laboratories Ltd", 'Healthcare', 'Pharmaceuticals', 1250, 104_000, 18, 3.3, 0.65, 17, 0.1, 0.5, 0.22, 2_000_000, 1984, 'Hyderabad',
    'Integrated pharmaceutical company with generics, APIs and branded formulations.', { faceValue: 1 }),
  s('DIVISLAB', "Divi's Laboratories Ltd", 'Healthcare', 'Pharmaceuticals', 6000, 159_000, 75, 11, 0.5, 25, 0, 0.6, 0.25, 500_000, 1990, 'Hyderabad',
    'Manufacturer of active pharmaceutical ingredients and custom synthesis for global innovators.', { faceValue: 2 }),
  s('APOLLOHOSP', 'Apollo Hospitals Enterprise Ltd', 'Healthcare', 'Hospitals', 7500, 108_000, 70, 12, 0.25, 6, 0.7, 0.7, 0.24, 400_000, 1979, 'Chennai',
    'Integrated healthcare provider with hospitals, pharmacies, diagnostics and digital health.', { faceValue: 5 }),

  // Materials, industrials, telecom
  s('TATASTEEL', 'Tata Steel Ltd', 'Metals & Mining', 'Iron & Steel', 170, 212_000, 45, 2.3, 2.1, 2, 1.0, 1.4, 0.32, 30_000_000, 1907, 'Mumbai',
    'Global steel producer with operations in India, the Netherlands and the UK.', { faceValue: 1 }),
  s('JSWSTEEL', 'JSW Steel Ltd', 'Metals & Mining', 'Iron & Steel', 1100, 269_000, 50, 3.4, 0.25, 3, 1.0, 1.3, 0.3, 2_000_000, 1982, 'Mumbai',
    'Integrated steel manufacturer with flat and long products and a growing downstream portfolio.', { faceValue: 1 }),
  s('HINDALCO', 'Hindalco Industries Ltd', 'Metals & Mining', 'Aluminium & Copper', 740, 166_000, 10, 1.4, 0.5, 7, 0.5, 1.4, 0.32, 6_000_000, 1958, 'Mumbai',
    'Aluminium and copper producer and owner of Novelis, a global leader in rolled aluminium.', { faceValue: 1 }),
  s('VEDL', 'Vedanta Ltd', 'Metals & Mining', 'Diversified Metals', 470, 184_000, 9, 4.5, 7.5, 13, 1.5, 1.4, 0.35, 12_000_000, 1965, 'Mumbai',
    'Natural resources company with zinc, aluminium, oil and gas, iron ore and power businesses.', { faceValue: 1 }),
  s('ULTRACEMCO', 'UltraTech Cement Ltd', 'Construction Materials', 'Cement', 12100, 356_000, 50, 5.3, 0.6, 9, 0.2, 0.9, 0.22, 300_000, 2000, 'Mumbai',
    "India's largest cement producer with grey cement, white cement and ready-mix concrete.", { faceValue: 10 }),
  s('GRASIM', 'Grasim Industries Ltd', 'Construction Materials', 'Diversified', 2800, 190_000, 45, 2, 0.35, 3, 0.8, 1.0, 0.24, 800_000, 1947, 'Mumbai',
    'Diversified company with viscose fibre, chemicals, paints and holdings in cement and financial services.', { faceValue: 2 }),
  s('PIDILITIND', 'Pidilite Industries Ltd', 'Chemicals', 'Adhesives & Sealants', 1500, 152_000, 70, 15, 0.5, 16, 0, 0.6, 0.2, 700_000, 1959, 'Mumbai',
    'Maker of adhesives, sealants, construction chemicals and art materials.', { faceValue: 1 }),
  s('LT', 'Larsen & Toubro Ltd', 'Capital Goods', 'Construction & Engineering', 3700, 509_000, 33, 5.4, 0.9, 6, 1.2, 1.1, 0.24, 2_000_000, 1938, 'Mumbai',
    'Engineering and construction conglomerate spanning infrastructure, hydrocarbons, defence and technology services.', { faceValue: 2 }),
  s('BEL', 'Bharat Electronics Ltd', 'Capital Goods', 'Defence Electronics', 400, 292_000, 52, 13, 0.6, 21, 0, 1.1, 0.32, 20_000_000, 1954, 'Bengaluru',
    'Defence electronics company producing radars, communication systems and electronic warfare equipment.', { faceValue: 1 }),
  s('HAL', 'Hindustan Aeronautics Ltd', 'Capital Goods', 'Aerospace & Defence', 4600, 308_000, 37, 8.5, 0.8, 26, 0, 1.1, 0.33, 1_500_000, 1940, 'Bengaluru',
    'Aerospace company designing and building fighter aircraft, helicopters and engines.', { faceValue: 5 }),
  s('BHARTIARTL', 'Bharti Airtel Ltd', 'Telecommunication', 'Telecom Services', 1950, 1_170_000, 34, 9.5, 0.8, 18, 1.3, 0.7, 0.22, 6_000_000, 1995, 'New Delhi',
    'Telecommunications company with mobile, broadband, enterprise and digital TV services in India and Africa.', { faceValue: 5 }),
];

export const FUNDS: FundSeed[] = [
  { symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50 BeES', type: 'ETF', sector: 'ETF', industry: 'Index Fund - Large Cap', price: 285, volatility: 0.15, beta: 1, avgVolume: 6_000_000, expenseRatio: 0.04, underlying: 'NIFTY50', founded: 2001, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the NIFTY 50 index.' },
  { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', type: 'ETF', sector: 'ETF', industry: 'Index Fund - Large Cap', price: 265, volatility: 0.15, beta: 1, avgVolume: 1_500_000, expenseRatio: 0.04, underlying: 'NIFTY50', founded: 2015, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the NIFTY 50 index.' },
  { symbol: 'BANKBEES', name: 'Nippon India ETF Nifty Bank BeES', type: 'ETF', sector: 'ETF', industry: 'Index Fund - Banking', price: 575, volatility: 0.18, beta: 1.05, avgVolume: 2_000_000, expenseRatio: 0.19, underlying: 'NIFTYBANK', founded: 2004, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the NIFTY BANK index of the most liquid banking stocks.' },
  { symbol: 'ITBEES', name: 'Nippon India ETF Nifty IT', type: 'ETF', sector: 'ETF', industry: 'Index Fund - Technology', price: 40, volatility: 0.2, beta: 0.7, avgVolume: 5_000_000, expenseRatio: 0.21, underlying: 'NIFTYIT', founded: 2020, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the NIFTY IT index.' },
  { symbol: 'JUNIORBEES', name: 'Nippon India ETF Nifty Next 50 Junior BeES', type: 'ETF', sector: 'ETF', industry: 'Index Fund - Large Cap', price: 730, volatility: 0.18, beta: 1, avgVolume: 600_000, expenseRatio: 0.17, underlying: 'NIFTYNEXT50', founded: 2003, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the NIFTY NEXT 50 index.' },
  { symbol: 'GOLDBEES', name: 'Nippon India ETF Gold BeES', type: 'ETF', sector: 'ETF', industry: 'Commodity - Gold', price: 102, volatility: 0.14, beta: -0.1, avgVolume: 15_000_000, expenseRatio: 0.79, founded: 2007, headquarters: 'Mumbai',
    description: 'Exchange traded fund that invests in physical gold of 99.5% purity.' },
  { symbol: 'SILVERBEES', name: 'Nippon India Silver ETF', type: 'ETF', sector: 'ETF', industry: 'Commodity - Silver', price: 150, volatility: 0.25, beta: 0, avgVolume: 8_000_000, expenseRatio: 0.56, founded: 2022, headquarters: 'Mumbai', listingDate: '2022-02-03',
    description: 'Exchange traded fund that invests in physical silver.' },
  { symbol: 'MON100', name: 'Motilal Oswal Nasdaq 100 ETF', type: 'ETF', sector: 'ETF', industry: 'International Equity', price: 195, volatility: 0.22, beta: 0.3, avgVolume: 700_000, expenseRatio: 0.58, founded: 2011, headquarters: 'Mumbai',
    description: 'Exchange traded fund that tracks the US Nasdaq-100 index.' },
  { symbol: 'CPSEETF', name: 'CPSE ETF', type: 'ETF', sector: 'ETF', industry: 'Index Fund - PSU', price: 92, volatility: 0.24, beta: 1.1, avgVolume: 3_000_000, expenseRatio: 0.07, founded: 2014, headquarters: 'Mumbai',
    description: 'Exchange traded fund that invests in large central public sector enterprises.' },
  { symbol: 'LIQUIDBEES', name: 'Nippon India ETF Nifty 1D Rate Liquid BeES', type: 'ETF', sector: 'ETF', industry: 'Liquid / Overnight', price: 1000, volatility: 0.002, beta: 0, avgVolume: 400_000, expenseRatio: 0.69, founded: 2003, headquarters: 'Mumbai',
    description: 'Liquid ETF investing in overnight money market instruments; used to park idle cash.' },
  { symbol: 'EMBASSY', name: 'Embassy Office Parks REIT', type: 'REIT', sector: 'Real Estate', industry: 'Office REIT', price: 400, volatility: 0.15, beta: 0.4, avgVolume: 1_500_000, dividendYield: 6, founded: 2017, headquarters: 'Bengaluru',
    description: "India's first listed REIT, owning Grade A office parks across Bengaluru, Mumbai, Pune and NCR." },
  { symbol: 'MINDSPACE', name: 'Mindspace Business Parks REIT', type: 'REIT', sector: 'Real Estate', industry: 'Office REIT', price: 420, volatility: 0.14, beta: 0.4, avgVolume: 500_000, dividendYield: 5.5, founded: 2019, headquarters: 'Mumbai',
    description: 'REIT owning office portfolios in Mumbai, Pune, Hyderabad and Chennai.' },
  { symbol: 'BIRET', name: 'Brookfield India Real Estate Trust', type: 'REIT', sector: 'Real Estate', industry: 'Office REIT', price: 330, volatility: 0.15, beta: 0.4, avgVolume: 400_000, dividendYield: 6.5, founded: 2020, headquarters: 'Mumbai',
    description: 'Institutionally managed REIT with campus-format office parks in key Indian cities.' },
  { symbol: 'NXST', name: 'Nexus Select Trust', type: 'REIT', sector: 'Real Estate', industry: 'Retail REIT', price: 150, volatility: 0.16, beta: 0.5, avgVolume: 2_000_000, dividendYield: 5.5, founded: 2022, headquarters: 'Mumbai', listingDate: '2023-05-19',
    description: "India's first retail REIT, owning shopping malls across major cities." },
  { symbol: 'INDIGRID', name: 'IndiGrid Infrastructure Trust', type: 'INVIT', sector: 'Infrastructure', industry: 'Power Transmission InvIT', price: 160, volatility: 0.12, beta: 0.3, avgVolume: 800_000, dividendYield: 9, founded: 2016, headquarters: 'Mumbai',
    description: 'Infrastructure investment trust owning inter-state power transmission and solar assets.' },
  { symbol: 'PGINVIT', name: 'POWERGRID Infrastructure Investment Trust', type: 'INVIT', sector: 'Infrastructure', industry: 'Power Transmission InvIT', price: 90, volatility: 0.12, beta: 0.3, avgVolume: 1_000_000, dividendYield: 13, founded: 2020, headquarters: 'Gurugram',
    description: 'InvIT sponsored by POWERGRID holding operational transmission assets.' },
];

export const INDICES: IndexSeed[] = [
  {
    symbol: 'NIFTY50',
    name: 'NIFTY 50',
    exchange: 'NSE',
    value: 25_150,
    description: 'Benchmark index of 50 large and liquid companies listed on the National Stock Exchange.',
    constituents: [
      'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BAJFINANCE', 'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE',
      'SHRIRAMFIN', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'RELIANCE', 'ONGC', 'BPCL', 'NTPC', 'POWERGRID', 'COALINDIA',
      'ADANIENT', 'ADANIPORTS', 'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'ASIANPAINT', 'TITAN', 'TRENT',
      'ETERNAL', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'SUNPHARMA', 'CIPLA', 'DRREDDY', 'APOLLOHOSP',
      'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'ULTRACEMCO', 'GRASIM', 'LT', 'BEL', 'BHARTIARTL',
    ],
  },
  {
    symbol: 'SENSEX',
    name: 'BSE SENSEX',
    exchange: 'BSE',
    value: 82_350,
    description: 'Benchmark index of 30 well-established, financially sound companies listed on BSE.',
    constituents: [
      'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'BAJAJFINSV', 'TCS', 'INFY', 'HCLTECH', 'TECHM',
      'RELIANCE', 'NTPC', 'POWERGRID', 'ADANIPORTS', 'HINDUNILVR', 'ITC', 'NESTLEIND', 'ASIANPAINT', 'TITAN', 'TRENT', 'ETERNAL',
      'MARUTI', 'M&M', 'SUNPHARMA', 'TATASTEEL', 'ULTRACEMCO', 'LT', 'BEL', 'BHARTIARTL',
    ],
  },
  {
    symbol: 'NIFTYBANK',
    name: 'NIFTY BANK',
    exchange: 'NSE',
    value: 55_600,
    description: 'Index of the most liquid and large capitalised Indian banking stocks.',
    constituents: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK'],
  },
  {
    symbol: 'NIFTYIT',
    name: 'NIFTY IT',
    exchange: 'NSE',
    value: 35_400,
    description: 'Index of companies in the Indian information technology sector.',
    constituents: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTIM'],
  },
  {
    symbol: 'NIFTYNEXT50',
    name: 'NIFTY NEXT 50',
    exchange: 'NSE',
    value: 68_200,
    description: 'Index of the 50 companies ranked after the NIFTY 50 constituents by free-float market cap.',
    constituents: ['DMART', 'HAL', 'IRCTC', 'PIDILITIND', 'DABUR', 'HAVELLS', 'VEDL', 'LTIM'],
  },
  {
    symbol: 'NIFTYAUTO',
    name: 'NIFTY AUTO',
    exchange: 'NSE',
    value: 26_300,
    description: 'Index reflecting the performance of the automobile sector.',
    constituents: ['MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO'],
  },
  {
    symbol: 'NIFTYPHARMA',
    name: 'NIFTY PHARMA',
    exchange: 'NSE',
    value: 22_100,
    description: 'Index reflecting the performance of the pharmaceutical sector.',
    constituents: ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'APOLLOHOSP'],
  },
];
