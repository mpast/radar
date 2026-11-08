export function normalizeEnvironmentalLabel(value){
 if(typeof value!=='string')return null;
 const label=value.trim().toUpperCase();
 if(['B','C','ECO','0'].includes(label))return label;
 return ['CERO','0 EMISIONES','CERO EMISIONES'].includes(label)?'0':null;
}
export function environmentalLabelText(value){
 const label=normalizeEnvironmentalLabel(value);
 return label===null?'Etiqueta no disponible':label==='0'?'Etiqueta 0 emisiones':'Etiqueta '+label;
}
