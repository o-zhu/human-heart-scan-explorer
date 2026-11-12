/** TEE electronic multiplane display: 0° left, 90° down, 180° right.
 * Display only; never changes an acquisition plane or interprets video pixels.
 */
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=value=>Math.min(180,Math.max(0,Number.isFinite(Number(value))?Number(value):0));
const coordinate=value=>Number(value.toFixed(4));
export const formatMultiplaneAngle=value=>`${Number(clamp(value).toFixed(1))}°`;

export function multiplanePoint(angle,radius=52){
 const radians=clamp(angle)*Math.PI/180;
 return {x:coordinate(64-radius*Math.cos(radians)),y:coordinate(34+radius*Math.sin(radians))};
}

export function multiplaneRange(range){
 if(!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[0]<0||range[1]>180||range[0]>range[1])return null;
 return [...range];
}

export function multiplaneRangePath(range){
 const valid=multiplaneRange(range);if(!valid)return '';
 const [min,max]=valid,a=multiplanePoint(min),b=multiplanePoint(max);
 if(min===max)return `M64 34L${a.x} ${a.y}`;
 return `M64 34L${a.x} ${a.y}A52 52 0 0 0 ${b.x} ${b.y}Z`;
}

function description({angle,range,variant,label,ariaLabel}){
 if(ariaLabel)return ariaLabel;
 if(variant==='range'&&range)return `Typical TEE multiplane range ${formatMultiplaneAngle(range[0])} to ${formatMultiplaneAngle(range[1])}`;
 return `${label==='REF'?'Reference':label==='SIM'?'Simulated':'TEE'} multiplane angle ${formatMultiplaneAngle(angle)}${range?`; typical range ${formatMultiplaneAngle(range[0])} to ${formatMultiplaneAngle(range[1])}`:''}`;
}

export function multiplaneIndicatorMarkup({angle=0,range=null,variant='full',label='REF',className='',ariaLabel}={}){
 const valid=multiplaneRange(range),point=multiplanePoint(angle),isRange=variant==='range',name=description({angle,range:valid,variant,label,ariaLabel});
 return `<span class="multiplane-indicator${isRange?' multiplane-indicator-range':''}${className?' '+escapeHTML(className):''}" data-multiplane="indicator" role="img" aria-label="${escapeHTML(name)}" title="${escapeHTML(name)}"><svg viewBox="${isRange?'4 25 120 67':'0 0 128 104'}" aria-hidden="true" focusable="false"><text class="multiplane-end" x="12" y="23" text-anchor="middle">0</text><text class="multiplane-value" data-multiplane="value" x="64" y="23" text-anchor="middle">${formatMultiplaneAngle(angle)}</text><text class="multiplane-end" x="115" y="23" text-anchor="middle">180</text><path class="multiplane-range" data-multiplane="range" d="${multiplaneRangePath(valid)}"/><path class="multiplane-arc" d="M12 34H116A52 52 0 0 1 12 34"/><line class="multiplane-pointer" data-multiplane="pointer" x1="64" y1="34" x2="${point.x}" y2="${point.y}"/><circle class="multiplane-hub" cx="64" cy="34" r="2.4"/><text class="multiplane-label" data-multiplane="label" x="64" y="102" text-anchor="middle">${escapeHTML(label)}</text></svg></span>`;
}

/** Mutate the existing SVG only; no allocation of canvases, observers or timers. */
export function updateMultiplaneIndicator(element,{angle=0,range=null,label='REF',ariaLabel}={}){
 const root=element?.matches?.('[data-multiplane="indicator"]')?element:element?.querySelector?.('[data-multiplane="indicator"]');
 if(!root)return;
 const valid=multiplaneRange(range),point=multiplanePoint(angle),variant=root.classList.contains('multiplane-indicator-range')?'range':'full';
 const name=description({angle,range:valid,variant,label,ariaLabel});
 root.querySelector('[data-multiplane="value"]').textContent=formatMultiplaneAngle(angle);
 const pointer=root.querySelector('[data-multiplane="pointer"]');pointer.setAttribute('x2',point.x);pointer.setAttribute('y2',point.y);
 const rangePath=root.querySelector('[data-multiplane="range"]');rangePath.setAttribute('d',multiplaneRangePath(valid));
 root.querySelector('[data-multiplane="label"]').textContent=label;
 root.setAttribute('aria-label',name);root.setAttribute('title',name);
}

/** Range overlay for original teaching artwork. Raster artwork stays intact. */
export function teeIllustrationAngleMarkup(view,{className=''}={}){
 const range=multiplaneRange(view?.angleRange);
 if(view?.mode!=='tee'||!range)return '';
 return multiplaneIndicatorMarkup({angle:(range[0]+range[1])/2,range,variant:'range',label:'',className,
  ariaLabel:`${view.name}: typical multiplane range ${formatMultiplaneAngle(range[0])} to ${formatMultiplaneAngle(range[1])}`});
}
