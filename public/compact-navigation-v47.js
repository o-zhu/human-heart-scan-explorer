/** One donor disclosure keeps scientific workspace chrome compact without
 * replacing source navigation, citation controls or the main tab semantics. */
export function initializeCompactNavigation(root=document){
 const bar=root.querySelector('.dataset-browser'),nav=bar?.querySelector('.dataset-shortcuts'),brand=root.querySelector('.topbar .brand');
 if(!bar||!nav||!brand)return null;
 let button=root.getElementById('compactDonorPicker');
 if(!button){
  button=root.createElement('button');button.type='button';button.id='compactDonorPicker';button.className='compact-donor-picker';
  const prefix=root.createElement('span');prefix.className='compact-donor-caption';prefix.textContent='Heart';
  const label=root.createElement('strong');label.className='compact-donor-name';
  const arrow=root.createElement('span');arrow.className='compact-donor-chevron';arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');
  button.append(prefix,label,arrow);brand.after(button);
  nav.id=nav.id||'datasetChoices';button.setAttribute('aria-controls',nav.id);button.setAttribute('aria-expanded','false');
  const close=()=>{bar.classList.remove('compact-donor-open');button.setAttribute('aria-expanded','false');};
  button.addEventListener('click',()=>{const open=!bar.classList.contains('compact-donor-open');bar.classList.toggle('compact-donor-open',open);button.setAttribute('aria-expanded',String(open));});
  root.addEventListener('pointerdown',event=>{if(!bar.contains(event.target)&&!button.contains(event.target))close();});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&bar.classList.contains('compact-donor-open')){event.preventDefault();close();button.focus();}});
  nav.addEventListener('click',event=>{if(event.target.closest('[data-source-link]'))close();});
  root.defaultView?.addEventListener?.('resize',close);
 }
 const current=nav.querySelector('[aria-current="page"]'),name=current?.querySelector('strong')?.textContent||'Choose';
 button.querySelector('.compact-donor-name').textContent=name;
 button.setAttribute('aria-label','Choose heart · '+(current?.getAttribute('aria-label')||name));
 // Collapse cards only after their working disclosure exists, on every page.
 root.body?.classList.add('compact-navigation-ready');
 return button;
}
