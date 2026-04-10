export interface CampaignSub {
  key: string;
  label: string;
  pattern: string;
}

export interface VesselProfile {
  id: string;
  name: string;
  budgetMin: number;
  maxGuests: number;
  destinations: string[];
  utmPattern: string;
  bookingPattern: string;
  specs?: string;
  priceFrom?: string;
  campaigns?: CampaignSub[];
}

export const VESSEL_PROFILES: VesselProfile[] = [
  {
    id: 'smart-spirit',
    name: 'Smart Spirit',
    budgetMin: 10000,
    maxGuests: 8,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'smart_spirit',
    bookingPattern: 'SMART SPIRIT',
    specs: '29m · 8 guests · Croatia',
    priceFrom: 'from €18.5k/week',
  },
  {
    id: 'belgin-sultan',
    name: 'Belgin Sultan',
    budgetMin: 20000,
    maxGuests: 10,
    destinations: ['Turkey', 'Flexible'],
    utmPattern: 'belgin_sultan',
    bookingPattern: 'BELGIN SULTAN',
    specs: '35m · 10 guests · Turkey',
    priceFrom: 'from €25k/week',
  },
  {
    id: 'alessandro-i',
    name: 'Alessandro I',
    budgetMin: 60000,
    maxGuests: 10,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'alessandro',
    bookingPattern: 'ALESSANDRO',
    specs: '40m · 10 guests · Croatia',
    priceFrom: 'from €60k/week',
    campaigns: [
      { key: 'smarter', label: 'Smarter Way', pattern: 'alessandro_smarter' },
      { key: 'discount', label: 'Discount', pattern: 'alessandro' },
    ],
  },
  {
    id: 'maxita',
    name: 'Maxita',
    budgetMin: 75000,
    maxGuests: 12,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'maxita',
    bookingPattern: 'MAXITA',
    specs: '39m · 12 guests · Croatia',
    priceFrom: 'from €75k/week',
  },
  {
    id: 'anima-maris',
    name: 'Anima Maris',
    budgetMin: 100000,
    maxGuests: 12,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'anima_maris',
    bookingPattern: 'ANIMA MARIS',
    specs: '49m · 12 guests · Croatia',
    priceFrom: 'from €100k/week',
  },
  {
    id: 'nocturno',
    name: 'Nocturno',
    budgetMin: 85000,
    maxGuests: 12,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'nocturno',
    bookingPattern: 'NOCTURNO',
    specs: '48m · 12 guests · Croatia',
    priceFrom: 'from €85k/week',
  },
  {
    id: 'dalmatino',
    name: 'Dalmatino',
    budgetMin: 80000,
    maxGuests: 12,
    destinations: ['Croatia', 'Flexible'],
    utmPattern: 'dalmatino',
    bookingPattern: 'DALMATINO',
    specs: '43m · 12 guests · Croatia',
    priceFrom: 'from €80k/week',
  },
];
