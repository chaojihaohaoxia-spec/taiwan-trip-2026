import{h as v}from"./chunk-VBMLPGXX.js";import{c as f,f as b,h as I}from"./chunk-MLJJNGMK.js";var c=(...t)=>t.filter((e,n,o)=>!!e&&e.trim()!==""&&o.indexOf(e)===n).join(" ").trim();var z=t=>t?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function L(t,e,n=[]){if(e==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:z(t),size:24,node:e,...n.length>0?{aliases:n}:{}}}var A=t=>{let e="",n=!1;for(let o of t){if(o==="-"||o==="_"||o<=" "){n=e.length>0;continue}e.length===0?e+=o.toLowerCase():e+=n?o.toUpperCase():o,n=!1}return e};var S=t=>{let e=A(t);return e.charAt(0).toUpperCase()+e.slice(1)};var s={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function y(t){return t!=null}function _(t,e={}){let n=e.attributeNames??{},o=r=>n[r]??r,a=t.size??t.width??s.width,m=t.size??t.height??s.height,p=t.aliases?.filter(r=>typeof r=="string"&&r.trim()!=="").map(r=>`lucide-${r}`)??[],l=[...t.name?[`lucide-${t.name}`]:[],...p],d=e.className?.split(" ").filter(Boolean)??[],x=e.includeDefaultClasses===!1?c(...d):c("lucide",...l,...d),C=e.absoluteStrokeWidth?Number(e.strokeWidth??s["stroke-width"])*Number(t.size??t.width??s.width)/Number(e.size??e.width??s.width):e.strokeWidth??s["stroke-width"];return["svg",{...Object.entries(s).reduce((r,[u,h])=>(r[o(u)]=h,r),{}),..."color"in e&&e.color&&{[o("stroke")]:e.color},..."size"in e&&y(e.size)&&{[o("width")]:e.size,[o("height")]:e.size},..."width"in e&&y(e.width)&&{[o("width")]:e.width},..."height"in e&&y(e.height)&&{[o("height")]:e.height},[o("stroke-width")]:C,...x&&{[o("class")]:x},[o("viewBox")]:`0 0 ${a} ${m}`,...e.hasA11yProp===!1?{[o("aria-hidden")]:"true"}:{},..."attributes"in e&&e.attributes},t.node.map(r=>{let[u,h,k]=r,g=e.nonScalingStroke?{[o("vector-effect")]:"non-scaling-stroke",...h}:h;return k?[u,g,k]:[u,g]})]}var N=t=>{for(let e in t)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1};var T=I({size:24,color:"currentColor",strokeWidth:2,absoluteStrokeWidth:!1,nonScalingStroke:!1,class:""});var W=()=>v(T);var M=({color:t,size:e,width:n,height:o,strokeWidth:a,absoluteStrokeWidth:m,nonScalingStroke:p,children:l,iconNode:d=[],icon:x={node:d,aliases:[],size:24},class:C="",...w})=>{let{size:r=24,strokeWidth:u=2,absoluteStrokeWidth:h=!1,nonScalingStroke:k=!1,color:g="currentColor",class:H=""}=W()??{},[K,U,X=[]]=_(x,{color:t??g,width:n??e??r,height:o??e??r,strokeWidth:a??u,absoluteStrokeWidth:m??h,nonScalingStroke:p??k,className:c(H,C),hasA11yProp:!!l||N(w),attributes:w});return f(K,{...U},[...X.map(([E,F])=>f(E,F)),...b(l)])};function i(t,e,n=[]){let o=typeof t=="string"?L(t,e,n):t,a=({class:m="",className:p="",children:l,...d})=>f(M,{...d,icon:o,class:c(m,p)},l);return o.name&&(a.displayName=S(o.name)),a}var D={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};D.node;var Z=i(D);var P={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};P.node;var G=i(P);var B={name:"circle-alert",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],aliases:["alert-circle"]};B.node;var J=i(B);var $={name:"info",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]};$.node;var O=i($);var q={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};q.node;var Q=i(q);var j={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};j.node;var V=i(j);var R={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};R.node;var Y=i(R);export{i as a,Z as b,G as c,J as d,O as e,Q as f,V as g,Y as h};
/*! Bundled license information:

lucide-preact/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-preact/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-preact/dist/esm/shared/src/utils/toLucideIconData.mjs:
lucide-preact/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-preact/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-preact/dist/esm/shared/src/build/defaultAttributes.mjs:
lucide-preact/dist/esm/shared/src/build/buildLucideIconNode.mjs:
lucide-preact/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-preact/dist/esm/context.mjs:
lucide-preact/dist/esm/Icon.mjs:
lucide-preact/dist/esm/createLucideIcon.mjs:
lucide-preact/dist/esm/icons/chevron-right.mjs:
lucide-preact/dist/esm/icons/check.mjs:
lucide-preact/dist/esm/icons/circle-alert.mjs:
lucide-preact/dist/esm/icons/info.mjs:
lucide-preact/dist/esm/icons/refresh-cw.mjs:
lucide-preact/dist/esm/icons/triangle-alert.mjs:
lucide-preact/dist/esm/icons/x.mjs:
  (**
   * @license lucide-preact v1.48.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
