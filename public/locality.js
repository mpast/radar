export const normalizeLocality=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function matchesLocality(item,selected){return !selected||normalizeLocality(item.locality)===normalizeLocality(selected);}
