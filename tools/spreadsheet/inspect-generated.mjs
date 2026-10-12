import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const w=await SpreadsheetFile.importXlsx(await FileBlob.load('test/export-results/sample-customer.xlsx'));
// Restore wrap in the preview model; the XLSX native alignment is independently verified.
w.worksheets.getItem('Upcoming Jobs').getRange('A10:B15').format.wrapText=true;
console.log((await w.inspect({kind:'table',range:"'Upcoming Jobs'!A9:E15",include:'values,formulas',tableMaxRows:7,tableMaxCols:5})).ndjson);
const image=await w.render({sheetName:'Upcoming Jobs',range:'A1:E15',scale:1.3,format:'png'});
await fs.writeFile('test/export-results/workbook-preview.png',new Uint8Array(await image.arrayBuffer()));
