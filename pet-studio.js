const $=id=>document.getElementById(id);
const frontendConfig=window.PAWMARK_CONFIG||{};
const apiUrl=path=>frontendConfig.apiOrigin?new URL(path,frontendConfig.apiOrigin).href:path;
let photo='',originalPhoto='',icon='',card='',magnetImage='',sourceIcon='',color='#e9b3a1',requestId='',orderId='',paid=false,busy=false,revision=0;
let baseIcon='',jobStage='',jobFingerprint='',renderPromise=Promise.resolve(),captionRevision=0,layerAttempt=0;
let restoring=true,generationUsed=false,regenerate=false;
const PIPELINE='pet-seedream-flash-1k-no-text-v4';
const watermark=$('watermark');for(let i=0;i<8;i++){const span=document.createElement('span');span.textContent='PAWMARK';watermark.appendChild(span)}
const db=new Promise((resolve,reject)=>{const r=indexedDB.open('traveltag-pet-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function save(){try{const d=await db;const t=d.transaction('draft','readwrite');t.objectStore('draft').put({photo,originalPhoto,icon,card,sourceIcon,baseIcon,jobStage,jobFingerprint,layerAttempt,color,requestId,orderId,paid,generationUsed,pipeline:PIPELINE},'current');await new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});return true}catch{return false}}
async function restore(){try{
 const d=await db;let value=await new Promise((resolve,reject)=>{const r=d.transaction('draft').objectStore('draft').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=reject});
 const resumedOrder=new URLSearchParams(location.search).get('resume');
 if(resumedOrder&&resumedOrder!==value?.orderId){
  const recovered=await api('/api/magnet-order?id='+encodeURIComponent(resumedOrder)+'&includePhoto=1');
  if(recovered.paymentStatus==='paid'&&recovered.paymentMode==='live'&&recovered.mainImage){
   value={photo:recovered.mainImage,originalPhoto:recovered.mainImage,orderId:recovered.orderId,requestId:recovered.orderId,pipeline:PIPELINE};
  }else{setStatus('这笔订单尚未确认付款，请稍后重试查询。',true);return}
 }
 if(!value)return;
 ({photo='',originalPhoto='',icon='',card='',color='#e9b3a1',requestId='',orderId=''}=value);
 generationUsed=!!value.generationUsed;
 if(photo)showPhoto();
 if(orderId){try{await checkPayment()}catch{paid=false}}
 const current=value.pipeline===PIPELINE,legacy=['pet-seedream-flash-layers-v1','pet-seedream-flash-1k-stages-v2','pet-seedream-flash-1k-ai-text-v3'].includes(value.pipeline);
 if(current){baseIcon=value.baseIcon||'';sourceIcon=value.sourceIcon||'';jobStage=value.jobStage||'';jobFingerprint=value.jobFingerprint||'';layerAttempt=value.layerAttempt||0}
 else if(legacy&&icon&&card){baseIcon='';sourceIcon=''}
 else{icon='';card='';orderId='';paid=false;requestId=crypto.randomUUID();setStatus('生成流程已升级，请重新生成设计。')}
 if(baseIcon&&!jobStage){await applyCaption();setStatus('已恢复上次设计。')}
 else if(icon&&card&&!jobStage){await compose();setStatus('已恢复上次设计。')}
 else if(jobStage){if(sourceIcon)await showSourcePreview();$('generateLabel').textContent=jobStage==='layer'?'继续处理透明图层':'继续生成图标';setStatus(jobStage==='layer'?'已恢复卡通预览，点击继续处理透明图层。':'已恢复生成任务，点击继续；已完成的步骤会复用。')}
 if(generationUsed){$('generateLabel').textContent='重新生成 · ¥3.00';setStatus('本次订单的生成机会已使用，重新生成需重新付款 ¥3.00。',true)}
 await save();
 if(new URLSearchParams(location.search).get('resume')===orderId && orderId){
  history.replaceState(null,'',location.pathname+location.hash);
  if(paid && !card && !generationUsed)await runGeneration();
  else if(!paid){openModal();$('payStatus').textContent='尚未确认到账。若已付款，请点击「查询付款状态」。'}
 }
}catch(e){setStatus('草稿恢复失败，请重新上传照片。',true)}finally{restoring=false;$('generate').disabled=false;$('photo').disabled=false}}
function setStatus(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
function submitAlipay(orderId){const form=document.createElement('form');form.method='POST';form.action=apiUrl('/api/magnet-alipay');form.target='_top';for(const [name,value] of Object.entries({orderId,...(frontendConfig.frontend==='github'?{frontend:'github'}:{})})){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input)}document.body.append(form);form.submit()}
async function api(url,body){const response=await fetch(apiUrl(url),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)}:undefined);const data=await response.json();if(!response.ok||data.error){const error=new Error(data.error||'请求未完成，请稍后重试');error.code=data.code;error.status=data.status||response.status;throw error}return data}
function load(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('照片无法读取，请换一张图片'));image.src=src})}
function blobData(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
async function compress(src,max=1200,quality=.88){const img=await load(src);const scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality)}
function dominantColor(img){const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,64,64);const a=ctx.getImageData(0,0,64,64).data,groups=new Map();for(let i=0;i<a.length;i+=4){if(a[i+3]<200)continue;const r=a[i],g=a[i+1],b=a[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);if(hi<65||lo>235||hi-lo<30)continue;const key=[r,g,b].map(v=>Math.floor(v/32)).join(',');const item=groups.get(key)||{count:0,r:0,g:0,b:0};item.count++;item.r+=r;item.g+=g;item.b+=b;groups.set(key,item)}const winner=[...groups.values()].sort((a,b)=>b.count-a.count)[0];if(!winner)return '#d4b497';return '#'+['r','g','b'].map(k=>Math.round(winner[k]/winner.count).toString(16).padStart(2,'0')).join('')}
function textColor(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16));return rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>150?'#37382e':'#fffaf2'}
function showPhoto(){$('photoView').src=originalPhoto||photo;$('drop').classList.add('has');$('uploadTitle').textContent='更换照片'}
async function acceptFile(file){if(busy||restoring)return;if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setStatus('请选择 JPG、PNG 或 WEBP 格式的照片。',true);return}if(file.size>15*1024*1024){setStatus('请选择小于15MB的照片。',true);return}try{const source=await blobData(file),image=await load(source);if(image.width<100||image.height<100)throw new Error('照片尺寸太小，请选择更清晰的照片');originalPhoto=source;generationUsed=false;regenerate=false;sourceIcon='';baseIcon='';jobStage='';jobFingerprint='';layerAttempt=0;photo=await compress(source,1200,.88);color=dominantColor(image);icon='';card='';orderId='';paid=false;requestId=crypto.randomUUID();revision++;showPhoto();$('resultActions').style.display='none';$('editNote').classList.add('hidden');$('designView').src=source;$('designStage').classList.remove('unpaid','ready');$('designStage').style.removeProperty('width');$('designStage').style.removeProperty('aspect-ratio');$('sampleTag').textContent='原照片';setStatus('照片已上传。');$('generateLabel').textContent='生成设计';await save()}catch(e){setStatus(e.message,true)}}
$('photo').onchange=e=>acceptFile(e.target.files[0]);$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('photo').click()}};
for(const event of ['dragenter','dragover'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('dragging')});for(const event of ['dragleave','drop'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.remove('dragging')});$('drop').addEventListener('drop',e=>acceptFile(e.dataTransfer.files[0]));
async function applyCaption(){if(!baseIcon)return;icon=baseIcon;await compose()}
function queueCaption(){renderPromise=applyCaption();return renderPromise}
let scriptFont;async function ensureScriptFont(){if(!scriptFont)scriptFont=new FontFace('TravelScript','url(./fonts/xingshu.woff)').load().then(f=>{document.fonts.add(f);return f});try{await scriptFont}catch{scriptFont=null;throw new Error('钟齐志莽行书字体加载失败，请重试。')}}
function iconAlphaStats(data,width,height){let clear=0,solid=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)clear++;if(data[i]>32)solid++}return {clear:clear/(width*height),solid:solid/(width*height)}}
async function transparentIcon(source){
 const img=await load(source),c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height);
 const alpha=iconAlphaStats(pixels.data,c.width,c.height);
 if(alpha.clear<.01||alpha.solid<.005)throw Object.assign(new Error('模型返回的图层缺少有效透明背景或主体，请重新生成。'),{invalidLayer:true});
 // Preserve the native layer exactly; never remove white fur or recolour pixels.
 return source;
}
async function showSourcePreview(){await compose(true)}
async function compose(preview=false){const designIcon=preview?sourceIcon:icon;if(!designIcon)throw new Error('请先生成设计');const version=++revision;const [original,pet]=await Promise.all([load(originalPhoto||photo),load(designIcon)]);const c=document.createElement('canvas');c.width=900;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,900,600);
const magnet=pet;const magnetScale=Math.min(520/magnet.width,500/magnet.height);ctx.drawImage(magnet,450-magnet.width*magnetScale/2,300-magnet.height*magnetScale/2,magnet.width*magnetScale,magnet.height*magnetScale);
const scale=Math.min(1,900/Math.max(original.width,original.height)),photoWidth=Math.max(1,Math.round(original.width*scale)),photoHeight=Math.max(1,Math.round(original.height*scale)),horizontal=original.width>=original.height;const output=document.createElement('canvas');output.width=horizontal?photoWidth:photoWidth*2;output.height=horizontal?photoHeight*2:photoHeight;const out=output.getContext('2d');out.fillStyle=color;out.fillRect(0,0,output.width,output.height);const designScale=Math.min(photoWidth/900,photoHeight/600),designWidth=900*designScale,designHeight=600*designScale;out.drawImage(c,(photoWidth-designWidth)/2,(photoHeight-designHeight)/2,designWidth,designHeight);out.drawImage(original,horizontal?0:photoWidth,horizontal?photoHeight:0,photoWidth,photoHeight);if(version!==revision)return;$('designStage').style.width=Math.min(440,410*output.width/output.height)+'px';$('designStage').style.aspectRatio=output.width+'/'+output.height;if(preview){$('designView').src=output.toDataURL('image/png');$('designView').alt='卡通图标与原照片的拼贴预览，透明图层处理中';$('designStage').classList.add('ready','unpaid');$('sampleTag').textContent='卡通预览 · 透明图层待完成';$('resultActions').style.display='none';$('editNote').classList.add('hidden')}else{magnetImage=icon;card=output.toDataURL('image/png');showCard()}await save()}
function showCard(){$('designView').src=card;$('designView').alt='你的宠物专属冰箱贴设计稿';$('designStage').classList.add('ready');$('designStage').classList.toggle('unpaid',!paid);$('sampleTag').textContent=paid?'已解锁':'专属设计';$('resultActions').style.display='flex';$('editNote').classList.remove('hidden');$('downloadLabel').textContent=paid?'下载原始图标':'解锁导出';$('generateLabel').textContent='重新生成 · ¥3.00'}
function stageImage(data,stage){if(data.mode!=='image-edit'||data.stage!==stage||!data.image||data.mime!=='image/png'||(stage==='layer'&&data.transparentLayer!==true))throw new Error('生成素材无效，请重试');return 'data:image/png;base64,'+data.image}
async function runGeneration(){
 if(busy||!paid||!orderId)return;if(baseIcon&&!jobStage&&!icon){try{await queueCaption();setStatus('文字排版已完成。')}catch(e){setStatus(e.message,true)}return}if(!photo){$('photo').click();return}busy=true;$('generate').disabled=true;$('photo').disabled=true;$('progress').style.display='block';
 let seconds=0;const timer=setInterval(()=>setStatus(`${jobStage==='layer'?'第2步：分离透明图层':'第1步：生成卡通图标'} · 已等待 ${++seconds} 秒`),1000);
 try{
  if(!jobStage){jobStage='cartoon';jobFingerprint='';layerAttempt=0;sourceIcon='';baseIcon='';icon='';card='';captionRevision++;$('resultActions').style.display='none';$('editNote').classList.add('hidden')}
  await save();
  if(jobStage==='cartoon'){
   $('generateLabel').textContent='正在生成卡通图标…';setStatus('第1步：正在生成卡通图标…');
   const data=await api('/api/generate-magnet',{requestId:orderId,stage:'cartoon'});sourceIcon=stageImage(data,'cartoon');jobFingerprint=data.fingerprint;jobStage='layer';seconds=0;
   await save();await showSourcePreview();
  }
  $('generateLabel').textContent='正在处理透明图层…';setStatus('第2步：卡通预览已就绪，正在分离透明图层…');
  const data=await api('/api/generate-magnet',{requestId:orderId,fingerprint:jobFingerprint,stage:'layer'});
  const nativeLayer=stageImage(data,'layer');await transparentIcon(nativeLayer);baseIcon=nativeLayer;jobStage='';await save();await queueCaption();setStatus('设计已生成。');
 }catch(e){if(e.code==='GENERATION_USED'||e.invalidLayer)generationUsed=true;await save();if(sourceIcon&&!baseIcon)await showSourcePreview().catch(()=>{});setStatus(generationUsed?'本次订单的生成机会已使用，重新生成需重新付款 ¥3.00。':e.name==='TimeoutError'?'结果尚未返回，可稍后查看；重复查看不会再次调用模型。':e.message,true)}
 finally{clearInterval(timer);busy=false;$('generate').disabled=false;$('photo').disabled=false;$('progress').style.display='none';$('generateLabel').textContent=generationUsed||icon?'重新生成 · ¥3.00':jobStage?'查看本次生成结果':'生成设计'}
}
$('generate').onclick=async()=>{
 if(busy||restoring)return;
 if(!photo){setStatus('请先上传宠物照片，再生成设计。',true);$('status').scrollIntoView({behavior:'smooth',block:'nearest'});$('drop').focus({preventScroll:true});return}
 if(orderId&&!paid){
  restoring=true;$('generate').disabled=true;
  try{await checkPayment();await save()}
  catch(e){setStatus('付款状态暂时无法确认，请稍后重试。'+e.message,true);return}
  finally{restoring=false;$('generate').disabled=false}
 }
 if(generationUsed||(paid&&card)){regenerate=true;openModal();return}
 if(paid){void runGeneration();return}
 openModal();
};
$('edit').onclick=()=>{document.querySelector('.controls').scrollIntoView({behavior:'smooth',block:'center'});$('photo').click()};
let returnFocus=null;
function openModal(){
 const modal=$('payModal');if(modal.open)return;
 returnFocus=document.activeElement;
 $('checkoutPhoto').src=originalPhoto||photo;
 $('checkPayment').hidden=!orderId||regenerate;
 $('payStatus').textContent=regenerate?'重新生成需创建新订单并支付 ¥3.00。每笔付款仅支持一次生成流程。':'';
 $('payStatus').classList.remove('error');
 modal.showModal();
}
function closeModal(){regenerate=false;if($('payModal').open)$('payModal').close()}
$('payModal').addEventListener('close',()=>{regenerate=false;returnFocus?.focus()});
$('closeModal').onclick=()=>{if(!$('pay').disabled)closeModal()};
$('payModal').addEventListener('cancel',e=>{if($('pay').disabled)e.preventDefault()});
$('payModal').onclick=e=>{
 if(e.target!==$('payModal')||$('pay').disabled)return;
 const bounds=$('payModal').getBoundingClientRect();
 if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)closeModal();
};
async function checkPayment(){
 const state=await api('/api/magnet-order?id='+encodeURIComponent(orderId));
 paid=state.paymentStatus==='paid'&&state.paymentMode==='live';
 if(state.generationStatus==='failed')generationUsed=true;
 if(!paid&&state.requiresNewOrder){orderId='';requestId=crypto.randomUUID();setStatus('价格已更新为 ¥3.00，将按新价格创建订单。');}
 return paid;
}
async function syncDesign(){await api('/api/pet-design',{orderId,image:magnetImage,personalDescription:''})}
async function downloadDesign(){if(!card)throw new Error('请先生成设计稿');if(!orderId||!paid)throw new Error('解锁状态未确认，请重新解锁导出');setStatus('正在准备原始图标…');await compose();await syncDesign();const response=await fetch(apiUrl('/api/magnet-export?id='+encodeURIComponent(orderId)));if(!response.ok){const data=await response.json();throw new Error(data.error||'下载失败，请重试')}const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='PAWMARK-宠物冰箱贴.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type]||'png');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setStatus('已下载。')}
$('download').onclick=()=>downloadDesign().catch(e=>setStatus(e.message,true));
async function checkout(queryOnly){
 const pay=$('pay'),check=$('checkPayment'),status=$('payStatus');
 if(pay.disabled)return;
 pay.disabled=check.disabled=true;$('photo').disabled=true;
 status.classList.remove('error');status.textContent=queryOnly?'正在查询付款状态…':'正在准备支付宝订单…';
 try{
  if(regenerate){
   if(queryOnly){status.textContent='请创建新订单付款后重新生成。';return}
   orderId='';requestId=crypto.randomUUID();paid=false;generationUsed=false;regenerate=false;
   sourceIcon=baseIcon=icon=card=magnetImage=jobStage=jobFingerprint='';layerAttempt=0;
   $('resultActions').style.display='none';$('editNote').classList.add('hidden');
  }
  if(orderId&&await checkPayment()){await save();closeModal();await runGeneration();return}
  if(!orderId){
   if(queryOnly){status.textContent='价格已更新，请使用支付宝付款按钮创建 ¥3.00 新订单。';return}
   requestId=requestId||crypto.randomUUID();
   const order=await api('/api/magnet-order',{requestId,city:'宠物纪念',mainImage:photo,assetKind:'pet-card-v1'});
   orderId=order.orderId;
  }
  if(!await save())throw new Error('浏览器未能保存订单，请允许本站存储后重试付款。当前尚未跳转支付宝。');
  check.hidden=false;
  if(queryOnly){status.textContent='暂未确认到账，请稍后再查。';return}
  const availability=await api('/api/magnet-alipay');
  if(!availability.ready)throw new Error(availability.message||'服务暂未就绪，请稍后再付款');
  status.textContent='正在跳转支付宝收银台…';
  submitAlipay(orderId);
 }catch(e){status.textContent=e.message;status.classList.add('error')}
 finally{pay.disabled=check.disabled=false;$('photo').disabled=false}
}
let checkingPayment=false;
async function resumePaidOrder(){
 if(document.visibilityState==='hidden'||restoring||busy||checkingPayment||!orderId||paid)return;
 checkingPayment=true;
 try{
  if(await checkPayment()){
   await save();closeModal();
   if(!card)await runGeneration();else showCard();
  }
 }catch(e){setStatus('付款状态暂时无法确认，请点击生成设计重试查单。',true)}
 finally{checkingPayment=false}
}
window.addEventListener('focus',resumePaidOrder);
document.addEventListener('visibilitychange',resumePaidOrder);
$('pay').onclick=()=>checkout(false);
$('checkPayment').onclick=()=>checkout(true);
$('generate').disabled=true;$('photo').disabled=true;
restore();
