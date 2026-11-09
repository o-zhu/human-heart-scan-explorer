/** Only manifest-listed objects can be seeded. Final releases close every gate. */
import slices1 from './donors/s-20-29/ultra-index.json';
import volume1 from './donors/s-20-29/volume-index.json';
import slices2 from './donors/s-20-28/ultra-index.json';
import volume2 from './donors/s-20-28/volume-index.json';

// Temporarily enabled only for verified immutable data seeding.
export const comparisonDisplayUploadsEnabled = false;

export const comparisonBanks = [
  {kind:'ultra',index:slices1,directory:'data/donors/s-20-29/ultra-sections',uploadsEnabled:false,route:'/api/donors/s-20-29/ultra/',prefix:'hoa-heart/s-20-29/ultra-v11/',specimen:'S-20-29',spacingUm:79.56,sourceScale:'s2'},
  {kind:'volume',index:volume1,directory:'data/donors/s-20-29/ultra-volume',uploadsEnabled:false,route:'/api/donors/s-20-29/volume/',prefix:'hoa-heart/s-20-29/volume-v11/',specimen:'S-20-29',spacingUm:79.56,sourceScale:'s2'},
  {kind:'ultra',index:slices2,directory:'data/donors/s-20-28/ultra-sections',uploadsEnabled:false,route:'/api/donors/s-20-28/ultra/',prefix:'hoa-heart/s-20-28/ultra-v11/',specimen:'S-20-28',spacingUm:79.4,sourceScale:'s2'},
  {kind:'volume',index:volume2,directory:'data/donors/s-20-28/ultra-volume',uploadsEnabled:false,route:'/api/donors/s-20-28/volume/',prefix:'hoa-heart/s-20-28/volume-v11/',specimen:'S-20-28',spacingUm:79.4,sourceScale:'s2'},
];
