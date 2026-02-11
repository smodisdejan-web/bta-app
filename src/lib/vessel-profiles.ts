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
}

export const VESSEL_PROFILES: VesselProfile[] = [
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
  },
];
