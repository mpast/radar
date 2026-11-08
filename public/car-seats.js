export function parseSeats(value){if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+$/.test(value.trim())))return null;const seats=Number(value);return Number.isInteger(seats)&&seats>=1&&seats<=9?seats:null;}
export function effectiveSeats(value){return parseSeats(value)??5;}
export function seatLabel(value){const confirmed=parseSeats(value);return confirmed==null?'5 plazas (estimadas)':confirmed+' '+(confirmed===1?'plaza':'plazas');}
