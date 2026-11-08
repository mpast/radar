function registrationKey(car){
 if(car.kind!=='cars')return 0;
 const date=car.registrationDate;
 if(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)){
  const parsed=new Date(date+'T00:00:00Z');
  if(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date)return Number(date.replaceAll('-',''));
 }
 const year=Number(car.year);
 return Number.isInteger(year)&&year>=1900&&year<=9999?year*10000:0;
}
export function compareRegistrationNewest(a,b){return registrationKey(b)-registrationKey(a);}

export function registrationYear(car){const key=registrationKey(car);return key?Math.floor(key/10000):null;}
