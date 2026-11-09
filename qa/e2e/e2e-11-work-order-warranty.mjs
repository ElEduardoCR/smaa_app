// Local-only end-to-end regression: early billing, warranty and repaired delivery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://localhost:3100';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname), 'This test must use a local app');
const db = new pg.Client({host:'127.0.0.1',port:Number(process.env.PGPORT || 55432),user:process.env.PGUSER || 'postgres',database:'postgres'});
await db.connect();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'es-MX'});
const page = await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
let clientId;
let success=false;
const shots = 'qa/e2e/shots'; fs.mkdirSync(shots,{recursive:true});
async function sign() {
 const canvas=page.locator('canvas').first(); await canvas.scrollIntoViewIfNeeded(); const b=await canvas.boundingBox();
 await page.mouse.move(b.x+20,b.y+b.height/2); await page.mouse.down();
 for(let i=1;i<=8;i++) await page.mouse.move(b.x+20+i*20,b.y+b.height/2+(i%2?15:-15));
 await page.mouse.up();
}
async function orderStatus(id, expected) {
 for(let i=0;i<80;i++){const status=(await db.query('SELECT status FROM work_orders WHERE id=$1',[id])).rows[0]?.status;if(status===expected)return;await new Promise(r=>setTimeout(r,250));}
 throw new Error('OT did not reach '+expected+': '+await page.locator('body').innerText());
}
try {
 const employee=(await db.query("SELECT id,full_name FROM employees WHERE username='qa_master'")).rows[0]; assert(employee);
 clientId=(await db.query("INSERT INTO clients(business_name,payment_days) VALUES('QA garantía navegador',30) RETURNING id")).rows[0].id;
 const quoteId=(await db.query("INSERT INTO quotations(client_id,status,subtotal,vat_total,total,title) VALUES($1,'Approved',1000,160,1160,'QA garantía navegador') RETURNING id",[clientId])).rows[0].id;
 await db.query("INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,line_total) VALUES($1,'QA fabricación garantía',1,1000,1000)",[quoteId]);
 const moduleId=(await db.query("SELECT id FROM manufacturing_modules WHERE code='maquinado'")).rows[0].id;
 const create=async title=>(await db.query('SELECT create_work_order($1,ARRAY[]::uuid[]) id',[{module_id:moduleId,quotation_id:quoteId,work_title:title,priority:'Normal'}])).rows[0].id;
 const openId=await create('QA OT cobro anticipado');
 const warrantyId=await create('QA OT garantía navegador');
 await db.query("UPDATE work_orders SET status='QC_Released',completed_at=now(),qc_released_at=now(),qc_released_by='QA Calidad anterior',qc_approved=true,qc_approved_at=now() WHERE id=$1",[warrantyId]);
 await db.query('INSERT INTO work_order_operators(work_order_id,employee_id) VALUES($1,$2)',[warrantyId,employee.id]);
 const orderNumber=(await db.query('SELECT order_number FROM work_orders WHERE id=$1',[warrantyId])).rows[0].order_number;
 const originalDelivery=(await db.query("INSERT INTO deliveries(delivery_number,work_order_id,stage,delivered_at) VALUES($1,$2,'delivered',now()) RETURNING id",['NE-'+orderNumber.replace(/\D/g,''),warrantyId])).rows[0].id;
 await page.goto(base+'/login');
 await page.getByRole('button',{name:new RegExp(employee.full_name)}).click();
 await page.getByPlaceholder('Ingresa tu contraseña').fill(process.env.QA_MASTER_PASSWORD || 'QaMaster#2026');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 await page.waitForURL(url=>!url.pathname.includes('/login'));
 await page.goto(base+'/manufacturing/maquinado/'+openId);
 await page.getByRole('button',{name:'Enviar a cuentas por cobrar',exact:true}).click();
 await page.getByRole('link',{name:'Ver cuenta por cobrar',exact:true}).waitFor();
 await orderStatus(openId,'Open');
 const invoice=(await db.query('SELECT * FROM ar_invoices WHERE quotation_id=$1',[quoteId])).rows[0]; assert(invoice); assert.equal(invoice.net_amount,'1160.00');
 await page.screenshot({path:shots+'/nov-early-receivable.png',fullPage:true});
 const paymentId=(await db.query('INSERT INTO ar_payments(client_id,amount,registered_by) VALUES($1,100,$2) RETURNING id',[clientId,employee.id])).rows[0].id;
 await db.query('INSERT INTO ar_payment_allocations(payment_id,invoice_id,amount_applied) VALUES($1,$2,100)',[paymentId,invoice.id]);
 await page.goto(base+'/manufacturing/maquinado/'+warrantyId);
 await page.getByRole('button',{name:'Reabrir por garantía',exact:true}).click();
 await page.getByLabel('Motivo de la garantía').fill('Ajustar tolerancia del soporte para proyecto QA');
 await page.getByRole('button',{name:'Confirmar reapertura',exact:true}).click();
 await page.getByRole('button',{name:'Iniciar trabajo',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Historial de garantías',exact:true}).waitFor();
 await orderStatus(warrantyId,'Open');
 const reopened=(await db.query('SELECT * FROM work_orders WHERE id=$1',[warrantyId])).rows[0];assert.equal(reopened.qc_approved,false);assert.equal(reopened.warranty_count,1);
 const balance=(await db.query('SELECT paid_amount,balance FROM ar_invoices WHERE id=$1',[invoice.id])).rows[0];assert.deepEqual(balance,{paid_amount:'100.00',balance:'1060.00'});
 await page.screenshot({path:shots+'/nov-warranty-reopened.png',fullPage:true});
 await page.getByRole('button',{name:'Iniciar trabajo',exact:true}).click();
 await page.getByRole('button',{name:'Firmar y enviar a Calidad',exact:true}).waitFor();
 await sign(); await page.getByRole('button',{name:'Firmar y enviar a Calidad',exact:true}).click();
 await orderStatus(warrantyId,'QC');
 await page.getByRole('button',{name:'Firmar y liberar',exact:true}).waitFor();
 await sign(); await page.getByRole('button',{name:'Firmar y liberar',exact:true}).click();
 await orderStatus(warrantyId,'QC_Released');
 await page.goto(base+'/deliveries/new');
 await page.locator('select').first().selectOption(warrantyId);
 await page.getByRole('button',{name:'Crear Entrega y Cerrar OT',exact:true}).click();
 await page.waitForURL(url=>url.pathname==='/deliveries');
 const warrantyDelivery=(await db.query('SELECT * FROM deliveries WHERE work_order_id=$1 AND warranty_cycle=1',[warrantyId])).rows[0];assert(warrantyDelivery);assert(warrantyDelivery.delivery_number.endsWith('-G1'));
 assert.equal((await db.query('SELECT stage FROM deliveries WHERE id=$1',[originalDelivery])).rows[0].stage,'delivered');
 await page.screenshot({path:shots+'/nov-warranty-new-delivery.png',fullPage:true});
 await page.goto(base+'/deliveries/new');
 const option=page.locator('select').first().locator('option').filter({hasText:orderNumber});
 await option.waitFor({state:'attached'});assert.equal(await option.isDisabled(),true);
 assert.deepEqual(errors,[]);
 success=true; console.log('PASS UI: login, early CxC without release, warranty reopen/history/payment preservation, operator signature → QC signature → new -G1 delivery, prior delivery preserved, duplicate disabled.');
} catch(error){await page.screenshot({path:shots+'/nov-work-order-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally {
 await browser.close();
 if(success && clientId){
  await db.query('BEGIN');
  await db.query('DELETE FROM ar_payment_allocations WHERE invoice_id IN(SELECT id FROM ar_invoices WHERE client_id=$1)',[clientId]);
  await db.query('DELETE FROM ar_payments WHERE client_id=$1',[clientId]);
  await db.query('DELETE FROM ar_invoices WHERE client_id=$1',[clientId]);
  await db.query('DELETE FROM work_order_warranty_events WHERE work_order_id IN(SELECT w.id FROM work_orders w JOIN quotations q ON q.id=w.quotation_id WHERE q.client_id=$1)',[clientId]);
  await db.query('DELETE FROM deliveries WHERE work_order_id IN(SELECT w.id FROM work_orders w JOIN quotations q ON q.id=w.quotation_id WHERE q.client_id=$1)',[clientId]);
  await db.query('DELETE FROM work_orders WHERE quotation_id IN(SELECT id FROM quotations WHERE client_id=$1)',[clientId]);
  await db.query('DELETE FROM quotations WHERE client_id=$1',[clientId]);
  await db.query('DELETE FROM clients WHERE id=$1',[clientId]);
  await db.query('COMMIT');
 }
 await db.end();
}
