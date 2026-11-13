import { loadTurkeyCampaign } from '../src/lib/turkey-campaign'
loadTurkeyCampaign().then((r: any) => { const f = (o: any): any => o && typeof o === 'object' ? (('hubspotMatched' in o) ? o : Object.values(o).map(f).find(Boolean)) : null; const x = f(r); console.log('TURKEY', JSON.stringify(x ? Object.fromEntries(Object.entries(x).filter(([k, v]) => typeof v === 'number')) : null)) })
