export const colorModes=["light","dark"] as const;
export type ColorMode=typeof colorModes[number];
export const themeColors=[
 {key:"surface",label:"窗口背景",light:"#fafaf8",dark:"#24272b"},
 {key:"editor",label:"编辑区背景",light:"#fdfdfb",dark:"#202328"},
 {key:"side",label:"侧栏背景",light:"#f4f4f0",dark:"#292d32"},
 {key:"ink",label:"正文文字",light:"#343730",dark:"#e3e7e9"},
 {key:"muted",label:"次要文字",light:"#6b7066",dark:"#a3adb6"},
 {key:"line",label:"分隔线",light:"#e0e1da",dark:"#414951"},
 {key:"hover",label:"悬停背景",light:"#e8e9e2",dark:"#353d45"},
 {key:"accent",label:"强调色",light:"#a56543",dark:"#e3aa7b"},
 {key:"selection",label:"选区背景",light:"#e8e9e2",dark:"#42546b"},
 {key:"active",label:"当前行背景",light:"#f4f4f0",dark:"#2b323b"},
 {key:"cursor",label:"Vim 块状光标",light:"#5b7058",dark:"#8ba6bc"},
] as const;
export type ThemeColorKey=typeof themeColors[number]["key"];
export type ColorOverrides=Partial<Record<ColorMode,Partial<Record<ThemeColorKey,string>>>>;
const own=(o:object,key:string)=>Object.prototype.hasOwnProperty.call(o,key);
export function validateColorOverrides(value:unknown):ColorOverrides{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("colorOverrides 必须是浅色/深色配色对象");
 for(const [mode,palette] of Object.entries(value)){
  if(!colorModes.includes(mode as ColorMode)||!palette||typeof palette!=="object"||Array.isArray(palette))throw Error("colorOverrides 仅支持 light / dark 配色对象");
  for(const [key,color] of Object.entries(palette)){
   if(!themeColors.some(token=>token.key===key)||typeof color!=="string"||color.length!==7||!/^#[0-9a-fA-F]{6}$/.test(color))throw Error("自定义颜色仅支持已列出的颜色项及 #RRGGBB");
  }
 }
 return value as ColorOverrides;
}
export function colorOverrideCount(value:ColorOverrides|undefined){return colorModes.reduce((count,mode)=>count+Object.keys(value?.[mode]??{}).length,0);}
export function sameColorOverrides(a:ColorOverrides|undefined,b:ColorOverrides|undefined){
 if((a===undefined)!==(b===undefined))return false;
 return colorModes.every(mode=>{
  if(own(a??{},mode)!==own(b??{},mode))return false;
  return themeColors.every(({key})=>own(a?.[mode]??{},key)===own(b?.[mode]??{},key)&&a?.[mode]?.[key]===b?.[mode]?.[key]);
 });
}
export function setColorOverride(current:ColorOverrides|undefined,mode:ColorMode,key:ThemeColorKey,color:string|undefined):ColorOverrides|undefined{
 const next={...current},palette={...current?.[mode]};
 if(color===undefined)delete palette[key];else palette[key]=color;
 if(Object.keys(palette).length)next[mode]=palette;else delete next[mode];
 return Object.keys(next).length?next:undefined;
}
