import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bubbleLayout,svgBubbleMarkup} from '../public/lettering.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';

const require=createRequire(import.meta.url);
const context={measureText:text=>({width:[...text].length*20})};
const bubble={id:'hit-test-dialogue',type:'speech',text:'移动后的台词\n仍然可以选中',visible:true,
  x:100,y:400,w:180,h:120,shape:'none',fontSize:20,lineHeight:1.25,
  textBox:{x:350,y:-300,w:220,h:100},textFrameLayout:true};

test('displaced dialogue remains clickable; empty original box does not capture clicks',async t=>{
  let chromium;
  try{({chromium}=require(process.env.COMIC_PLAYWRIGHT_PATH||'playwright'));}
  catch{t.skip('Playwright is unavailable');return;}
  const browser=await chromium.launch({headless:true,...(process.env.COMIC_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.COMIC_TEST_BROWSER_EXECUTABLE}:{})});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  const render=async b=>{
    await page.setContent('<style>body{margin:0}</style><svg width="1000" height="800"><rect data-panel="background" width="1000" height="800" fill="#eee"/>'+svgBubbleMarkup(context,b)+'</svg>');
    await page.evaluate(()=>document.querySelector('svg').addEventListener('pointerdown',e=>{
      document.body.dataset.selected=e.target.closest('[data-bubble]')?.dataset.bubble||'background';
    }));
  };
  const clickAt=async(x,y,expected)=>{
    await page.mouse.click(x,y);
    assert.equal(await page.locator('body').getAttribute('data-selected'),expected);
  };
  for(const b of [bubble,applyBubbleEdit(bubble,{type:'text-move',dx:80,dy:45}),JSON.parse(JSON.stringify(bubble))]){
    await render(b);
    const box=bubbleLayout(context,b).textBox;
    await clickAt(b.x+box.x+box.w/2,b.y+box.y+box.h/2,b.id);
    // Blank space within the text frame is also a usable drag/selection target.
    await clickAt(b.x+box.x+3,b.y+box.y+3,b.id);
    await clickAt(b.x+b.w/2,b.y+b.h/2,'background');
  }
  const framed={...bubble,shape:'oval'};
  await render(framed);
  const box=bubbleLayout(context,framed).textBox;
  await clickAt(framed.x+box.x+box.w/2,framed.y+box.y+box.h/2,framed.id);
  await clickAt(framed.x+framed.w/2,framed.y+framed.h/2,framed.id);
});
