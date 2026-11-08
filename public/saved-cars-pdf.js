import {seatLabel} from './car-seats.js';

const missing='No disponible';
const euros=value=>value==null?missing:new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
const text=value=>String(value??missing).normalize('NFC').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
// PDF standard fonts use WinAnsi; hexadecimal strings keep source data out of PDF syntax.
function hex(value){return '<'+Array.from(text(value),character=>{const code=character==='€'?128:character==='–'||character==='—'?45:character.charCodeAt(0);return (code<=255?code:63).toString(16).padStart(2,'0');}).join('')+'>';}
function lines(value,width){
 const result=[];let line='';
 for(const word of text(value).split(' ')){
  let rest=word;
  if(line&&line.length+1+rest.length>width){result.push(line);line='';}
  while(rest.length>width){result.push(rest.slice(0,width));rest=rest.slice(width);}
  if(rest)line+=(line?' ':'')+rest;
 }
 if(line||!result.length)result.push(line);
 return result;
}
function listingUrl(car){
 try{const url=new URL(car.url);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function savedCars(items){return items.filter(item=>item.kind==='cars'&&item.favourite);}
export function savedHouses(items){return items.filter(item=>item.kind==='houses'&&item.favourite);}
export function buildSavedCarsPdf(items,photos){return buildSavedListingsPdf(items,photos,'cars');}
export function buildSavedHousesPdf(items,photos){return buildSavedListingsPdf(items,photos,'houses');}

function buildSavedListingsPdf(items,photos=new Map(),kind='cars'){
 const cars=kind==='houses'?savedHouses(items):savedCars(items);
 if(!cars.length)throw Error(kind==='houses'?'No hay viviendas guardadas para descargar.':'No hay coches guardados para descargar.');
 const objects=[null,null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
 const add=value=>(objects.push(value),objects.length),pages=[];
 for(const [index,car] of cars.entries()){
  let commands,annotations,y;
  const photo=photos.get(car.id);
  let imageId;
  if(photo?.bytes instanceof Uint8Array&&photo.bytes.length&&Number.isInteger(photo.width)&&photo.width>0&&photo.width<=1280&&Number.isInteger(photo.height)&&photo.height>0&&photo.height<=900){
   const imageStream=Array.from(photo.bytes,byte=>byte.toString(16).padStart(2,'0')).join('')+'>';
   imageId=add(`<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`);
  }
  function newPage(){
   if(commands)finishPage();
   commands=[];annotations=[];y=784;
   draw(kind==='houses'?'RADAR / VIVIENDAS GUARDADAS':'RADAR / COCHES GUARDADOS',10,'F2');
   draw(`Ficha ${index+1} de ${cars.length}`,9);y-=15;
  }
  function draw(value,size=10,font='F1',color='0.10 0.20 0.18'){
   commands.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 44 ${y} Tm ${hex(value)} Tj ET`);y-=size+8;
  }
  function paragraph(value,{size=10,font='F1',width=52,color,link}={}){
   for(const line of lines(value,width)){
    if(y<72)newPage();
    if(link)annotations.push(add(`<< /Type /Annot /Subtype /Link /Rect [44 ${y-3} 550 ${y+size+3}] /Border [0 0 0] /A << /S /URI /URI ${hex(link)} >> >>`));
    draw(line,size,font,color);
   }
  }
  function finishPage(){
   commands.push(`BT /F1 8 Tf 0.45 0.50 0.45 rg 1 0 0 1 44 34 Tm ${hex('Radar - Datos guardados. Confirma disponibilidad, precio y gastos.')} Tj ET`);
   const stream=commands.join('\n'),content=add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
   pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> ${imageId?`/XObject << /CarPhoto ${imageId} 0 R >>`:``} >> /Contents ${content} 0 R /Annots [${annotations.map(id=>`${id} 0 R`).join(' ')}] >>`));
  }
  newPage();
  paragraph(car.title,{size:18,font:'F2',width:29});y-=9;
  if(imageId){
   const scale=Math.min(507/photo.width,180/photo.height),width=photo.width*scale,height=photo.height*scale;
   if(y-height<88)newPage();
   commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(44+(507-width)/2).toFixed(2)} ${(y-height).toFixed(2)} cm /CarPhoto Do Q`);y-=height+18;
  }else{paragraph('Foto no disponible.',{size:9});y-=4;}
  const fields=kind==='houses'?[['Precio anunciado',euros(car.price)],['Superficie',car.area==null?missing:car.area+' m²'],['Habitaciones',car.beds??missing],['Tipo',car.houseType==='chalet'?'Chalet':'Vivienda'],['Localidad',car.locality||missing],['Código postal',car.postalCode||missing],['Distancia',car.distance==null?missing:'Aprox. '+car.distance+' km'],['Fuente',car.source||missing],['Referencia',car.id||missing],['Última observación',car.lastSeen?new Date(car.lastSeen).toLocaleDateString('es-ES'):missing]]:[['Precio anunciado',euros(car.price)],['Precio financiado',euros(car.financePrice)],['Kilómetros',car.km==null?missing:car.km.toLocaleString('es-ES')+' km'],['Matriculación',car.registrationDate||car.year||missing],['Plazas',seatLabel(car.seats)],['Concesionario',car.dealer||car.sellerEvidence||missing],['Localidad',car.locality||missing],['Distancia',car.distance==null?missing:'Aprox. '+car.distance+' km'],['Fuente',car.source||missing],['Referencia',car.stockReference||car.id||missing],['Última observación',car.lastSeen?new Date(car.lastSeen).toLocaleDateString('es-ES'):missing]];
  for(const [label,value]of fields){paragraph(`${label}: ${value}`,{font:'F3',width:78});y-=3;}
  if(car.manualSnapshot)paragraph('Importación manual: estos datos no se actualizan automáticamente.');
  if(car.verifiedInLatestSearch===false)paragraph('No verificado en la última búsqueda. Confirma su disponibilidad.');
  if(car.warnings?.length)paragraph('Avisos: '+car.warnings.join(', '));
  y-=10;
  const url=listingUrl(car);
  if(car.catalogueLink)paragraph('Catálogo oficial: busca el coche por su referencia y concesionario.');
  if(url){paragraph(car.catalogueLink?'Abrir catálogo oficial':'Abrir anuncio original',{font:'F2',color:'0.10 0.32 0.60',link:url});paragraph(url,{font:'F3',size:9,width:90,color:'0.10 0.32 0.60',link:url});}
  else paragraph('Enlace no disponible.');
  finishPage();
 }
 objects[0]='<< /Type /Catalog /Pages 2 0 R >>';
 objects[1]=`<< /Type /Pages /Kids [${pages.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
 let pdf='%PDF-1.4\n',offsets=[0];
 for(const [index,object]of objects.entries()){offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=pdf.length;
 pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
 pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new TextEncoder().encode(pdf);
}

// Use the existing same-origin photo proxy, never a third-party image URL.
export function loadCarPhoto(car){
 if(!car.photoUrl)return Promise.resolve(null);
 return new Promise(resolve=>{
  const image=new Image();let timer;
  const finish=photo=>{clearTimeout(timer);image.onload=null;image.onerror=null;image.src='';resolve(photo);};
  image.onload=()=>{
   try{
    if(!image.naturalWidth||!image.naturalHeight)return finish(null);
    const scale=Math.min(1,1280/image.naturalWidth,900/image.naturalHeight),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    const encoded=canvas.toDataURL('image/jpeg',0.85).split(',')[1];
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    canvas.width=canvas.height=0;finish({bytes,width,height});
   }catch{finish(null);}
  };
  image.onerror=()=>finish(null);
  timer=setTimeout(()=>finish(null),12000);
  image.src='/api/photo?id='+encodeURIComponent(car.id);
 });
}

export function collectSavedCarPhotos(items,loadPhoto){return collectSavedListingPhotos(items,loadPhoto,'cars');}
export function collectSavedHousePhotos(items,loadPhoto){return collectSavedListingPhotos(items,loadPhoto,'houses');}
async function collectSavedListingPhotos(items,loadPhoto=loadCarPhoto,kind='cars'){
 const queue=(kind==='houses'?savedHouses(items):savedCars(items)),photos=new Map();let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
  while(cursor<queue.length){const car=queue[cursor++];try{const photo=await loadPhoto(car);if(photo)photos.set(car.id,photo);}catch{/* One unavailable photo must not prevent the download. */}}
 }));
 return photos;
}

export function downloadSavedCarsPdf(items){return downloadSavedListingsPdf(items,'cars');}
export function downloadSavedHousesPdf(items){return downloadSavedListingsPdf(items,'houses');}
async function downloadSavedListingsPdf(items,kind){
 const cars=kind==='houses'?savedHouses(items):savedCars(items);
 if(!cars.length)throw Error(kind==='houses'?'No hay viviendas guardadas para descargar.':'No hay coches guardados para descargar.');
 const photos=await collectSavedListingPhotos(cars,loadCarPhoto,kind),bytes=buildSavedListingsPdf(cars,photos,kind),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),anchor=document.createElement('a');
 try{anchor.href=url;anchor.download=kind==='houses'?'viviendas-guardadas.pdf':'coches-guardados.pdf';document.body.append(anchor);anchor.click();}
 finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 return {cars:cars.length,missingPhotos:cars.length-photos.size};
}
