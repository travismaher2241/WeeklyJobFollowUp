const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const scripts=[
  read('node_modules/xlsx/dist/xlsx.full.min.js'),
  read('node_modules/jszip/dist/jszip.min.js'),
  `const TEMPLATE_BASE64=${JSON.stringify(fs.readFileSync(path.join(root,'templates/customer-follow-up.xlsx')).toString('base64'))};\nconst modules={};\nfunction define(name,load){const module={exports:{}};load(module,id=>id==='xlsx'?XLSX:modules[id]);modules[name]=module.exports;}\n`+
  ['./export-dates','./excel-parser','./workbook-layout'].map(id=>`define(${JSON.stringify(id)},function(module,require){\n${read('lib/'+id.slice(2)+'.js')}\n});`).join('\n'),
  read('portable/app.js')
];
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const scriptTags=scripts.map(s=>`<script>${escapeScript(s)}</script>`).join('\n');
const styles=read('public/css/export.css')+'\n'+read('portable/portable.css');
// Hash-based inline scripts/styles, with all network connections prohibited.
const hash=s=>`'sha256-${crypto.createHash('sha256').update(s).digest('base64')}'`;
const policy=`default-src 'none'; script-src ${scripts.map(s=>hash(escapeScript(s))).join(' ')}; style-src ${hash(styles)}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const notices=['SheetJS\n'+read('node_modules/xlsx/LICENSE'),'JSZip\n'+read('node_modules/jszip/LICENSE.markdown')].join('\n\n');
const html=read('portable/index.html').replace('<!--POLICY-->',()=>`<meta http-equiv="Content-Security-Policy" content="${policy}">`).replace('<!--STYLES-->',()=>`<style>${styles}</style>`).replace('<!--SCRIPTS-->',()=>scriptTags)+`\n<!-- Third-party license notices\n${notices.replace(/--/g,'—')}\n-->`;
const out=path.join(root,'portable/Plasgain Job Follow Up.html');fs.writeFileSync(out,html);
console.log(`Built ${out} (${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB). All dependencies and the Excel template are embedded.`);
