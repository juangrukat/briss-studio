import {cp,mkdir} from 'node:fs/promises';
for(const name of ['cmaps','standard_fonts','wasm']){
 await mkdir('dist/pdf-assets',{recursive:true});
 await cp(`node_modules/pdfjs-dist/${name}`,`dist/pdf-assets/${name}`,{recursive:true});
}
