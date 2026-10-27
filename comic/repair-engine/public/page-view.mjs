// Fixed full-width strips are reused as the viewport moves; never decode a whole page in the browser.
const TILE_ROWS=1024,MAX_TILES=12;
export class PageView {
  constructor(metadata,redraw,status=()=>{}){this.metadata=metadata;this.tileRows=Math.max(1,Math.floor(Math.min(TILE_ROWS,8_000_000/metadata.width)/256))*256;this.redraw=redraw;this.status=status;this.previews=new Map();this.preview=null;this.tiles=new Map();this.pending=new Map();this.retryAfter=new Map();this.queue=[];this.generation=0;this.revision=metadata.revision||0;this.disposed=false;}
  url(name){return `/repair/sources/${this.metadata.id}/${name}`;}
  async load(revision=this.revision){this.revision=revision;this.preview=await this.image(this.url(`preview-${revision}.png`));this.previews.set(revision,this.preview);}
  async image(url){const image=new Image();image.src=url;await image.decode();return image;}
  draw(ctx,t,zoom,viewportWidth,viewportHeight,revision=this.revision){
    const preview=this.previews.get(revision);
    if(preview)ctx.drawImage(preview,t.x,t.y,this.metadata.width*zoom,this.metadata.height*zoom);
    else if(this.preview){ctx.drawImage(this.preview,t.x,t.y,this.metadata.width*zoom,this.metadata.height*zoom);if(!this.loadingPreview){this.loadingPreview=true;this.image(this.url(`preview-${revision}.png`)).then(image=>{if(!this.disposed){this.previews.set(revision,image);this.redraw();}}).finally(()=>{this.loadingPreview=false;}).catch(()=>{});}}
    const minY=Math.max(0,Math.floor(-t.y/zoom)),maxY=Math.min(this.metadata.height,Math.ceil((viewportHeight-t.y)/zoom));
    if(t.x>=viewportWidth||t.x+this.metadata.width*zoom<=0||maxY<=minY){this.queue=[];this.status(false);return;}
    if(zoom<=Math.min(preview?.naturalWidth/this.metadata.width||0,preview?.naturalHeight/this.metadata.height||0)*1.2){this.queue=[];this.status(false);return;}
    const visible=[];
    for(let top=Math.floor(minY/this.tileRows)*this.tileRows;top<maxY;top+=this.tileRows){
      const key=`${revision}:${top}`,tile=this.tiles.get(key);visible.push({key,top,revision});
      if(tile){this.tiles.delete(key);this.tiles.set(key,tile);ctx.drawImage(tile.image,t.x,t.y+top*zoom,this.metadata.width*zoom,tile.height*zoom);}
    }
    this.visibleKeys=new Set(visible.map(tile=>tile.key));this.status(visible.some(tile=>!this.tiles.has(tile.key)));
    const neighbors=[visible.at(-1).top+this.tileRows,visible[0].top-this.tileRows].filter(top=>top>=0&&top<this.metadata.height).map(top=>({key:`${revision}:${top}`,top,revision}));
    this.queue=[...visible,...neighbors].filter(tile=>!this.tiles.has(tile.key)&&!this.pending.has(tile.key)&&(this.retryAfter.get(tile.key)||0)<Date.now());
    this.pump();
  }
  drawLayout(ctx,t,zoom,viewportWidth,viewportHeight,revision=this.revision,segments=[{start:0,end:this.metadata.height,offset:0}]){
    const preview=this.previews.get(revision)||this.preview,visible=new Map();
    if(!this.previews.has(revision)&&!this.loadingPreview){this.loadingPreview=true;this.image(this.url('preview-'+revision+'.png')).then(image=>{if(!this.disposed){this.previews.set(revision,image);this.redraw();}}).finally(()=>{this.loadingPreview=false;}).catch(()=>{});}
    const lowResolution=preview&&zoom<=Math.min(preview.naturalWidth/this.metadata.width,preview.naturalHeight/this.metadata.height)*1.2;
    for(const segment of segments){
      const minY=Math.max(segment.start,Math.floor(-t.y/zoom)-segment.offset),maxY=Math.min(segment.end,Math.ceil((viewportHeight-t.y)/zoom)-segment.offset);
      if(maxY<=minY||t.x>=viewportWidth||t.x+this.metadata.width*zoom<=0)continue;
      ctx.save();ctx.beginPath();ctx.rect(t.x,t.y+(segment.start+segment.offset)*zoom,this.metadata.width*zoom,(segment.end-segment.start)*zoom);ctx.clip();for(const hole of segment.cutouts||[]){ctx.beginPath();ctx.rect(t.x,t.y+(segment.start+segment.offset)*zoom,this.metadata.width*zoom,(segment.end-segment.start)*zoom);ctx.rect(t.x+hole.x*zoom,t.y+(hole.y+segment.offset)*zoom,hole.width*zoom,hole.height*zoom);ctx.clip('evenodd');}
      if(preview)ctx.drawImage(preview,t.x,t.y+segment.offset*zoom,this.metadata.width*zoom,this.metadata.height*zoom);
      if(!lowResolution)for(let top=Math.floor(minY/this.tileRows)*this.tileRows;top<maxY;top+=this.tileRows){
        const key=revision+':'+top,tile=this.tiles.get(key);visible.set(key,{key,top,revision});
        if(tile){this.tiles.delete(key);this.tiles.set(key,tile);ctx.drawImage(tile.image,t.x,t.y+(top+segment.offset)*zoom,this.metadata.width*zoom,tile.height*zoom);}
      }
      ctx.restore();
    }
    const needed=[...visible.values()];this.visibleKeys=new Set(visible.keys());this.status(needed.some(tile=>!this.tiles.has(tile.key)));
    const neighbors=needed.length?[needed.at(-1).top+this.tileRows,needed[0].top-this.tileRows].filter(top=>top>=0&&top<this.metadata.height).map(top=>({key:revision+':'+top,top,revision})):[];
    this.queue=[...needed,...neighbors].filter(tile=>!this.tiles.has(tile.key)&&!this.pending.has(tile.key)&&(this.retryAfter.get(tile.key)||0)<Date.now());this.pump();
  }
  pump(){
    while(!this.disposed&&this.pending.size<2&&this.queue.length){
      const tile=this.queue.shift(),generation=this.generation,height=Math.min(this.tileRows,this.metadata.height-tile.top);
      const work=this.image(`/repair/api/sources/${this.metadata.id}/region?revision=${tile.revision}&x=0&y=${tile.top}&width=${this.metadata.width}&height=${height}`);
      this.pending.set(tile.key,work);
      work.then(image=>{if(this.disposed||generation!==this.generation)return;this.tiles.set(tile.key,{...tile,height,image});this.retryAfter.delete(tile.key);while(this.tiles.size>MAX_TILES){const evict=[...this.tiles.keys()].find(key=>!this.visibleKeys?.has(key));if(!evict)break;this.tiles.delete(evict);}}).catch(()=>this.retryAfter.set(tile.key,Date.now()+3000)).finally(()=>{this.pending.delete(tile.key);if(!this.disposed&&generation===this.generation){this.redraw();this.pump();}});
    }
  }
  dispose(){this.disposed=true;this.generation++;this.queue=[];this.tiles.clear();this.previews.clear();this.preview=null;this.status(false);}
}
