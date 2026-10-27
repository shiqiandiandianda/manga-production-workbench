export const productionHeaders=['格号','出现角色','当前场景','当前天气','当前时间','景别','机位角度','画面内容','台词','特效字','画面备注','主副格','人物服装状态','道具状态'];
export const productionRows=[
 ['1','甲','石桥','小雨','傍晚','中景','平视','甲在石桥上打开折伞。','甲：雨停了。','','桥面湿润','主格','甲:白衣','折伞:展开'],
 ['2','甲','石桥','小雨','傍晚','特写','俯拍','甲把手放在桥栏上。','','','指尖沾水','副格','甲:白衣','折伞:展开']
];
export const productionObjects=()=>productionRows.map(row=>Object.fromEntries(productionHeaders.map((key,i)=>[key,row[i]])));
