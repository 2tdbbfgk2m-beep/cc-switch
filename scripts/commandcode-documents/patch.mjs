import fs from "node:fs";
const compatibilityFile = "./desktop-0.1.61.json";
export const desktop = JSON.parse(
  fs.readFileSync(new URL(compatibilityFile, import.meta.url), "utf8"),
);
export const PATCH_VERSION = "1.0.0";
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("Command Code 附件代码不匹配，未修改应用。");
  return source.replace(before, after);
}

export function patchRenderer(original) {
  const m = desktop.markers;
  let source = replaceOnce(
    original,
    m.inlineCondition,
    "if(!l&&(ccSwitchIsDocument(a)||d===Ag(c))){",
  );
  source = replaceOnce(
    source,
    "async function mK(e){",
    "async function mK(e,ccOptions={}){if(ccSwitchIsDocument(e))return ccSwitchParseDocument(e,ccOptions);",
  );
  source = replaceOnce(
    source,
    m.imageHookReturn,
    `const ccIngestAtomic=files=>{
    if(t.current!==null||files.length>Math.max(0,_g-a.current-l.current))return Promise.resolve(false);
    const generation=c.current,controller=d.current;
    if(!controller||controller.signal.aborted)return Promise.resolve(false);
    l.current+=files.length;h.current&&o(l.current);
    const run=async()=>{try{
      const converted=[];
      for(const file of files){
        if(generation!==c.current||controller.signal.aborted)return false;
        const result=await HY(file,controller.signal);
        if(!result||generation!==c.current||controller.signal.aborted)return false;
        converted.push({id:"doc-image-"+Date.now()+"-"+Math.random().toString(36).slice(2,9),dataUrl:result.dataUrl,historyDataUrl:result.historyDataUrl,name:result.name||file.name});
      }
      if(!h.current||generation!==c.current||controller.signal.aborted)return false;
      return await new Promise(resolve=>r(current=>{
        if(generation!==c.current||controller.signal.aborted||current.length+converted.length>_g){resolve(false);return current}
        resolve(true);return[...current,...converted];
      }));
    }catch{return false}finally{if(generation===c.current){l.current=Math.max(0,l.current-files.length);h.current&&o(l.current)}}};
    const pending=f.current.catch(()=>{}).then(run);f.current=pending.then(()=>{});return pending;
  };` +
      m.imageHookReturn.replace(
        "return{",
        "return{imageCountRef:a,ingestAtomic:ccIngestAtomic,",
      ),
  );
  source = replaceOnce(
    source,
    m.imageHookUse,
    m.imageHookUse.replace(
      "{images:Ve",
      "{imageCountRef:ccDocImageCount,ingestAtomic:ccDocIngestAtomic,images:Ve",
    ),
  );
  source = replaceOnce(
    source,
    m.batch,
    `async function gK(items,imageBudget=8){
    const staged=[],documentImages=[],documentErrors=[];let binary=0,tooLarge=0;
    for(const item of items){try{
      const parsed=await mK(item.file,{imageBudget:Math.max(0,imageBudget-documentImages.length)});
      if(parsed.kind==="binary"){binary++;continue}
      if(parsed.kind==="tooLarge"){tooLarge++;continue}
      const images=parsed.images??[];
      staged.push({type:"file",path:item.path,name:item.name,content:parsed.content,tokens:hK(parsed.content),ccSwitchImageCount:images.length});
      documentImages.push(...images);
    }catch(error){documentErrors.push({name:item.name,message:ccSwitchDocumentError(error)})}}
    return{staged,binary,tooLarge,documentImages,documentErrors};
  }`,
  );
  source = replaceOnce(
    source,
    m.apply,
    `const ccBatch=await gK(H,Math.max(0,_g-ccDocImageCount.current-ce.current));
    if(he.current!==ge.draftKey||Je.current!==Ae)return;
    let ccStaged=ccBatch.staged;
    if(ccBatch.documentImages.length){
      if(!h||ccBatch.documentImages.length>Math.max(0,_g-ccDocImageCount.current-ce.current)){
        ccStaged=ccStaged.filter(file=>!file.ccSwitchImageCount);
        Ct({kind:"warning",message:!h?"扫描 PDF 需要支持图片的模型，请切换模型后重新添加。":"扫描 PDF 的图片容量不足，请清除已有图片或拆分 PDF 后重新添加。"});
      }else if(!await ccDocIngestAtomic(ccBatch.documentImages)){
        ccStaged=ccStaged.filter(file=>!file.ccSwitchImageCount);
        if(he.current===ge.draftKey&&Je.current===Ae)Ct({kind:"warning",message:"无法添加扫描 PDF 的全部页面图片，请重试或拆分文档。"});
      }
    }
    if(he.current!==ge.draftKey||Je.current!==Ae)return;
    for(const error of ccBatch.documentErrors)Ct({kind:"warning",message:error.name+"："+error.message});
    if(ccBatch.binary>0)vK();if(ccBatch.tooLarge>0)wK();if(ccStaged.length)ks(ccStaged)`,
  );
  return (
    `import {isDocumentFile as ccSwitchIsDocument,parseDocumentAttachment as ccSwitchParseDocument,documentErrorMessage as ccSwitchDocumentError} from "./cc-switch-documents/parser.mjs";\n` +
    source
  );
}
