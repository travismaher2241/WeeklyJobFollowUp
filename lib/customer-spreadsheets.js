const fs=require('node:fs');
const path=require('node:path');
const AdmZip=require('adm-zip');
const {renderWorksheet,filename}=require('./workbook-layout');
const template=fs.readFileSync(path.join(__dirname,'../templates/customer-follow-up.xlsx'));
function createCustomerWorkbook(customer,jobs,createdAt){
  const zip=new AdmZip(template);
  const sheet=renderWorksheet(zip.readAsText('xl/worksheets/sheet1.xml'),customer,jobs,createdAt);
  zip.updateFile('xl/worksheets/sheet1.xml',Buffer.from(sheet));
  return zip.toBuffer();
}
function createAllWorkbooks(batch){
  const zip=new AdmZip();
  const usedNames=new Set();
  batch.customers.forEach((c,i)=>{
    const name=filename(c.name,i,batch.date);
    if(usedNames.has(name.toLowerCase())) throw new Error(`Two customers produce the filename "${name}". Download those customers individually to avoid overwriting a file.`);
    usedNames.add(name.toLowerCase());
    zip.addFile(name,createCustomerWorkbook(c.name,c.jobs,batch.createdAt));
  });
  return zip.toBuffer();
}
module.exports={createCustomerWorkbook,createAllWorkbooks,filename};
